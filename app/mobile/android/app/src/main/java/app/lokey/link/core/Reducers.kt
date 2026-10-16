package app.lokey.link.core

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/** The transcript and voice state; a port of renderer/src/phone/chat.ts (the store the phone UI keeps from voice events). */
data class ChatState(
    val msgs: List<ChatMsg> = emptyList(),
    val assistant: Assistant = Assistant(),
    val dictation: Dictation? = null,
    val nextId: Long = 1,
)

object ChatReducer {
    const val MAX = 120
    private const val ECHO_MS = 5000

    fun push(s: ChatState, kind: MsgKind, text: String, final: Boolean, now: Long, typed: Boolean = false): ChatState {
        val t = text.trim()
        if (t.isEmpty()) return s
        val last = s.msgs.lastOrNull()
        // a streamed said/reply grows in place until it is final
        if ((kind == MsgKind.Said || kind == MsgKind.Reply) && last != null && last.kind == kind && !last.final)
            return s.copy(msgs = s.msgs.dropLast(1) + last.copy(text = t, final = final))
        // a typed request is echoed locally; the core may echo it again as "said": show it once
        if (kind == MsgKind.Said && !typed && last != null && last.typed && last.kind == MsgKind.Said && last.text == t && now - last.at < ECHO_MS) return s
        return s.copy(msgs = (s.msgs + ChatMsg(s.nextId, kind, t, final, now, typed)).takeLast(MAX), nextId = s.nextId + 1)
    }

    /** the user typed [text]: shown at once, then sent */
    fun typed(s: ChatState, text: String, now: Long) = push(s, MsgKind.Said, text, true, now, typed = true)

    /** one VoiceEvent (shared/voice.ts) from `bridge.voice.onEvent` */
    fun voice(s: ChatState, e: JSONObject, now: Long): ChatState {
        val a = s.assistant
        return when (e.optString("type")) {
            "state" -> s.copy(assistant = a.copy(state = VoiceState.parse(e.optString("state")), kind = e.str("kind", "assistant")))
            "said" -> if (a.kind == "assistant") push(s, MsgKind.Said, e.str("text"), e.bool("final", true), now).caption(MsgKind.Said, e.str("text")) else s
            "reply" -> push(s, MsgKind.Reply, e.str("text"), e.bool("final", true), now).caption(MsgKind.Reply, e.str("text"))
            "notice" -> push(s, if (e.str("tone") == "error") MsgKind.Error else MsgKind.Notice, e.str("text"), true, now)
            "convo" -> s.copy(assistant = a.copy(convo = e.bool("on")))
            "clear" -> s.copy(assistant = a.copy(caption = null))
            else -> s
        }
    }

    private fun ChatState.caption(k: MsgKind, text: String) = if (text.isBlank()) this else copy(assistant = assistant.copy(caption = text.trim()))

    /** DictationEvent (the dictation overlay's input) */
    fun dictation(s: ChatState, e: JSONObject): ChatState {
        val cur = s.dictation
        val d = when (e.optString("type")) {
            "start" -> Dictation(DictPhase.Listening)
            "raw", "partial" -> Dictation(DictPhase.Listening, e.str("text"), cur?.text ?: "")
            "working" -> Dictation(DictPhase.Working, cur?.raw ?: "")
            "clean" -> Dictation(DictPhase.Done, cur?.raw ?: "", e.str("text"))
            "error" -> Dictation(DictPhase.Error, "", e.str("text", "Dictation failed"))
            "cancel" -> null
            else -> cur
        }
        return s.copy(dictation = d)
    }

    fun dismissDictation(s: ChatState) = s.copy(dictation = null)
}

/** pending approvals, newest last; one id is one card */
object ApprovalReducer {
    fun add(list: List<Approval>, a: Approval) = list.filter { it.id != a.id } + a
    fun remove(list: List<Approval>, id: String) = list.filter { it.id != id }

    /** the confirm request the local assistant raises (shared/voice.ts ConfirmRequest) */
    fun local(r: JSONObject) = Approval(r.str("id"), r.str("title"), r.str("detail"), r.str("tool"), r.long("timeoutMs", 30_000), r.strOrNull("image"), ApprovalSource.Local)

    /** a Link event from the PC: 'confirm' adds a card, 'confirm-done' removes it; anything else leaves the list as it is */
    fun link(list: List<Approval>, type: String, data: JSONObject?): List<Approval> {
        val id = data?.strOrNull("id") ?: return list
        return when (type) {
            "confirm" -> add(list, Approval(id, data.str("title", "Your PC needs approval"), data.str("detail"), "", data.long("timeoutMs", 30_000), null, ApprovalSource.Pc))
            "confirm-done" -> remove(list, id)
            else -> list
        }
    }
}

