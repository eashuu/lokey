package app.lokey.link

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** What the PC (Lokey > Settings > Devices) offers. Every call is a plain HTTP request on the home network; the token is the only secret. */
object Store {
    private fun sp(c: Context) = c.getSharedPreferences("lokey", Context.MODE_PRIVATE)
    fun base(c: Context): String = sp(c).getString("base", "") ?: ""
    fun token(c: Context): String = sp(c).getString("token", "") ?: ""
    fun paired(c: Context) = base(c).isNotEmpty() && token(c).isNotEmpty()
    fun save(c: Context, base: String, token: String) = sp(c).edit().putString("base", base).putString("token", token).apply()
    /** unpairing keeps the phone's own key, model and memory: it is a standalone assistant first */
    fun clear(c: Context) = sp(c).edit().remove("base").remove("token").remove("pending").remove("status").remove("connected").apply()

    // the last thing the PC told us, so the widget and popups can draw without asking again
    fun pending(c: Context): JSONObject? = sp(c).getString("pending", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    fun setPending(c: Context, card: JSONObject?) = sp(c).edit().apply { if (card == null) remove("pending") else putString("pending", card.toString()) }.apply()
    fun status(c: Context): JSONObject? = sp(c).getString("status", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    fun setStatus(c: Context, s: JSONObject?) = sp(c).edit().apply { if (s == null) remove("status") else putString("status", s.toString()) }.apply()
    // standalone settings: the phone's own Gemini key and model, spoken language
    fun apiKey(c: Context): String = sp(c).getString("gkey", "") ?: ""
    fun model(c: Context): String = sp(c).getString("gmodel", "gemini-2.5-flash") ?: "gemini-2.5-flash"
    fun lang(c: Context): String = sp(c).getString("lang", "en-IN") ?: "en-IN"   // en-IN or ta-IN (speech in), replies follow the script used
    fun setAi(c: Context, key: String, model: String, lang: String) = sp(c).edit().putString("gkey", key.trim()).putString("gmodel", model.trim().ifEmpty { "gemini-2.5-flash" }).putString("lang", lang).apply()
    fun touchMem(c: Context) = sp(c).edit().putLong("memAt", System.currentTimeMillis()).apply()
    fun connected(c: Context) = sp(c).getBoolean("connected", false)
    fun setConnected(c: Context, on: Boolean) = sp(c).edit().putBoolean("connected", on).apply()
}

object Api {
    class Res(val code: Int, val body: String)

    /** "192.168.1.20:47831" or a full http address -> "http://192.168.1.20:47831" */
    fun normalise(s: String): String {
        var t = s.trim().trimEnd('/')
        if (!t.startsWith("http")) t = "http://$t"
        return t
    }

    private fun call(base: String, path: String, method: String, token: String?, body: JSONObject?, timeoutMs: Int = 8000): Res {
        val c = URL(base + path).openConnection() as HttpURLConnection
        try {
            c.requestMethod = method
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs
            if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val code = c.responseCode
            val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: ""
            return Res(code, text)
        } finally { c.disconnect() }
    }

    fun pair(base: String, code: String, name: String): Result<String> = runCatching {
        val r = call(base, "/pair", "POST", null, JSONObject().put("code", code).put("name", name))
        when {
            r.code == 200 -> JSONObject(r.body).getString("token")
            r.code == 429 -> error("Too many tries, wait a bit")
            else -> error("Wrong or expired code. Make a new one on the PC")
        }
    }

    private fun authed(c: Context, path: String, method: String, body: JSONObject?): Res = call(Store.base(c), path, method, Store.token(c), body)

    fun approve(c: Context, id: String, allow: Boolean): Boolean = runCatching { authed(c, "/approve", "POST", JSONObject().put("id", id).put("allow", allow)).code == 200 }.getOrDefault(false)
    fun say(c: Context, text: String): Result<Unit> = runCatching {
        val r = authed(c, "/say", "POST", JSONObject().put("text", text))
        if (r.code == 409) error("Lokey is busy right now")
        if (r.code == 401) error("Unpaired on the PC. Pair again")
        if (r.code != 200) error("PC said ${r.code}")
    }
    fun clip(c: Context, text: String): Result<Unit> = runCatching { if (authed(c, "/clipboard", "POST", JSONObject().put("text", text)).code != 200) error("PC refused") }
    fun facts(c: Context): List<Pair<String, String>>? = runCatching {
        val r = authed(c, "/sync/facts", "GET", null); if (r.code != 200) return null
        val a = JSONObject(r.body).getJSONArray("facts"); (0 until a.length()).map { a.getJSONObject(it).let { f -> f.getString("text") to f.optString("kind", "fact") } }
    }.getOrNull()
    fun pushFacts(c: Context, items: List<Pair<String, String>>): Int = runCatching {
        val a = org.json.JSONArray(); items.take(200).forEach { a.put(JSONObject().put("text", it.first).put("kind", it.second)) }
        val r = authed(c, "/sync/facts", "POST", JSONObject().put("facts", a)); if (r.code == 200) JSONObject(r.body).optInt("added") else 0
    }.getOrDefault(0)
    fun status(c: Context): JSONObject? = runCatching { authed(c, "/status", "GET", null).takeIf { it.code == 200 }?.let { JSONObject(it.body) } }.getOrNull()

    /** Blocks while connected. Calls [onEvent] with (event name, JSON data). Returns the HTTP status (401 = unpaired) or -1 on a network error. */
    fun events(c: Context, alive: () -> Boolean, onEvent: (String, String) -> Unit): Int {
        val con = URL(Store.base(c) + "/events").openConnection() as HttpURLConnection
        try {
            con.setRequestProperty("Authorization", "Bearer ${Store.token(c)}")
            con.connectTimeout = 8000
            con.readTimeout = 50_000 // the PC sends a keep-alive every 20 s
            if (con.responseCode != 200) return con.responseCode
            Store.setConnected(c, true)
            var ev = "message"
            con.inputStream.bufferedReader().use { r ->
                while (alive()) {
                    val line = r.readLine() ?: break
                    when {
                        line.startsWith("event:") -> ev = line.substring(6).trim()
                        line.startsWith("data:") -> { onEvent(ev, line.substring(5).trim()); ev = "message" }
                    }
                }
            }
            return 200
        } catch (e: Exception) { return -1 } finally { con.disconnect(); Store.setConnected(c, false) }
    }
}
