package app.lokey.link.core

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** Pure logic behind the screens, so it can be tested without a phone. */

data class Notif(val key: String, val pkg: String, val app: String, val title: String, val text: String, val time: Long, val canReply: Boolean)
data class NotifGroup(val app: String, val items: List<Notif>)

object Notifs {
    fun parse(a: JSONArray): List<Notif> = a.objects().map { Notif(it.str("key"), it.str("package"), it.str("app"), it.str("title"), it.str("text"), it.long("time"), it.bool("canReply")) }

    /** grouped by app, groups ordered by their newest notification, items newest first (Inbox.tsx) */
    fun group(list: List<Notif>): List<NotifGroup> =
        list.sortedByDescending { it.time }.groupBy { it.app.ifEmpty { it.pkg } }.map { NotifGroup(it.key, it.value) }

    /** the text the assistant is asked to summarise */
    fun summaryPrompt(app: String, list: List<Notif>): String =
        "Summarise my $app notifications in two or three lines and say if anything needs a reply:\n" + list.take(12).joinToString("\n") { "- ${it.title}: ${it.text}" }

    fun replyPrompt(n: Notif): String =
        "Draft a short reply, in my own voice and style, to this ${n.app} message from \"${n.title}\": \"${n.text}\". Answer with ONLY the reply text, nothing else."

    /** why the list is empty: the permission it needs, or the plugin's own reason */
    fun blocked(r: Any?): String? = when {
        r is JSONArray -> null
        NativeResult.needsPerm(r) != null -> "notification-listener"
        NativeResult.reason(r)?.contains("listener", true) == true -> "notification-listener"
        else -> NativeResult.reason(r)?.let { "other:$it" }
    }
}

object Fmt {
    fun ago(now: Long, t: Long): String {
        val s = ((now - t) / 1000).coerceAtLeast(0)
        return when {
            s < 45 -> "now"
            s < 3600 -> "${Math.max(1, s / 60)} min"
            s < 86_400 -> "${s / 3600} h"
            else -> "${s / 86_400} d"
        }
    }

    /** Today / Tomorrow / Yesterday / weekday name / date, for a time relative to now */
    fun dayWord(t: Long, now: Long, zone: ZoneId = ZoneId.systemDefault()): String {
        val d = Instant.ofEpochMilli(t).atZone(zone).toLocalDate()
        val n = ChronoUnit.DAYS.between(Instant.ofEpochMilli(now).atZone(zone).toLocalDate(), d)
        return when {
            n == 0L -> "Today"
            n == 1L -> "Tomorrow"
            n == -1L -> "Yesterday"
            n in 2..6 -> d.dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.getDefault())
            else -> d.format(java.time.format.DateTimeFormatter.ofPattern("d MMM", java.util.Locale.getDefault()))
        }
    }

    fun battery(b: Any?): String? {
        val o = b as? JSONObject
        val pct = (if (o != null) o.optDouble("pct", Double.NaN) else (b as? Number)?.toDouble()) ?: return null
        if (pct.isNaN()) return null
        return "${Math.round(pct)}%" + if (o?.optBoolean("charging") == true) " (charging)" else ""
    }

    /** "5 s ago", "3 min ago", "2 h ago", "never" for the diagnostics lines */
    fun age(ms: Any?): String = (ms as? Number)?.toLong()?.let {
        when { it < 60_000 -> "${Math.round(it / 1000.0)} s ago"; it < 3_600_000 -> "${Math.round(it / 60_000.0)} min ago"; else -> "${Math.round(it / 3_600_000.0)} h ago" }
    } ?: "never"
    fun since(now: Long, t: Any?): String = (t as? Number)?.let { age(now - it.toLong()) } ?: "never"
}

enum class Level { Ok, Warn, Bad, Off }
data class HealthRow(val title: String, val level: Level, val text: String, val fixLabel: String? = null, val fixPerm: String? = null)

