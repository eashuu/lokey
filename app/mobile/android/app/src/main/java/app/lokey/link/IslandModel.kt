package app.lokey.link

import org.json.JSONObject

data class FaceAction(val id: String, val label: String, val primary: Boolean = false)

/** One thing the island can show: a voice session, a timer, a job, an approval, music... Sent by the page with `island.update`. */
data class Face(
    val id: String, val kind: String, val title: String, val subtitle: String = "",
    val progress: Double? = null, val startAt: Long? = null, val endAt: Long? = null, val icon: String? = null,
    val actions: List<FaceAction> = emptyList(), val priority: Int = 0,
)

data class Update(val faces: List<Face>, val primary: String?, val spirit: String?)

/** Pure logic (no Android types), unit tested on the JVM: payload parsing, ordering, cycling, countdown text, default controls. */
object IslandModel {
    val KINDS = setOf("voice", "music", "timer", "job", "approval", "pc", "reminder", "charging", "idle")
    /** kinds that also become a Live Update notification (music has the system media notification; charging / idle are not worth one) */
    val LIVE_KINDS = setOf("voice", "timer", "job", "approval", "pc", "reminder")

    fun parse(j: JSONObject): Update {
        val a = j.optJSONArray("faces")
        val faces = ArrayList<Face>()
        if (a != null) for (i in 0 until a.length()) {
            val f = a.optJSONObject(i) ?: continue
            val id = f.optString("id", ""); if (id.isEmpty()) continue
            val kind = f.optString("kind", "idle").let { if (it in KINDS) it else "idle" }
            val acts = f.optJSONArray("actions")?.let { aa -> (0 until aa.length()).mapNotNull { k -> aa.optJSONObject(k) }.filter { x -> x.optString("id").isNotEmpty() }
                .map { x -> FaceAction(x.optString("id"), x.optString("label", x.optString("id")), x.optBoolean("primary")) } }.orEmpty()
            faces += Face(id, kind, f.optString("title", ""), f.optString("subtitle", ""),
                if (f.has("progress") && !f.isNull("progress")) f.optDouble("progress").coerceIn(0.0, 1.0) else null,
                if (f.has("startAt") && !f.isNull("startAt")) f.optLong("startAt") else null,
                if (f.has("endAt") && !f.isNull("endAt")) f.optLong("endAt") else null,
                f.optString("icon", "").ifEmpty { null }, acts, f.optInt("priority", 0))
        }
        return Update(faces.distinctBy { it.id }, j.optString("primary", "").ifEmpty { null }, j.optString("spirit", "").ifEmpty { null })
    }

    /** primary first, then higher priority first; ties keep the order they were sent in */
    fun order(faces: List<Face>, primary: String?): List<Face> =
        faces.withIndex().sortedWith(compareByDescending<IndexedValue<Face>> { it.value.id == primary }.thenByDescending { it.value.priority }.thenBy { it.index }).map { it.value }

    /** the id after `current` in `dir` (+1 / -1), wrapping; the first when `current` is gone */
    fun cycle(order: List<Face>, current: String?, dir: Int): String? {
        if (order.isEmpty()) return null
        val i = order.indexOfFirst { it.id == current }
        return if (i < 0) order[0].id else order[Math.floorMod(i + dir, order.size)].id
    }

    /** 1:05 -> "01:05", 1h02m -> "1:02:05"; never negative */
    fun countdown(ms: Long): String {
        val s = (maxOf(0, ms) + 999) / 1000
        val h = s / 3600; val m = (s % 3600) / 60; val sec = s % 60
        return if (h > 0) java.lang.String.format(java.util.Locale.ROOT, "%d:%02d:%02d", h, m, sec) else java.lang.String.format(java.util.Locale.ROOT, "%02d:%02d", m, sec)
    }

    /** 0..1 for the bar / ring: explicit progress, else elapsed over (startAt..endAt), else null (indeterminate) */
    fun progressOf(f: Face, now: Long): Double? {
        f.progress?.let { return it }
        val s = f.startAt; val e = f.endAt
        return if (s != null && e != null && e > s) ((now - s).toDouble() / (e - s)).coerceIn(0.0, 1.0) else null
    }

    /** the controls a card shows when the page sent none */
    fun defaultActions(kind: String): List<FaceAction> = when (kind) {
        "timer" -> listOf(FaceAction("toggle", "Pause"), FaceAction("plus1", "+1 min"), FaceAction("stop", "Stop", true))
        "job" -> listOf(FaceAction("stop", "Stop", true))
        "approval" -> listOf(FaceAction("deny", "Deny"), FaceAction("allow", "Allow", true))
        "reminder" -> listOf(FaceAction("snooze", "Snooze"), FaceAction("done", "Done", true))
        "pc" -> listOf(FaceAction("ask", "Ask", true))
        else -> emptyList()
    }

    fun actionsOf(f: Face): List<FaceAction> = f.actions.ifEmpty { defaultActions(f.kind) }

    /** page faces plus the natively derived music face, unless the page already sent a music face */
    fun merge(page: List<Face>, nativeMusic: Face?): List<Face> =
        if (nativeMusic == null || page.any { it.kind == "music" }) page else page + nativeMusic

    /** what the island shows: everything except idle faces (those only count when the user wants the island always visible) */
    fun visible(all: List<Face>, alwaysVisible: Boolean): List<Face> {
        val real = all.filter { it.kind != "idle" }
        return if (real.isNotEmpty() || !alwaysVisible) real else all.filter { it.kind == "idle" }.take(1)
    }

    /** status-bar chip text for a Live Update (7 characters at most); null = let the chronometer show */
    fun chip(f: Face): String? = when (f.kind) {
        "timer" -> if (f.endAt != null) null else f.title.take(7)
        "voice" -> f.title.take(7).ifEmpty { "Lokey" }
        "approval" -> "Allow?"
        "reminder" -> "Due"
        "pc" -> "PC"
        "job" -> progressOf(f, 0)?.let { "${(it * 100).toInt()}%" } ?: "Busy"
        else -> null
    }
}
