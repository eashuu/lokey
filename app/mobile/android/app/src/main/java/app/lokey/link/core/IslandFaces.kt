package app.lokey.link.core

import org.json.JSONArray
import org.json.JSONObject

/** What `island.update` carries (PLUGIN.md "System-wide island"): one face per live activity, the pill shows [primary]. A port of phone/nativeIsland.tsx. */
data class IslandUpdate(val faces: List<JSONObject>, val primary: String?) {
    fun toParams(): JSONObject = JSONObject().put("faces", JSONArray(faces)).put("primary", primary ?: JSONObject.NULL)
    /** same faces, ignoring the seconds that tick by: the publisher only sends when this changes */
    fun key(): String = faces.joinToString("|") { f ->
        val e = if (f.has("endAt")) f.optLong("endAt") / 2000 else -1
        val p = if (f.has("progress")) Math.round(f.optDouble("progress") * 50) else -1
        listOf(f.optString("id"), f.optString("title"), f.optString("subtitle"), e, p, f.optString("icon")).joinToString("~")
    } + "#" + primary
}

object IslandFaces {
    private fun action(id: String, label: String, primary: Boolean = false) = JSONObject().put("id", id).put("label", label).apply { if (primary) put("primary", true) }

    private fun face(kind: ActivityKind, title: String, subtitle: String, icon: String? = null, actions: List<JSONObject> = emptyList()) =
        JSONObject().put("id", kind.name.lowercase()).put("kind", kind.name.lowercase()).put("title", title).put("subtitle", subtitle).put("priority", kind.prio)
            .apply { if (icon != null) put("icon", icon); if (actions.isNotEmpty()) put("actions", JSONArray(actions)) }

    fun build(
        kinds: List<ActivityKind>, approvals: List<Approval>, assistant: Assistant, lastText: String, timer: TimerState, jobs: List<Job>,
        media: Media?, due: List<TodayItem>, pc: PcStatus, flash: Flash?, now: Long,
    ): IslandUpdate {
        val faces = kinds.filter { it != ActivityKind.Idle }.map { k ->
            when (k) {
                ActivityKind.Approval -> {
                    val c = approvals.firstOrNull()
                    face(k, c?.title ?: "Approval needed", (c?.detail?.ifEmpty { null } ?: if (c?.source == ApprovalSource.Pc) "Your PC asks" else "Lokey wants to").take(120), "approval",
                        listOf(action("deny", "Deny"), action("allow", "Allow", true)))
                }
                ActivityKind.Voice -> face(k, when (assistant.state) { VoiceState.Thinking -> "Thinking..."; VoiceState.Speaking -> "Speaking..."; else -> "Listening..." }, lastText.take(100), "voice", listOf(action("stop", "Stop")))
                ActivityKind.Timer -> {
                    val run = timer.status == TimerStatus.Running
                    val f = face(k, when (timer.status) { TimerStatus.Done -> "Timer done"; TimerStatus.Paused -> FocusTimer.clock(timer.remainingMs); else -> "Timer" },
                        when (timer.status) { TimerStatus.Paused -> "Paused"; TimerStatus.Done -> "Focus"; else -> "Focus (counts down on its own)" }, "timer",
                        listOf(action("toggle", if (run) "Pause" else "Resume", true), action("plus1", "+1 min"), action("stop", "Stop")))
                    f.put("progress", if (timer.totalMs > 0) (1.0 - FocusTimer.remaining(timer, now).toDouble() / timer.totalMs).coerceIn(0.0, 1.0) else 0.0)
                    if (run) f.put("endAt", now + FocusTimer.remaining(timer, now))
                    f
                }
                ActivityKind.Job -> { val j = jobs.firstOrNull { it.status == JobStatus.Running }; face(k, j?.title ?: "Working", (j?.line ?: "").take(100), "job", listOf(action("stop", "Stop"))) }
                ActivityKind.Music -> {
                    val dur = media?.durationMs ?: 0
                    val pos = media?.positionAt(now) ?: 0
                    val f = face(k, media?.title?.ifEmpty { null } ?: "Playing", media?.artist?.ifEmpty { null } ?: media?.app.orEmpty(), if (media?.playing == true) "music" else "music-paused",
                        listOf(action("prev", "Previous"), action("toggle", if (media?.playing == true) "Pause" else "Play", true), action("next", "Next")))
                    if (dur > 0) f.put("progress", (pos.toDouble() / dur).coerceIn(0.0, 1.0))
                    if (media?.playing == true && dur > 0) f.put("endAt", now + (dur - pos))
                    f
                }
                ActivityKind.Reminder -> {
                    val d = due.firstOrNull()
                    face(k, d?.title ?: "Reminder", d?.sub?.ifEmpty { null } ?: if (d?.kind == TodayKind.Loop) "You said you would" else "Reminder", "reminder",
                        listOf(action("snooze", "Snooze 10 min"), action("done", "Done", true)))
                }
                ActivityKind.Charging -> face(k, flash?.text.orEmpty(), if (flash?.low == true) "Low battery" else "Charging", if (flash?.low == true) "battery-low" else "charging")
                ActivityKind.Pc -> face(k, pc.name.ifEmpty { "Your PC" }, if (pc.connected) "Connected" else "Not reachable", "pc")
                ActivityKind.Idle -> face(k, "", "")
            }
        }
        val primary = kinds.firstOrNull()?.takeIf { it != ActivityKind.Idle }?.name?.lowercase()
        return IslandUpdate(faces, primary)
    }
}
