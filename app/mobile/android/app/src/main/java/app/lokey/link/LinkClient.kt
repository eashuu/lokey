package app.lokey.link

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * A native Lokey Link client (the same protocol the page's link client speaks: SSE GET /events with a Bearer token, POST /approve, GET /status)
 * so approvals and the PC's state reach the island and notifications while the WebView is frozen or the app is closed. The page hands over the
 * credentials with `link.credentials {base, token}` (null = unpaired); they are stored sealed with the Keystore key.
 * Reconnects with backoff; 401 means the PC revoked this phone, the credentials are dropped.
 */
object LinkClient {
    @Volatile var connected = false
    @Volatile var lastEventAt = 0L
    private val cards = ConcurrentHashMap<String, Face>()
    @Volatile private var status: Face? = null
    @Volatile private var run = false
    private var thread: Thread? = null

    private fun sp() = App.ctx.getSharedPreferences("lokey_link", android.content.Context.MODE_PRIVATE)

    fun creds(): Pair<String, String>? = runCatching {
        val s = sp().getString("cred", null) ?: return null
        JSONObject(Secrets.open(s)).let { it.getString("base") to it.getString("token") }
    }.getOrNull()

    fun hasCreds() = sp().contains("cred")

    fun faces(): List<Face> = cards.values.sortedBy { it.id } + listOfNotNull(status)

    /** "192.168.1.20:47831" or a full address -> "http://192.168.1.20:47831" */
    fun normalise(s: String): String { var t = s.trim().trimEnd('/'); if (!t.startsWith("http")) t = "http://$t"; return t }

    fun set(base: String?, token: String?): JSONObject {
        if (base.isNullOrBlank() || token.isNullOrBlank()) { sp().edit().remove("cred").apply(); stop(); cards.clear(); status = null; Island.nativeChanged(); return ok("paired" to false) }
        sp().edit().putString("cred", Secrets.seal(JSONObject().put("base", normalise(base)).put("token", token).toString())).apply()
        stop(); start()
        LokeyService.sync(App.ctx)
        return ok("paired" to true)
    }

    @Synchronized fun start() {
        if (run || creds() == null) return
        run = true
        thread = Thread({ loop() }, "lokey-link").also { it.isDaemon = true; it.start() }
    }

    @Synchronized fun stop() { run = false; thread?.interrupt(); thread = null; connected = false }

    private fun call(base: String, token: String, path: String, method: String, body: JSONObject?): Pair<Int, String> {
        val c = URL(base + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method; c.connectTimeout = 8000; c.readTimeout = 8000
            c.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) { c.doOutput = true; c.setRequestProperty("Content-Type", "application/json"); c.outputStream.use { it.write(body.toString().toByteArray()) } }
            val code = c.responseCode
            return code to ((if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: "")
        } finally { c.disconnect() }
    }

    /** Allow / Deny from the overlay, a notification or the widget; works with the app closed */
    fun answer(faceId: String, allow: Boolean) {
        val id = LinkParse.cardId(faceId) ?: return
        Thread {
            val (base, token) = creds() ?: return@Thread
            val ok = runCatching { call(base, token, "/approve", "POST", JSONObject().put("id", id).put("allow", allow)).first == 200 }.getOrDefault(false)
            if (ok) { cards.remove("link-$id"); Island.nativeChanged() }
            else Notif.info(App.ctx, "Lokey", "Could not reach your PC to answer", "link-fail")
        }.start()
    }

    private fun onEvent(name: String, data: String) {
        lastEventAt = System.currentTimeMillis()
        val j = runCatching { JSONObject(data) }.getOrNull() ?: return
        when (name) {
            "confirm" -> LinkParse.confirmFace(j)?.let { cards[it.id] = it; Island.nativeChanged() }
            "confirm-done" -> { cards.remove("link-" + j.optString("id")); Island.nativeChanged() }
            "job", "nudge" -> Notif.info(App.ctx, j.optString("title", "Lokey"), j.optString("text"), "link-$name")
        }
    }

    private fun loop() {
        var wait = 1000L
        val poll = Thread({
            while (run) {
                creds()?.let { (b, t) -> runCatching { call(b, t, "/status", "GET", null) }.getOrNull()?.takeIf { it.first == 200 }?.let { r ->
                    val f = runCatching { LinkParse.statusFace(JSONObject(r.second)) }.getOrNull()
                    if (f?.subtitle != status?.subtitle) { status = f; Island.nativeChanged() }
                } }
                try { Thread.sleep(60_000) } catch (_: InterruptedException) { return@Thread }
            }
        }, "lokey-link-status").also { it.isDaemon = true; it.start() }
        while (run) {
            val (base, token) = creds() ?: break
            val code = events(base, token)
            connected = false
            if (code == 401) { sp().edit().remove("cred").apply(); cards.clear(); status = null; Island.nativeChanged(); Events.emit("link.unpaired", obj(), durable = true); break }
            try { Thread.sleep(wait) } catch (_: InterruptedException) { break }
            wait = if (code == 200) 1000 else (wait * 2).coerceAtMost(30_000)
        }
        poll.interrupt(); run = false
    }

    /** blocks while the stream is open; returns the HTTP status (401 = revoked) or -1 on a network error */
    private fun events(base: String, token: String): Int {
        val con = URL("$base/events").openConnection() as HttpURLConnection
        try {
            con.setRequestProperty("Authorization", "Bearer $token"); con.connectTimeout = 8000; con.readTimeout = 50_000   // the PC sends a keep-alive every 20 s
            if (con.responseCode != 200) return con.responseCode
            connected = true; lastEventAt = System.currentTimeMillis()
            var ev = "message"
            con.inputStream.bufferedReader().use { r ->
                while (run) {
                    val line = r.readLine() ?: break
                    when {
                        line.startsWith("event:") -> ev = line.substring(6).trim()
                        line.startsWith("data:") -> { onEvent(ev, line.substring(5).trim()); ev = "message" }
                    }
                }
            }
            return 200
        } catch (e: Exception) { return -1 } finally { con.disconnect() }
    }

    fun methods(): Map<String, H> = mapOf(
        "link.credentials" h { p -> if (p.has("base") && !p.isNull("base")) set(p.str("base"), p.str("token")) else set(null, null) },
        "link.status" h { obj("paired" to hasCreds(), "connected" to connected, "lastEventAt" to lastEventAt, "cards" to cards.size) },
    )
}
