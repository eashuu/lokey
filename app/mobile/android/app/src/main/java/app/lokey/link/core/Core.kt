package app.lokey.link.core

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONObject

/**
 * The seam between the native UI and whatever runs the assistant (docs/NATIVE-APP.md). Screens see only this: typed state flows for what they draw,
 * a few commands, and a generic JSON pass-through of the renderer bridge (src/shared/bridge.ts) for everything else. Phase N1 implements it with
 * [WebCore] (the existing TypeScript core in a hidden WebView); later phases port pieces to Kotlin behind the same interface.
 */
interface Core {
    val status: StateFlow<CoreStatus>
    val assistant: StateFlow<Assistant>
    val messages: StateFlow<List<ChatMsg>>
    val dictation: StateFlow<Dictation?>
    val activities: StateFlow<List<Activity>>
    val approvals: StateFlow<List<Approval>>
    val jobs: StateFlow<List<Job>>
    val today: StateFlow<List<TodayItem>>
    val pc: StateFlow<PcStatus>
    val media: StateFlow<Media?>
    val settings: StateFlow<SettingsSnapshot>
    val timer: StateFlow<TimerState>
    /** a short "plugged in" / "low battery" banner, null when none */
    val flash: StateFlow<Flash?>
    /** reminders and nudges that fired and wait for Done or Snooze */
    val due: StateFlow<List<TodayItem>>
    /** one-line messages for a toast (the assistant's notices and errors) */
    val notices: SharedFlow<Notice>

    // ---- commands the screens use ----
    fun say(text: String)
    /** push-to-talk down / up */
    fun hold(on: Boolean)
    fun toggleConversation()
    /** stop every running job and conversation */
    fun stopAll()
    fun stopJob(id: String)
    fun answerApproval(a: Approval, allow: Boolean)
    fun dismissDictation()
    fun retry()
    /** a one-line message in the transcript and as a toast */
    fun notify(text: String, error: Boolean = false)
    fun timerStart(minutes: Int)
    fun timerPause()
    fun timerReset()
    fun timerPlusMinute()
    /** toggle / next / prev */
    fun mediaControl(action: String)
    fun mediaSeek(positionMs: Long)
    fun dismissDue(id: String)
    fun snoozeDue(id: String, ms: Long = 600_000)
    /** ask the assistant for text only: the answer is not added to the transcript. "" after [timeoutMs]. */
    suspend fun ask(prompt: String, timeoutMs: Long = 30_000): String

    // ---- the generic bridge ----
    /** `call("bridge.voice.say", "hi")`: any function of the bridge (root `bridge`), confirm card (`confirm`) or overlay (`overlay`); result is org.json data */
    suspend fun call(path: String, vararg args: Any?): Any?
    /** `subscribe("bridge.voice.onEvent") { ... }`: the callback gets the event payload (org.json data); close() unsubscribes */
    fun subscribe(path: String, vararg args: Any?, onEvent: (Any?) -> Unit): AutoCloseable
    /** a phone method of the LokeyNative plugin (flashlight.set, reminder.set, intent.camera...), through the core exactly like the WebView UI does */
    suspend fun nativeCall(method: String, params: JSONObject = JSONObject()): Any? = call("bridge.call", method, params)
    suspend fun patchSettings(patch: JSONObject) { call("bridge.settings.set", patch) }
}

/**
 * The state half of a [Core]: holds the flows and applies the reducers. [WebCore] feeds it from the bridge; [FakeCore] feeds it sample data.
 * Updates may arrive on any thread.
 */
