package app.lokey.link.core

import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job as CoJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * [Core] backed by the existing TypeScript core running headlessly in a hidden WebView (`/?headless=1`, src/mobile/headless.ts). The WebView is the
 * Capacitor one of [app.lokey.link.LokeyActivity], so the LokeyNative plugin keeps answering the core's native calls. Messages: [HostCodec].
 */
class WebCore(private val web: WebView, private val scope: CoroutineScope) : StateCore() {
    private val ids = AtomicInteger(1)
    private val pending = ConcurrentHashMap<Int, CompletableDeferred<Any?>>()
    private val handlers = ConcurrentHashMap<Int, (Any?) -> Unit>()
    private var booted: CompletableDeferred<Unit> = CompletableDeferred()
    private var watch: CoJob? = null
    private var poll: CoJob? = null

    /** exposed to the page as `LokeyCoreHost` */
    inner class Host {
        @JavascriptInterface fun post(json: String) = onMessage(json)
    }

    fun attach() {
        web.addJavascriptInterface(Host(), "LokeyCoreHost")
        armWatchdog()
    }

    private fun armWatchdog() {
        watch?.cancel()
        watch = scope.launch {
            delay(BOOT_TIMEOUT_MS)
            if (_status.value is CoreStatus.Booting) _status.value = CoreStatus.Failed("The assistant core did not start in time")
        }
    }

    // ---- page -> Kotlin ----
    internal fun onMessage(json: String) {
        when (val m = HostCodec.decode(json)) {
            is HostMsg.Res -> pending.remove(m.id)?.let { if (m.ok) it.complete(m.value) else it.completeExceptionally(CoreError(m.error ?: "failed")) }
            is HostMsg.Ev -> handlers[m.sid]?.let { h -> try { h(m.value) } catch (e: Exception) { Log.w(TAG, "event handler failed", e) } }
            is HostMsg.Ready -> if (m.ok) onReady(m.kind ?: "android") else { _status.value = CoreStatus.Failed(m.error ?: "The assistant core failed to start"); booted.completeExceptionally(CoreError(m.error ?: "boot failed")) }
            null -> Log.w(TAG, "dropped a malformed message")
        }
    }

    private fun onReady(kind: String) {
        watch?.cancel()
        handlers.clear()
        _status.value = CoreStatus.Ready(kind)
        booted.complete(Unit)
        wire()
    }

    // ---- Kotlin -> page ----
    private fun send(json: String) {
        web.post { web.evaluateJavascript("window.__lokeyHost&&window.__lokeyHost.recv(${JSONObject.quote(json)})", null) }
    }

    override suspend fun call(path: String, vararg args: Any?): Any? {
        withTimeout(BOOT_TIMEOUT_MS) { booted.await() }
        val id = ids.getAndIncrement()
        val d = CompletableDeferred<Any?>()
        pending[id] = d
        send(HostCodec.call(id, path, args.toList()))
        return try { withTimeout(CALL_TIMEOUT_MS) { d.await() } } finally { pending.remove(id) }
    }

    override fun subscribe(path: String, vararg args: Any?, onEvent: (Any?) -> Unit): AutoCloseable {
        val sid = ids.getAndIncrement()
        handlers[sid] = onEvent
        send(HostCodec.sub(sid, path, args.toList()))
        return AutoCloseable { handlers.remove(sid); send(HostCodec.unsub(sid)) }
    }

    /** fire and forget: a failed command shows up in the log, not as a crash in a click handler */
    private fun run(path: String, vararg args: Any?) {
        scope.launch { try { call(path, *args) } catch (e: CancellationException) { throw e } catch (e: Exception) { Log.w(TAG, "$path failed: ${e.message}") } }
    }

    // ---- state wiring, once per boot ----
    private fun wire() {
        subscribe("bridge.voice.onEvent") { (it as? JSONObject)?.let(::onVoice) }
        subscribe("bridge.voice.onTasks") { t -> scope.launch { loadToday(t as? JSONArray) } }
        subscribe("bridge.agents.onChange") { (it as? JSONArray)?.let { a -> setJobs(Parse.jobs(a)) } }
        subscribe("bridge.settings.onChange") { (it as? JSONObject)?.let { s -> setSettings(Parse.settings(s)) } }
        subscribe("bridge.link.onEvent") { onLink(it as? JSONObject) }
        subscribe("bridge.on", "media.changed") { setMedia(Parse.media(it as? JSONObject)) }
        subscribe("bridge.on", "system.changed") { setBattery(Parse.battery(it as? JSONObject)) }
        subscribe("confirm.onRequest") { (it as? JSONObject)?.let { r -> setApprovals { l -> ApprovalReducer.add(l, ApprovalReducer.local(r)) } } }
        subscribe("overlay.on", "dictation") { (it as? JSONObject)?.let(::onDictation) }
        subscribe("native.onEvent") { onNative(it as? JSONObject) }
        scope.launch { loadInitial() }
        poll?.cancel()
        poll = scope.launch { while (true) { delay(POLL_MS); loadToday(null); loadPc() } }
    }

    private suspend fun loadInitial() {
        try { (call("bridge.settings.get") as? JSONObject)?.let { setSettings(Parse.settings(it)) } } catch (e: Exception) { Log.w(TAG, "settings.get: ${e.message}") }
        try { (call("bridge.voice.info") as? JSONObject)?.let { i -> voiceState(VoiceState.parse(i.optString("state"))); tasks = i.optJSONArray("tasks") } } catch (_: Exception) { }
        try { (call("bridge.agents.list") as? JSONArray)?.let { setJobs(Parse.jobs(it)) } } catch (_: Exception) { }
        try { setMedia(Parse.media(call("bridge.call", "media.get", JSONObject()) as? JSONObject)) } catch (_: Exception) { }
        try { setBattery(Parse.battery(call("bridge.call", "system.get", JSONObject()) as? JSONObject)) } catch (_: Exception) { }
        loadToday(null); loadPc()
    }

