package app.lokey.link

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The phone's own memory: short facts about you, kept on this phone (filesDir/memory.json). Works without the PC; when paired,
 * Sync merges it with the PC's memory in both directions (duplicates collapse by wording).
 */
object Mem {
    class Fact(val text: String, val kind: String, val at: Long, var pinned: Boolean)

    private val secret = Regex("(?i)(password|passcode|otp|pin\\b|cvv|api[ _-]?key|secret|token)|\\b\\d{12,19}\\b")
    private fun file(c: Context) = File(c.filesDir, "memory.json")
    private fun norm(s: String) = s.lowercase().replace(Regex("[^\\p{L}\\p{N} ]"), " ").split(' ').filter { it.length > 1 }.toSet()
    private fun same(a: String, b: String): Boolean { val x = norm(a); val y = norm(b); if (x.isEmpty() || y.isEmpty()) return false; return x.intersect(y).size.toDouble() / x.union(y).size >= 0.8 }

    @Synchronized fun all(c: Context): MutableList<Fact> {
        val out = mutableListOf<Fact>()
        runCatching {
            val a = JSONArray(file(c).takeIf { it.exists() }?.readText() ?: "[]")
            for (i in 0 until a.length()) a.getJSONObject(i).let { out += Fact(it.getString("text"), it.optString("kind", "fact"), it.optLong("at"), it.optBoolean("pinned")) }
        }
        return out
    }

    @Synchronized private fun save(c: Context, l: List<Fact>) =
        file(c).writeText(JSONArray().also { a -> l.forEach { a.put(JSONObject().put("text", it.text).put("kind", it.kind).put("at", it.at).put("pinned", it.pinned)) } }.toString())

    /** true when it was new */
    @Synchronized fun add(c: Context, text: String, kind: String = "fact", at: Long = System.currentTimeMillis()): Boolean {
        val t = text.replace(Regex("\\s+"), " ").trim().take(300)
        if (t.length < 3 || secret.containsMatchIn(t)) return false
        val l = all(c)
        if (l.any { same(it.text, t) }) return false
        l += Fact(t, kind, at, false); save(c, l); Store.touchMem(c)
        return true
    }

    @Synchronized fun forget(c: Context, text: String): Int {
        val q = text.lowercase().trim(); if (q.length < 3) return 0
        val l = all(c); val keep = l.filter { !it.text.lowercase().contains(q) }
        if (keep.size != l.size) { save(c, keep); Store.touchMem(c) }
        return l.size - keep.size
    }

    /** facts that share words with the query, best first; no query = the pinned and newest ones */
    fun search(c: Context, query: String?, k: Int = 8): List<Fact> {
        val l = all(c)
        if (query.isNullOrBlank()) return l.sortedWith(compareByDescending<Fact> { it.pinned }.thenByDescending { it.at }).take(k)
        val q = norm(query)
        return l.map { it to norm(it.text).intersect(q).size }.filter { it.second > 0 }.sortedByDescending { it.second }.take(k).map { it.first }
    }

    // ---- sync with the PC ----
    /** pull what the PC knows, push what only the phone knows. Returns (pulled, pushed). */
    fun sync(c: Context): Pair<Int, Int> {
        if (!Store.paired(c)) return 0 to 0
        val remote = Api.facts(c) ?: return 0 to 0
        var pulled = 0
        for (r in remote) if (add(c, r.first, r.second)) pulled++
        val have = remote.map { it.first }
        val mine = all(c).filter { f -> have.none { same(it, f.text) } }
        val pushed = if (mine.isEmpty()) 0 else Api.pushFacts(c, mine.map { it.text to it.kind })
        return pulled to pushed
    }
}