object Parse {
    fun jobs(a: JSONArray): List<Job> = a.objects().map {
        Job(it.str("id"), it.str("kind"), it.str("title"), when (it.str("status")) { "running" -> JobStatus.Running; "done" -> JobStatus.Done; "failed" -> JobStatus.Failed; else -> JobStatus.Stopped },
            it.str("line"), it.strOrNull("result"), it.long("startedAt"))
    }

    fun media(o: JSONObject?): Media? = o?.let {
        Media(it.bool("hasSession"), it.str("app"), it.str("title"), it.str("artist"), it.bool("playing"), it.long("positionMs"), it.long("durationMs"), it.long("sampledAt"),
            it.bool("canNext"), it.bool("canPrev"), it.strOrNull("art"))
    }

    fun battery(o: JSONObject?): Battery? = o?.optJSONObject("battery")?.let { Battery(it.bool("present"), it.optDouble("pct", 0.0), it.bool("charging")) }

    /** the glow colour of each spirit skin (renderer island/skins.ts): `accent: "wallpaper"` means this on a phone */
    val SKIN_GLOW = mapOf("puff" to "#FF7FB8", "bloom" to "#B97CFF", "sunny" to "#FFB830", "minty" to "#4FD6A0", "sky" to "#5AB0FF", "droplet" to "#54A8FF", "ember" to "#FF5A36",
        "wisp" to "#52C98A", "amethyst" to "#8A5CFF", "gilded" to "#FFB020")
    val SKIN_NAME = SKIN_GLOW.keys.associateWith { it.replaceFirstChar { c -> c.uppercase() } }

    private fun iso(s: String?): Long? = try { s?.let { Instant.parse(it).toEpochMilli() } } catch (_: Exception) { null }

    /** Today = pending scheduled tasks and open loops that have a time, soonest first; loops without a time go last */
    fun today(tasks: JSONArray?, loops: JSONArray?): List<TodayItem> {
        val t = tasks?.objects().orEmpty().filter { it.str("status") == "pending" }
            .map { TodayItem("task:" + it.str("id"), it.str("title"), TodayKind.Task, iso(it.strOrNull("runAt")), it.str("say"), it.strOrNull("repeat")) }
        val l = loops?.objects().orEmpty()
            .map { TodayItem("loop:" + it.str("id"), it.str("what"), TodayKind.Loop, iso(it.strOrNull("due")), it.strOrNull("who")?.let { w -> "with $w" } ?: "") }
        return (t + l).sortedWith(compareBy<TodayItem> { it.atMs == null }.thenBy { it.atMs ?: 0L })
    }

    /** '#rrggbb' -> opaque ARGB, null for anything else ("wallpaper" means the default accent on a phone) */
    fun hex(s: String?): Long? {
        if (s == null || !Regex("^#[0-9a-fA-F]{6}$").matches(s)) return null
        return 0xFF000000L or s.substring(1).toLong(16)
    }

    fun settings(o: JSONObject): SettingsSnapshot {
        val ap = o.optJSONObject("appearance")
        val ph = o.optJSONObject("phone")
        val acts = ph?.optJSONArray("activities")
        val skin = o.optJSONObject("loadout")?.str("soul", "puff") ?: "puff"
        val wake = o.optJSONObject("wake")?.optJSONArray("list")?.objects()?.map { it.str("text") to it.str("action") }.orEmpty()
        return SettingsSnapshot(
            dark = when (ap?.optString("theme")) { "dark" -> true; "light" -> false; else -> null },
            accent = ap?.optString("accent").let { a -> hex(a) ?: if (a == "wallpaper") hex(SKIN_GLOW[skin]) else null },
            skin = skin,
            calmSpirit = ph?.optString("spirit") == "calm",
            haptics = ph?.bool("haptics", true) ?: true,
            reduceMotion = ap?.bool("reduceMotion") ?: false,
            activities = acts?.let { a -> (0 until a.length()).map { a.optString(it) }.toSet() },
            loaded = true, wakeList = wake, raw = o,
        )
    }

    fun pc(state: JSONObject?, status: JSONObject?): PcStatus {
        val paired = state?.bool("enabled") ?: false
        val np = status?.optJSONObject("nowPlaying")
        return PcStatus(
            paired = paired, connected = status != null,
            name = status?.str("pc") ?: state?.optJSONArray("devices")?.optJSONObject(0)?.str("name") ?: "",
            agent = status?.str("agent") ?: "",
            jobs = status?.optJSONArray("jobs")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList(),
            playing = np?.takeIf { it.bool("playing") }?.let { "${it.str("title")} - ${it.str("artist")}" },
        )
    }
}