    @Volatile private var tasks: JSONArray? = null
    private suspend fun loadToday(t: JSONArray?) {
        if (t != null) tasks = t
        val loops = try { call("bridge.voice.loops") as? JSONArray } catch (_: Exception) { null }
        setTodayFrom(tasks, loops)
        // an open loop whose time has come is a reminder too
        Parse.today(null, loops).filter { it.kind == TodayKind.Loop && (it.atMs ?: Long.MAX_VALUE) <= System.currentTimeMillis() }.forEach { addDue(it.copy(kind = TodayKind.Loop, sub = it.sub)) }
    }

    private suspend fun loadPc() {
        val st = try { call("bridge.link.state") as? JSONObject } catch (_: Exception) { null }
        val status = try { call("bridge.link.pcStatus") as? JSONObject } catch (_: Exception) { null }
        setPc(Parse.pc(st, status))
    }

    private fun onLink(e: JSONObject?) {
        e ?: return
        val type = e.str("type")
        setApprovals { ApprovalReducer.link(it, type, e.optJSONObject("data")) }
        if (type == "connected" || type == "disconnected" || type == "revoked") scope.launch { loadPc() }
        if (type == "nudge") {
            val d = e.optJSONObject("data")
            addDue(TodayItem("nudge:" + System.currentTimeMillis(), d?.strOrNull("title") ?: d?.str("text") ?: "From your PC", TodayKind.Reminder, null, if (d?.strOrNull("title") != null) d.str("text") else ""))
        }
    }

    private fun onNative(e: JSONObject?) {
        e ?: return
        if (e.str("name") == "reminder.fired") {
            val d = e.optJSONObject("data") ?: JSONObject()
            val id = d.str("id", System.currentTimeMillis().toString())
            addDue(TodayItem("rem:$id", d.strOrNull("title") ?: d.strOrNull("text") ?: "Reminder", TodayKind.Reminder, System.currentTimeMillis(), if (d.strOrNull("title") != null) d.str("text") else ""))
        }
    }

    // ---- commands ----
    override fun say(text: String) { if (text.isBlank()) return; typed(text); run("bridge.voice.say", text) }
    override fun hold(on: Boolean) = run("bridge.voice.hold", on)
    override fun toggleConversation() { setConvo(!assistant.value.convo); run("bridge.voice.toggleConversation") }
    override fun stopAll() = run("bridge.agents.stop", "all")
    override fun stopJob(id: String) = run("bridge.agents.stop", id)
    override fun answerApproval(a: Approval, allow: Boolean) {
        clearApproval(a.id)
        if (a.source == ApprovalSource.Pc) run("bridge.link.approve", a.id, allow) else run("confirm.answer", a.id, allow)
    }
    override fun mediaControl(action: String) = run("bridge.call", "media.control", JSONObject().put("action", action))
    override fun mediaSeek(positionMs: Long) = run("bridge.call", "media.control", JSONObject().put("action", "seek").put("positionMs", positionMs))

    override fun dismissDue(id: String) {
        super.dismissDue(id)
        if (id.startsWith("loop:")) run("bridge.voice.loopSet", id.removePrefix("loop:"), "done")
    }
    override fun snoozeDue(id: String, ms: Long) {
        val item = dueItem(id) ?: return
        super.dismissDue(id)
        if (id.startsWith("loop:")) run("bridge.voice.loopSet", id.removePrefix("loop:"), "snooze")
        else run("bridge.call", "reminder.set", JSONObject().put("inMs", ms).put("title", item.title).put("text", item.sub.ifEmpty { item.title }))
        scope.launch { delay(ms); addDue(item) }
    }

    override suspend fun askSend(prompt: String) { call("bridge.voice.say", prompt) }

    override fun onTimerChanged(old: TimerState, new: TimerState) {
        // the OS rings the timer when the app is asleep; in the foreground the ticker shows it
        if (new.status == TimerStatus.Running && (old.status != TimerStatus.Running || old.endsAt != new.endsAt))
            run("bridge.call", "reminder.set", JSONObject().put("id", "timer").put("inMs", FocusTimer.remaining(new, System.currentTimeMillis())).put("title", "Timer done").put("text", "${Math.max(1, new.totalMs / 60_000)} min are up"))
        else if (new.status != TimerStatus.Running && old.status == TimerStatus.Running && new.status != TimerStatus.Done) run("bridge.call", "reminder.cancel", JSONObject().put("id", "timer"))
    }

    private var tickJob: CoJob? = null
    override fun onTickNeeded() {
        if (tickJob?.isActive == true) return
        tickJob = scope.launch { while (needsTick) { delay(1000); tick() } }
    }

    override fun dismissDictation() = onDictation(JSONObject().put("type", "cancel"))

    override fun retry() {
        _status.value = CoreStatus.Booting
        booted = CompletableDeferred()
        armWatchdog()
        web.post { web.reload() }
    }

    fun close() { watch?.cancel(); poll?.cancel(); tickJob?.cancel(); web.post { web.removeJavascriptInterface("LokeyCoreHost") } }

    class CoreError(message: String) : Exception(message)

    private companion object {
        const val TAG = "WebCore"
        const val BOOT_TIMEOUT_MS = 45_000L
        const val CALL_TIMEOUT_MS = 60_000L
        const val POLL_MS = 20_000L
    }
}