/** Settings > Island > Background health, in plain words (phone/settings.tsx BackgroundHealth) */
object Health {
    fun rows(d: JSONObject, now: Long): List<HealthRow> {
        val hb = d.opt("jsHeartbeatAgeMs") as? Number
        val rows = ArrayList<HealthRow>()
        rows += HealthRow("Background service", if (d.optBoolean("serviceRunning")) Level.Ok else Level.Bad,
            if (d.optBoolean("serviceRunning")) "Running${if (d.optBoolean("serviceMic")) ", microphone allowed" else ""}." else "Not running. Open Lokey once to start it.")
        val overlayDenied = d.has("overlayGranted") && !d.optBoolean("overlayGranted")
        rows += HealthRow("Island over other apps",
            when { overlayDenied -> Level.Bad; d.optBoolean("overlayShown") -> Level.Ok; d.optBoolean("appForeground") -> Level.Off; else -> Level.Warn },
            when {
                overlayDenied -> "Needs \"draw over other apps\"."
                d.optBoolean("overlayShown") -> "Showing."
                else -> "Not showing: ${d.strOrNull("overlayReason") ?: if (d.optBoolean("appForeground")) "Lokey is in front" else "unknown"}."
            }, "Allow", "overlay")
        rows += HealthRow("The app page", if (hb != null && hb.toLong() < 45_000) Level.Ok else Level.Warn,
            if (hb != null) "Last heartbeat ${Fmt.age(hb)}." else "No heartbeat yet (normal when the app was closed).")
        rows += HealthRow("Wake-up",
            when { !d.optBoolean("wakeEnabled") -> Level.Off; d.strOrNull("wakeError") != null -> Level.Bad; d.optBoolean("wakeListening") -> Level.Ok; else -> Level.Warn },
            when {
                !d.optBoolean("wakeEnabled") -> "Off in settings."
                d.strOrNull("wakeError") != null -> d.str("wakeError")
                d.optBoolean("wakeListening") -> "Listening. Last heard ${Fmt.since(now, d.opt("wakeLastEventAt"))}${d.strOrNull("wakeLastDecision")?.let { ": $it" } ?: ""}."
                d.optBoolean("wakePaused") -> "Paused."
                else -> "Not listening right now."
            })
        rows += HealthRow("Link to your PC",
            when { !d.optBoolean("linkPaired") -> Level.Off; d.optBoolean("linkConnected") -> Level.Ok; else -> Level.Warn },
            when {
                !d.optBoolean("linkPaired") -> "Not paired."
                d.optBoolean("linkConnected") -> "Connected. Last news ${Fmt.since(now, d.opt("linkLastEventAt"))}."
                else -> "Not connected. Last news ${Fmt.since(now, d.opt("linkLastEventAt"))}."
            })
        rows += HealthRow("Battery", if (d.optBoolean("batteryExempt")) Level.Ok else Level.Warn,
            if (d.optBoolean("batteryExempt")) "Not restricted." else "Android may stop Lokey in the background. Set it to no restrictions.", "Fix", "battery")
        if (Regex("vivo|iqoo", RegexOption.IGNORE_CASE).containsMatchIn(d.strOrNull("manufacturer") ?: d.str("brand")))
            rows += HealthRow("Autostart (vivo)", Level.Warn, "Allow Lokey to start by itself, and in background power settings choose no restrictions.", "Open", "autostart")
        return rows
    }
}

/** The permission flow of onboarding and Settings > Permissions. Names are the plugin's (perm.names), not the renderer's older spellings. */
data class PermSpec(val name: String, val title: String, val why: String, val special: Boolean = false)

object Perm {
    val Core = listOf(
        PermSpec("mic", "Microphone", "So I can hear you: hold to talk, conversation mode."),
        PermSpec("notifications", "Notifications", "Reminders, finished jobs, the always-there card."),
        PermSpec("overlay", "Draw over other apps", "Show the island on top of other apps.", true),
        PermSpec("notification-listener", "Notification access", "Music on the island, lyrics and your Inbox.", true),
        PermSpec("accessibility", "Accessibility service", "Tap, type and read the screen for you; dictation into any app.", true),
        PermSpec("battery", "Battery: no restrictions", "Keeps the wake word, reminders and the PC link alive in the background.", true),
    )
    val Extra = listOf(
        PermSpec("live_updates", "Live updates", "Timers, music and approvals as Android 16 live notifications.", true),
        PermSpec("autostart", "Autostart", "Lets Lokey start by itself after a restart (vivo and iQOO: also set background power to no restrictions).", true),
    )
    /** perm.status answers by canonical name; "battery" is reported as battery-optimisation-exempt */
    fun granted(all: Any?, name: String): Boolean = NativeResult.granted(all, name) ?: (if (name == "battery") NativeResult.granted(all, "battery-optimisation-exempt") else null) ?: false
}

/** "Allow restricted settings" is only needed where Android greys these out; the hint is shown when the plain request did not take */
fun needsRestrictedHint(name: String, grantedAfterRequest: Boolean) = !grantedAfterRequest && (name == "accessibility" || name == "notification-listener")

