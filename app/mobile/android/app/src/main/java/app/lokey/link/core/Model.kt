package app.lokey.link.core

/** What the screens see of the assistant. Plain data: the same types come from [WebCore] and [FakeCore]. */
enum class VoiceState {
    Idle, Connecting, Listening, Thinking, Speaking, Error;
    companion object { fun parse(s: String?): VoiceState = entries.firstOrNull { it.name.equals(s, true) } ?: Idle }
}

/** assistant = the conversation; dictation and lasso (circle to ask) use the same microphone but are not shown as chat */
data class Assistant(val state: VoiceState = VoiceState.Idle, val kind: String = "assistant", val convo: Boolean = false, val caption: String? = null)

enum class MsgKind { Said, Reply, Notice, Error }
data class ChatMsg(val id: Long, val kind: MsgKind, val text: String, val final: Boolean, val at: Long, val typed: Boolean = false)

enum class DictPhase { Listening, Working, Done, Error }
data class Dictation(val phase: DictPhase, val raw: String = "", val text: String = "")

enum class ApprovalSource { Local, Pc }
/** an "are you sure?" the assistant (Local) or the paired PC (Pc) is waiting on */
data class Approval(val id: String, val title: String, val detail: String, val tool: String = "", val timeoutMs: Long = 30_000, val image: String? = null, val source: ApprovalSource = ApprovalSource.Local)

enum class JobStatus { Running, Done, Failed, Stopped }
data class Job(val id: String, val kind: String, val title: String, val status: JobStatus, val line: String = "", val result: String? = null, val startedAt: Long = 0)

enum class TodayKind { Task, Loop, Reminder }
/** one line of Today: a scheduled task, an open loop that has a due time, a reminder that fired. [atMs] null = no time */
data class TodayItem(val id: String, val title: String, val kind: TodayKind, val atMs: Long?, val sub: String = "", val repeat: String? = null)

data class PcStatus(val paired: Boolean = false, val connected: Boolean = false, val name: String = "", val agent: String = "", val jobs: List<String> = emptyList(), val playing: String? = null)

data class Media(
    val hasSession: Boolean = false, val app: String = "", val title: String = "", val artist: String = "", val playing: Boolean = false,
    val positionMs: Long = 0, val durationMs: Long = 0, val sampledAt: Long = 0, val canNext: Boolean = false, val canPrev: Boolean = false,
    /** a data: URL, at most 320 px */
    val art: String? = null,
) {
    /** where the track is now, extrapolated from the sample while it plays */
    fun positionAt(now: Long): Long = (if (playing && sampledAt > 0) positionMs + (now - sampledAt) else positionMs).coerceIn(0, if (durationMs > 0) durationMs else Long.MAX_VALUE)
}

/** the live things the home screen shows as the "face", highest priority first (phone/activities.ts PRIO) */
enum class ActivityKind(val prio: Int, val label: String) {
    Charging(110, "Battery"), Approval(100, "Approval"), Voice(90, "Voice"), Timer(80, "Timer"), Job(70, "Background job"), Music(60, "Now playing"), Reminder(50, "Reminder"), Pc(20, "Your PC"), Idle(0, "Idle")
}
data class Activity(val kind: ActivityKind, val title: String, val sub: String = "")

/** the parts of the settings the native UI reads. [dark] null = follow the system; [accent] null = the default gold */
data class SettingsSnapshot(
    val dark: Boolean? = null,
    val accent: Long? = null,
    val skin: String = "puff",
    val calmSpirit: Boolean = false,
    val haptics: Boolean = true,
    val reduceMotion: Boolean = false,
    val activities: Set<String>? = null,
    val loaded: Boolean = false,
    val wakeList: List<Pair<String, String>> = emptyList(),
    /** the settings as the core sent them (screens read the rest of it from here) */
    val raw: org.json.JSONObject = org.json.JSONObject(),
)

data class Notice(val text: String, val error: Boolean = false)

sealed interface CoreStatus {
    data object Booting : CoreStatus
    data class Ready(val kind: String) : CoreStatus
    data class Failed(val error: String) : CoreStatus
}

/** spirit pose names the Home spirit uses (island/store.ts SoulMode) */
enum class SoulMode { MUTED, LISTENING, HEARING, THINKING, TALKING, YAWNING, WRITING, LOOKING }