/** Which live activity is the face (phone/activities.ts useActivities, minus the timer and charging faces the renderer owns). */
object Activities {
    fun of(
        approvals: List<Approval>, assistant: Assistant, dictation: Dictation?, jobs: List<Job>, media: Media?,
        due: List<TodayItem>, pc: PcStatus, enabled: Set<String>?, timer: TimerState = TimerState(), flash: Flash? = null,
    ): List<Activity> {
        // approvals are never hidden; the rest follow Settings > Island
        fun on(k: String) = enabled == null || k in enabled
        val a = ArrayList<Activity>()
        if (approvals.isNotEmpty()) a += Activity(ActivityKind.Approval, approvals.first().title, if (approvals.size > 1) "${approvals.size} waiting" else "Waiting for you")
        val busy = assistant.state != VoiceState.Idle || assistant.convo || (dictation != null && dictation.phase != DictPhase.Done)
        if (busy && on("voice")) a += Activity(ActivityKind.Voice, voiceLabel(assistant, dictation), "Lokey")
        if (timer.status != TimerStatus.Idle && on("timer")) a += Activity(ActivityKind.Timer, if (timer.status == TimerStatus.Done) "Timer done" else "Timer", if (timer.status == TimerStatus.Paused) "Paused" else "Focus")
        if (flash != null && on("charging")) a += Activity(ActivityKind.Charging, flash.text, if (flash.low) "Low battery" else "Charging")
        val running = jobs.filter { it.status == JobStatus.Running }
        if (running.isNotEmpty() && on("job")) a += Activity(ActivityKind.Job, running.first().title, running.first().line.ifEmpty { if (running.size > 1) "${running.size} running" else "Working" })
        if (media?.hasSession == true && on("music")) a += Activity(ActivityKind.Music, media.title, media.artist)
        if (due.isNotEmpty() && on("reminder")) a += Activity(ActivityKind.Reminder, due.first().title, due.first().sub)
        if (pc.paired && on("pc")) a += Activity(ActivityKind.Pc, pc.name.ifEmpty { "Your PC" }, if (pc.connected) "Connected" else "Not connected")
        a.sortByDescending { it.kind.prio }
        return a.ifEmpty { listOf(Activity(ActivityKind.Idle, "Lokey", "Ready")) }
    }

    private fun voiceLabel(a: Assistant, d: Dictation?) = when {
        d != null && d.phase == DictPhase.Working -> "Cleaning up dictation"
        d != null && d.phase == DictPhase.Listening -> "Dictating"
        a.state == VoiceState.Listening || a.state == VoiceState.Connecting -> "Listening"
        a.state == VoiceState.Thinking -> "Thinking"
        a.state == VoiceState.Speaking -> "Speaking"
        a.convo -> "Conversation mode"
        else -> "Voice"
    }
}

/** the spirit's pose follows what is going on (PhoneApp.tsx) */
fun spiritMode(state: VoiceState, dict: DictPhase?): SoulMode = when {
    dict == DictPhase.Working -> SoulMode.WRITING
    dict == DictPhase.Listening || state == VoiceState.Listening || state == VoiceState.Connecting -> SoulMode.HEARING
    state == VoiceState.Thinking -> SoulMode.THINKING
    state == VoiceState.Speaking -> SoulMode.TALKING
    else -> SoulMode.LISTENING
}

/** Answers of the LokeyNative plugin: a failure is a value `{ok:false, reason}` (PLUGIN.md), never an exception. */
object NativeResult {
    fun failed(r: Any?) = r is JSONObject && r.has("ok") && !r.optBoolean("ok", true)
    fun reason(r: Any?): String? = (r as? JSONObject)?.takeIf { failed(it) }?.optString("reason")?.ifEmpty { null }
    /** "permission needed: contacts (perm.request contacts)" -> "contacts" */
    fun needsPerm(r: Any?): String? = reason(r)?.let { Regex("permission needed: ([A-Za-z0-9_-]+)").find(it)?.groupValues?.get(1) }

    /** perm.status with no name: `{permissions:{mic:true,...}}`, or per name `{name, granted}`; also tolerates plain `{mic:true}` and `{mic:{granted:true}}` */
    fun granted(all: Any?, name: String): Boolean? {
        val o = all as? JSONObject ?: return null
        val m = o.optJSONObject("permissions") ?: o.optJSONObject("perms") ?: o
        if (!m.has(name)) return if (o.optString("name") == name && o.has("granted")) o.optBoolean("granted") else null
        return when (val v = m.opt(name)) { is Boolean -> v; is JSONObject -> v.optBoolean("granted"); else -> null }
    }
}
