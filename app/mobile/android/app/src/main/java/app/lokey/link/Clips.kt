package app.lokey.link

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Clipboard history. Android 10+ only lets the foreground app read the clipboard, so items are captured while Lokey is open
 * (on resume and on every clip change it can see); there is no background capture. Text and links only.
 */
object Clips {
    private val file get() = File(App.ctx.filesDir, "clips.json")
    private val cm get() = App.ctx.getSystemService(ClipboardManager::class.java)
    private var items: MutableList<JSONObject>? = null
    private var listening = false

    @Synchronized private fun all(): MutableList<JSONObject> = items ?: runCatching {
        val a = JSONArray(file.readText()); MutableList(a.length()) { a.getJSONObject(it) }
    }.getOrDefault(mutableListOf()).also { items = it }

    private fun save() = runCatching { file.writeText(JSONArray(all()).toString()) }

    fun retentionMs() = App.prefs.getInt("clip_days", 7) * 86400_000L

    fun current(): String? = runCatching { cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(App.ctx)?.toString() }.getOrNull()

    @Synchronized fun capture() {
        val t = current()?.takeIf { it.isNotBlank() } ?: return
        val l = all()
        if (l.firstOrNull()?.optString("text") == t) return
        val it = obj("id" to java.lang.Long.toString(System.nanoTime(), 36), "text" to t, "at" to System.currentTimeMillis(), "pinned" to false)
        l.add(0, it)
        val cut = System.currentTimeMillis() - retentionMs()
        l.removeAll { x -> !x.optBoolean("pinned") && x.optLong("at") < cut }
        while (l.size > 300) l.removeAt(l.size - 1)
        save()
        Events.emit("clipboard.changed", view(it))
    }

    fun listen() {
        if (listening) return; listening = true
        cm.addPrimaryClipChangedListener { capture() }
    }

    private fun view(o: JSONObject): JSONObject {
        val t = o.optString("text")
        return obj("id" to o.getString("id"), "kind" to (if (t.trim().let { it.startsWith("http://") || it.startsWith("https://") } && !t.trim().contains(' ')) "link" else "text"), "preview" to t.take(400), "image" to null,
            "source" to "", "at" to o.optLong("at"), "pinned" to o.optBoolean("pinned"), "size" to t.toByteArray().size)
    }

    @Synchronized fun list(q: String, kind: String, limit: Int): JSONArray {
        capture()
        val n = q.trim().lowercase()
        return arr(all().map(::view).filter { (kind.isEmpty() || it.getString("kind") == kind) && (n.isEmpty() || it.getString("preview").lowercase().contains(n)) }
            .sortedWith(compareByDescending<JSONObject> { it.getBoolean("pinned") }.thenByDescending { it.getLong("at") }).take(limit))
    }

    @Synchronized fun get(id: String): JSONObject = obj("id" to id, "text" to all().firstOrNull { it.getString("id") == id }?.optString("text"), "image" to null)

    @Synchronized fun pin(id: String, on: Boolean) { all().firstOrNull { it.getString("id") == id }?.put("pinned", on); save() }
    @Synchronized fun delete(id: String) { all().removeAll { it.getString("id") == id }; save() }
    @Synchronized fun clear(keepPinned: Boolean) { all().removeAll { !keepPinned || !it.optBoolean("pinned") }; save() }
    fun settings(days: Int, autoPaste: Boolean) { App.prefs.edit().putInt("clip_days", days.coerceAtLeast(1)).putBoolean("clip_autopaste", autoPaste).apply() }

    fun set(text: String): JSONObject {
        main { cm.setPrimaryClip(ClipData.newPlainText("Lokey", text)) }
        return ok()
    }

    /** puts the item on the clipboard; with autoPaste on and the accessibility service running, pastes it into the focused field too */
    fun paste(id: String): JSONObject {
        val t = get(id).optString("text").takeIf { it.isNotEmpty() } ?: return fail("item not found")
        set(t)
        if (App.prefs.getBoolean("clip_autopaste", false)) LokeyAccess.instance?.let { Ui.pasteFocused() }
        return ok()
    }
}
