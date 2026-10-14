package app.lokey.link

import org.json.JSONObject

/** Pure decisions (no Android types, JVM-tested). The native layer decides these on its own; the page is never needed for them. */
object IslandPolicy {
    data class Decision(val show: Boolean, val reason: String)

    /**
     * Should the overlay island be on screen? It shows whenever Lokey is not in the foreground, enabled and permitted, and there is something
     * to show (an idle face counts when the user keeps it always visible). Fullscreen apps are NOT detected (the insets trick hid the overlay and
     * its touches on a real phone); landscape and the lock screen hide it, except for an approval.
     */
    fun decide(enabled: Boolean, granted: Boolean, hasFaces: Boolean, foreground: Boolean, portrait: Boolean, locked: Boolean, hasApproval: Boolean): Decision = when {
        !enabled -> Decision(false, "off: the system island is switched off in settings")
        !granted -> Decision(false, "off: overlay permission (Display over other apps) is not granted")
        foreground -> Decision(false, "hidden: Lokey is in the foreground (the in-app island shows)")
        !portrait -> Decision(false, "hidden: landscape")
        !hasFaces -> Decision(false, "hidden: nothing to show")
        locked && !hasApproval -> Decision(false, "hidden: lock screen / screen off (only approvals show there)")
        else -> Decision(true, "shown")
    }

    const val TTL_MS = 120_000L

    /**
     * A face the page sent stays alive while the page keeps refreshing it. Faces with an end time (timers, reminders, focus) keep running on
     * their own until 30 s after it, so a frozen page cannot strand them nor kill them early. Nothing lives past 8 h.
     */
    fun alive(f: Face, receivedAt: Long, now: Long, ttl: Long = TTL_MS): Boolean {
        if (now - receivedAt > 8 * 3600_000L) return false
        val end = f.endAt
        return if (end != null) now < end + 30_000 else now - receivedAt < ttl
    }

    /** native link faces are dropped when the page already shows the same approval (same title and text), so nothing shows twice */
    fun mergeLink(page: List<Face>, link: List<Face>): List<Face> =
        page + link.filter { l -> page.none { it.kind == l.kind && it.title == l.title && it.subtitle == l.subtitle } }
}

object WakePolicy {
    /** what to do with a detection: ignore it, tell the page (app in front), or launch the app first (app not in front) */
    fun decide(wanted: Boolean, voiceSession: Boolean, foreground: Boolean, now: Long, lastFire: Long, cooldownMs: Long = 2500): String = when {
        !wanted -> "ignore: wake is off or paused"
        voiceSession -> "ignore: a voice session is running"
        now - lastFire < cooldownMs -> "ignore: cooldown"
        foreground -> "emit: app in front, told the page"
        else -> "launch: app not in front, started it"
    }
}

object LinkParse {
    /** the PC's `confirm` event {id,title,detail} as an island approval face */
    fun confirmFace(j: JSONObject): Face? {
        val id = j.optString("id").ifEmpty { return null }
        return Face("link-$id", "approval", j.optString("title", "Lokey asks"), j.optString("detail").lineSequence().firstOrNull().orEmpty(), priority = 90,
            actions = listOf(FaceAction("deny", "Deny"), FaceAction("allow", "Allow", true)))
    }

    fun cardId(faceId: String): String? = faceId.removePrefix("link-").takeIf { faceId.startsWith("link-") && it.isNotEmpty() && faceId != "link-status" }

    /** the PC's /status as a quiet "PC is busy" face; null when idle or unknown */
    fun statusFace(j: JSONObject): Face? {
        val agent = j.optString("agent", "idle")
        return if (agent == "idle" || agent.isEmpty()) null else Face("link-status", "pc", "Lokey on your PC", agent, priority = 20)
    }
}