abstract class StateCore : Core {
    protected val _status = MutableStateFlow<CoreStatus>(CoreStatus.Booting)
    private val chat = MutableStateFlow(ChatState())
    private val _assistant = MutableStateFlow(Assistant())
    private val _messages = MutableStateFlow<List<ChatMsg>>(emptyList())
    private val _dictation = MutableStateFlow<Dictation?>(null)
    private val _activities = MutableStateFlow(Activities.of(emptyList(), Assistant(), null, emptyList(), null, emptyList(), PcStatus(), null))
    private val _approvals = MutableStateFlow<List<Approval>>(emptyList())
    private val _jobs = MutableStateFlow<List<Job>>(emptyList())
    private val _today = MutableStateFlow<List<TodayItem>>(emptyList())
    private val _pc = MutableStateFlow(PcStatus())
    private val _media = MutableStateFlow<Media?>(null)
    private val _settings = MutableStateFlow(SettingsSnapshot())
    private val _notices = MutableSharedFlow<Notice>(extraBufferCapacity = 16)
    private val _timer = MutableStateFlow(TimerState())
    private val _flash = MutableStateFlow<Flash?>(null)
    private val _due = MutableStateFlow<List<TodayItem>>(emptyList())
    private var battery: Battery? = null
    @Volatile private var capture: kotlinx.coroutines.CompletableDeferred<String>? = null
    private var tasksToday: List<TodayItem> = emptyList()

    override val status: StateFlow<CoreStatus> get() = _status.asStateFlow()
    override val assistant: StateFlow<Assistant> get() = _assistant.asStateFlow()
    override val messages: StateFlow<List<ChatMsg>> get() = _messages.asStateFlow()
    override val dictation: StateFlow<Dictation?> get() = _dictation.asStateFlow()
    override val activities: StateFlow<List<Activity>> get() = _activities.asStateFlow()
    override val approvals: StateFlow<List<Approval>> get() = _approvals.asStateFlow()
    override val jobs: StateFlow<List<Job>> get() = _jobs.asStateFlow()
    override val today: StateFlow<List<TodayItem>> get() = _today.asStateFlow()
    override val pc: StateFlow<PcStatus> get() = _pc.asStateFlow()
    override val media: StateFlow<Media?> get() = _media.asStateFlow()
    override val settings: StateFlow<SettingsSnapshot> get() = _settings.asStateFlow()
    override val timer: StateFlow<TimerState> get() = _timer.asStateFlow()
    override val flash: StateFlow<Flash?> get() = _flash.asStateFlow()
    override val due: StateFlow<List<TodayItem>> get() = _due.asStateFlow()
    override val notices: SharedFlow<Notice> get() = _notices.asSharedFlow()

    @Synchronized private fun refresh() {
        _activities.value = Activities.of(_approvals.value, _assistant.value, _dictation.value, _jobs.value, _media.value, _due.value, _pc.value, _settings.value.activities, _timer.value, _flash.value)
    }

    @Synchronized private fun applyChat(f: (ChatState) -> ChatState) {
        val before = chat.value.msgs.lastOrNull()
        val s = chat.updateAndGet(f)
        _messages.value = s.msgs; _assistant.value = s.assistant; _dictation.value = s.dictation
        val last = s.msgs.lastOrNull()
        if (last != null && last !== before && (last.kind == MsgKind.Error || last.kind == MsgKind.Notice)) _notices.tryEmit(Notice(last.text, last.kind == MsgKind.Error))
        refresh()
    }

