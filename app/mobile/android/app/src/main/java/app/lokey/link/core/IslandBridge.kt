package app.lokey.link.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job as CoJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.launch
import org.json.JSONObject

/** What a button on a face (the overlay pill or a Live Update notification) does. One place, the same handlers as the in-app cards. */
object FaceActions {
    fun run(core: Core, face: String, action: String) {
        when (face) {
            "approval" -> core.approvals.value.firstOrNull()?.let { core.answerApproval(it, action == "allow") }
            "music" -> core.mediaControl(if (action == "prev" || action == "next") action else "toggle")
            "timer" -> {
                val t = core.timer.value
                when {
                    action == "plus1" -> core.timerPlusMinute()
                    action == "stop" -> core.timerReset()
                    t.status == TimerStatus.Running -> core.timerPause()
                    else -> core.timerStart(maxOf(1, Math.round(t.totalMs / 60_000.0).toInt()))
                }
            }
            "job" -> if (action == "stopAll") core.stopAll() else core.jobs.value.firstOrNull { it.status == JobStatus.Running }?.let { core.stopJob(it.id) }
            "voice" -> if (action == "conversation") core.toggleConversation() else core.stopAll()
            "reminder" -> core.due.value.firstOrNull()?.let { if (action == "snooze") core.snoozeDue(it.id) else core.dismissDue(it.id) }
        }
    }
}

/**
 * Publishes the live activities to the native island (`island.update`, the pill at the camera and Live Updates) and runs what the user presses
 * there. The WebView UI did this from React (nativeIsland.tsx); the native app has no React, so it lives here. The native layer forgets faces
 * after two minutes, so active ones are re-sent every minute.
 */
@OptIn(FlowPreview::class)
class IslandBridge(private val core: Core, private val scope: CoroutineScope, private val onTap: (String) -> Unit = {}) {
    private val jobs = ArrayList<CoJob>()
    private val subs = ArrayList<AutoCloseable>()
    private var lastKey = ""
    private var lastSent = 0L

    fun start() {
        val flows: List<Flow<Any?>> = listOf(core.activities, core.approvals, core.assistant, core.messages, core.timer, core.jobs, core.media, core.due, core.pc, core.flash)
        jobs += scope.launch {
            combine(flows) { it }.debounce(100).collect { publish(force = false) }
        }
        jobs += scope.launch { while (true) { delay(60_000); publish(force = true) } }
        jobs += scope.launch { core.settings.collect { s -> if (s.loaded) try { core.nativeCall("island.setEnabled", switches(s.raw)) } catch (_: Exception) { } } }
        subs += core.subscribe("native.onEvent") { e ->
            val o = e as? JSONObject ?: return@subscribe
            val d = o.optJSONObject("data") ?: JSONObject()
            when (o.optString("name")) {
                "island.action" -> FaceActions.run(core, d.optString("face", d.optString("kind", d.optString("faceId"))), d.optString("action", d.optString("id", d.optString("actionId"))))
                "island.tap" -> onTap(d.optString("face", d.optString("kind", d.optString("faceId"))))
            }
        }
    }

    fun stop() { jobs.forEach { it.cancel() }; subs.forEach { runCatching { it.close() } } }

    private fun switches(raw: JSONObject): JSONObject {
        val p = raw.optJSONObject("phone")
        fun on(k: String) = p?.optBoolean(k, true) ?: true
        return JSONObject().put("systemIsland", on("systemIsland")).put("liveUpdates", on("liveUpdates")).put("vivo", on("vivoIsland"))
    }

    private suspend fun publish(force: Boolean) {
        val now = System.currentTimeMillis()
        val last = core.messages.value.lastOrNull { it.kind == MsgKind.Said || it.kind == MsgKind.Reply }?.text.orEmpty()
        val u = IslandFaces.build(core.activities.value.map { it.kind }, core.approvals.value, core.assistant.value, last, core.timer.value, core.jobs.value, core.media.value, core.due.value, core.pc.value, core.flash.value, now)
        val key = u.key()
        if (!force && key == lastKey) return
        if (force && u.faces.isEmpty()) return
        lastKey = key; lastSent = now
        try { core.nativeCall("island.update", u.toParams()) } catch (_: Exception) { }
    }
}