/** shizuku.status as plain steps */
data class ShizukuStep(val n: Int, val title: String, val hint: String, val done: Boolean)
object Shizuku {
    fun steps(st: JSONObject?): List<ShizukuStep> = listOf(
        ShizukuStep(1, "Install Shizuku", "From shizuku.rikka.app or its GitHub releases (it is not on Play Store).", st?.optBoolean("installed") == true),
        ShizukuStep(2, "Start it", "Developer options > turn on Wireless debugging. In Shizuku: Start via wireless debugging > Pairing, then Start. Needs Wi-Fi once; repeat after a restart.", st?.optBoolean("running") == true),
        ShizukuStep(3, "Allow Lokey", "Shizuku asks once whether Lokey may use it.", st?.optBoolean("permissionGranted") == true),
    )
    fun status(st: JSONObject?): String = when {
        st == null -> "Checking..."
        st.strOrNull("reason") != null -> st.str("reason")
        st.has("canCreateDisplay") && !st.isNull("canCreateDisplay") && !st.optBoolean("canCreateDisplay") -> "Shizuku works, but a second screen could not be created."
        else -> "Ready."
    }
}

/** `Patch.of(listOf("voice","speakReplies"), true)` -> {"voice":{"speakReplies":true}}, the DeepPartial the settings bridge takes */
object Patch {
    fun of(path: List<String>, value: Any?): JSONObject {
        var v: Any? = value
        for (k in path.asReversed()) v = JSONObject().put(k, v ?: JSONObject.NULL)
        return v as JSONObject
    }
}

/** the three ways to talk in onboarding and Settings > Voice (phone/Onboarding.tsx LANGS) */
enum class Lang(val id: String, val title: String, val sub: String, val language: String, val script: String) {
    English("en", "English", "Answers in English; dictation is translated to English.", "en", "english"),
    Tamil("ta", "Tamil", "Answers in Tamil; dictation in Tamil letters, English words kept.", "ta", "mixed"),
    Tanglish("tanglish", "Tanglish", "Tamil in English letters, the way you text.", "ta", "roman"),
    Auto("auto", "Follow me", "Answers in whatever language you speak.", "auto", "mixed");

    fun patch(): JSONObject = Patch.of(listOf("voice"), JSONObject().put("language", language).put("dictationScript", script))
    companion object {
        fun of(language: String, script: String): Lang = when {
            language == "en" -> English
            language == "ta" -> if (script == "roman") Tanglish else Tamil
            else -> Auto
        }
    }
}

object Accent {
    /** swatches for Settings > Appearance; null = follow the spirit's colour */
    val Presets = listOf("Spirit" to null, "Gold" to "#d9b556", "Rose" to "#ff7fb8", "Violet" to "#b97cff", "Green" to "#4fd6a0", "Blue" to "#5ab0ff", "Orange" to "#ff8a3d")
    fun valid(hex: String) = Regex("^#[0-9a-fA-F]{6}$").matches(hex)
    fun value(hex: String?): String = hex ?: "wallpaper"
}

object Wake {
    /** clap sensitivity runs 0.5 (sharp clap) to 1.5 (soft claps); the slider is 0..1 */
    fun sensToSlider(v: Double) = ((v - 0.5) / 1.0).coerceIn(0.0, 1.0).toFloat()
    fun sliderToSens(f: Float) = Math.round((0.5 + f) * 20) / 20.0
    fun confToSlider(v: Double) = ((v - 0.5) / 0.45).coerceIn(0.0, 1.0).toFloat()
    fun sliderToConf(f: Float) = Math.round((0.5 + f * 0.45) * 100) / 100.0
    fun actionLabel(a: String) = when (a) { "listen" -> "Starts listening"; "greet" -> "Greets you"; else -> "Welcome and catch-up" }
}

/** Settings > Island: which activities show (approvals always do) */
object IslandKinds {
    val Optional = listOf("voice" to "Voice", "timer" to "Timer", "job" to "Background jobs", "music" to "Now playing", "reminder" to "Reminders and nudges", "charging" to "Charging and battery", "pc" to "Your PC")
    fun toggle(current: Set<String>?, kind: String, on: Boolean): List<String> {
        val base = current ?: Optional.map { it.first }.toSet() + "approval"
        return (if (on) base + kind else base - kind).toList()
    }
}