    // ---- inputs, called by the implementation ----
    protected fun onVoice(e: JSONObject) {
        val c = capture
        val t = e.optString("type")
        if (c != null && (t == "said" || t == "reply")) { if (t == "reply" && e.optBoolean("final", true) && e.optString("text").isNotBlank()) c.complete(e.optString("text").trim()); return }
        applyChat { ChatReducer.voice(it, e, System.currentTimeMillis()) }
    }
    protected fun onDictation(e: JSONObject) = applyChat { ChatReducer.dictation(it, e) }
    protected fun typed(text: String) = applyChat { ChatReducer.typed(it, text, System.currentTimeMillis()) }
    protected fun voiceState(s: VoiceState) = applyChat { it.copy(assistant = it.assistant.copy(state = s)) }
    protected fun setConvo(on: Boolean) = applyChat { it.copy(assistant = it.assistant.copy(convo = on)) }
    protected fun setApprovals(f: (List<Approval>) -> List<Approval>) { _approvals.update(f); refresh() }
    protected fun setJobs(l: List<Job>) { _jobs.value = l; refresh() }
    protected fun setTodayFrom(tasks: org.json.JSONArray?, loops: org.json.JSONArray?) { tasksToday = Parse.today(tasks, loops); _today.value = (tasksToday + _due.value); refresh() }
    protected fun setToday(l: List<TodayItem>) { tasksToday = l; _today.value = l + _due.value; refresh() }
    protected fun addDue(i: TodayItem) { _due.update { l -> l.filter { it.id != i.id } + i }; _today.value = tasksToday + _due.value; refresh() }
    protected fun setPc(p: PcStatus) { _pc.value = p; refresh() }
    protected fun setMedia(m: Media?) { _media.value = m; refresh() }
    protected fun setSettings(s: SettingsSnapshot) { _settings.value = s; refresh() }
    protected fun setBattery(b: Battery?, now: Long = System.currentTimeMillis()) {
        val f = ChargeFlash.next(battery, b, now)
        battery = b
        if (f != null) { _flash.value = f; refresh(); onTickNeeded() }
    }

    override fun notify(text: String, error: Boolean) = applyChat { ChatReducer.push(it, if (error) MsgKind.Error else MsgKind.Notice, text, true, System.currentTimeMillis()) }

    // ---- timer, due items, tick ----
    private fun setTimer(n: TimerState) { val o = _timer.value; _timer.value = n; refresh(); onTimerChanged(o, n); onTickNeeded() }
    override fun timerStart(minutes: Int) = setTimer(FocusTimer.start(_timer.value, minutes, System.currentTimeMillis()))
    override fun timerPause() = setTimer(FocusTimer.pause(_timer.value, System.currentTimeMillis()))
    override fun timerReset() = setTimer(FocusTimer.reset(_timer.value))
    override fun timerPlusMinute() = setTimer(FocusTimer.plusMinute(_timer.value, System.currentTimeMillis()))
    /** called by the implementation about once a second while [needsTick]; ends a finished timer and an old flash */
    fun tick(now: Long = System.currentTimeMillis()) {
        val t = FocusTimer.tick(_timer.value, now)
        if (t.status != _timer.value.status) setTimer(t)
        val f = _flash.value
        if (f != null && now >= f.until) { _flash.value = null; refresh() }
    }
    val needsTick: Boolean get() = _timer.value.status == TimerStatus.Running || _flash.value != null
    /** the implementation starts its ticker here */
    protected open fun onTickNeeded() {}
    /** the timer started, paused, stopped or finished: a native alarm may have to follow */
    protected open fun onTimerChanged(old: TimerState, new: TimerState) {}

    override fun dismissDue(id: String) { _due.update { l -> l.filter { it.id != id } }; _today.value = tasksToday + _due.value; refresh() }
    override fun snoozeDue(id: String, ms: Long) = dismissDue(id)
    protected fun dueItem(id: String) = _due.value.firstOrNull { it.id == id }

    override suspend fun ask(prompt: String, timeoutMs: Long): String {
        val d = kotlinx.coroutines.CompletableDeferred<String>()
        capture = d
        return try { askSend(prompt); kotlinx.coroutines.withTimeoutOrNull(timeoutMs) { d.await() } ?: "" } finally { capture = null }
    }
    protected open suspend fun askSend(prompt: String) {}

    protected fun clearApproval(id: String) = setApprovals { ApprovalReducer.remove(it, id) }
}

private fun <T> MutableStateFlow<T>.updateAndGet(f: (T) -> T): T { while (true) { val p = value; val n = f(p); if (compareAndSet(p, n)) return n } }
