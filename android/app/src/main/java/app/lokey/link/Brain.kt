package app.lokey.link

import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.provider.AlarmClock
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** What the phone can do by itself. Anything that sends something to another person only opens the composer: you press send. */
object Tools {
    private fun fn(name: String, desc: String, props: JSONObject = JSONObject(), req: List<String> = emptyList()) =
        JSONObject().put("name", name).put("description", desc).put("parameters", JSONObject().put("type", "OBJECT").put("properties", props).apply { if (req.isNotEmpty()) put("required", JSONArray(req)) })
    private fun s(d: String) = JSONObject().put("type", "STRING").put("description", d)
    private fun n(d: String) = JSONObject().put("type", "INTEGER").put("description", d)
    private fun b(d: String) = JSONObject().put("type", "BOOLEAN").put("description", d)
    private fun p(vararg kv: Pair<String, JSONObject>) = JSONObject().also { o -> kv.forEach { o.put(it.first, it.second) } }

    fun declarations(c: Context): JSONArray = JSONArray().apply {
        put(fn("open_app", "Open an installed app by its name.", p("name" to s("app name, e.g. WhatsApp")), listOf("name")))
        put(fn("set_timer", "Start a countdown timer.", p("seconds" to n("length in seconds"), "label" to s("optional label")), listOf("seconds")))
        put(fn("set_alarm", "Set an alarm clock for a time (24-hour).", p("hour" to n("0-23"), "minute" to n("0-59"), "label" to s("optional")), listOf("hour", "minute")))
        put(fn("remind_me", "Show a notification after some minutes.", p("minutes" to n("minutes from now"), "text" to s("what to remind")), listOf("minutes", "text")))
        put(fn("call", "Open the dialer with a number or contact number ready (the user presses call).", p("number" to s("phone number")), listOf("number")))
        put(fn("send_sms", "Open the messages composer with the text ready (the user presses send).", p("number" to s("phone number"), "text" to s("message")), listOf("number", "text")))
        put(fn("open_url", "Open a web address.", p("url" to s("https address")), listOf("url")))
        put(fn("search_web", "Search the web in the browser.", p("query" to s("what to search")), listOf("query")))
        put(fn("navigate", "Open maps navigation to a place.", p("place" to s("address or place name")), listOf("place")))
        put(fn("play_music", "Search and play music in the music app.", p("query" to s("song, artist or playlist")), listOf("query")))
        put(fn("flashlight", "Turn the flashlight on or off.", p("on" to b("true for on")), listOf("on")))
        put(fn("volume", "Change the media volume.", p("direction" to s("up, down, mute or max")), listOf("direction")))
        put(fn("phone_info", "Battery level and the current date and time on this phone."))
        put(fn("remember", "Remember a short fact about the user (preferences, people, routines). Never passwords.", p("fact" to s("one short fact")), listOf("fact")))
        put(fn("recall", "Look up what you remember about something.", p("query" to s("what to look up")), listOf("query")))
        put(fn("forget", "Forget remembered facts containing this text.", p("text" to s("text to match")), listOf("text")))
        if (Store.paired(c)) {
            put(fn("ask_pc", "Hand a task to the user's paired PC (open files, run PC apps, anything on the computer). Use when the task needs the computer.", p("request" to s("what the PC should do")), listOf("request")))
            put(fn("pc_status", "What the PC is doing now, its battery and what is playing."))
        }
    }

    private fun go(a: Activity, i: Intent): Boolean = try { a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (e: Exception) { false }

    /** returns the text the model sees as the result */
    fun run(a: Activity, name: String, args: JSONObject): String {
        return try {
            when (name) {
                "open_app" -> {
                    val q = args.optString("name").lowercase()
                    val pm = a.packageManager
                    val launch = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                    val hit = pm.queryIntentActivities(launch, 0).firstOrNull { it.loadLabel(pm).toString().lowercase() == q }
                        ?: pm.queryIntentActivities(launch, 0).firstOrNull { it.loadLabel(pm).toString().lowercase().contains(q) }
                    if (hit == null) "no app called ${args.optString("name")}" else { pm.getLaunchIntentForPackage(hit.activityInfo.packageName)?.let { go(a, it) }; "opened ${hit.loadLabel(pm)}" }
                }
                "set_timer" -> if (go(a, Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, args.optInt("seconds").coerceIn(1, 86_400)).putExtra(AlarmClock.EXTRA_MESSAGE, args.optString("label")).putExtra(AlarmClock.EXTRA_SKIP_UI, true))) "timer started" else "no clock app"
                "set_alarm" -> if (go(a, Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR, args.optInt("hour")).putExtra(AlarmClock.EXTRA_MINUTES, args.optInt("minute")).putExtra(AlarmClock.EXTRA_MESSAGE, args.optString("label")).putExtra(AlarmClock.EXTRA_SKIP_UI, true))) "alarm set" else "no clock app"
                "remind_me" -> {
                    val mins = args.optInt("minutes").coerceIn(1, 7 * 24 * 60)
                    val pi = PendingIntent.getBroadcast(a, (System.currentTimeMillis() % 100000).toInt(), Intent(a, ReminderReceiver::class.java).putExtra("text", args.optString("text")), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                    a.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + mins * 60_000L, pi)
                    "reminder set for $mins minutes from now"
                }
                "call" -> if (go(a, Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(args.optString("number")))))) "dialer opened, the user presses call" else "cannot open dialer"
                "send_sms" -> if (go(a, Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(args.optString("number")))).putExtra("sms_body", args.optString("text")))) "message ready, the user presses send" else "cannot open messages"
                "open_url" -> args.optString("url").let { u -> if (u.startsWith("http") && go(a, Intent(Intent.ACTION_VIEW, Uri.parse(u)))) "opened" else "not a web address" }
                "search_web" -> if (go(a, Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/search?q=" + Uri.encode(args.optString("query")))))) "search opened" else "no browser"
                "navigate" -> if (go(a, Intent(Intent.ACTION_VIEW, Uri.parse("google.navigation:q=" + Uri.encode(args.optString("place")))).setPackage("com.google.android.apps.maps")) || go(a, Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(args.optString("place")))))) "navigation opened" else "no maps app"
                "play_music" -> if (go(a, Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*").putExtra(android.app.SearchManager.QUERY, args.optString("query")))) "asked the music app to play it" else "no music app"
                "flashlight" -> {
                    val cm = a.getSystemService(CameraManager::class.java)
                    val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(android.hardware.camera2.CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
                    if (id == null) "no flashlight" else { cm.setTorchMode(id, args.optBoolean("on")); if (args.optBoolean("on")) "flashlight on" else "flashlight off" }
                }
                "volume" -> {
                    val am = a.getSystemService(AudioManager::class.java)
                    when (args.optString("direction")) {
                        "up" -> am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
                        "down" -> am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
                        "mute" -> am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI)
                        "max" -> am.setStreamVolume(AudioManager.STREAM_MUSIC, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC), AudioManager.FLAG_SHOW_UI)
                    }
                    "volume now ${am.getStreamVolume(AudioManager.STREAM_MUSIC)} of ${am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)}"
                }
                "phone_info" -> {
                    val bm = a.getSystemService(BatteryManager::class.java)
                    "battery ${bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)}%${if (bm.isCharging) " (charging)" else ""}; now ${SimpleDateFormat("EEEE d MMMM yyyy, HH:mm", Locale.getDefault()).format(Date())}"
                }
                "remember" -> if (Mem.add(a, args.optString("fact"))) "remembered" else "already known or not stored"
                "recall" -> Mem.search(a, args.optString("query")).joinToString("; ") { it.text }.ifEmpty { "nothing remembered about that" }
                "forget" -> "forgot ${Mem.forget(a, args.optString("text"))} memories"
                "ask_pc" -> Api.say(a, args.optString("request")).fold({ "sent to the PC; it will act on it (it may ask for approval on this phone)" }, { "PC unavailable: ${it.message}" })
                "pc_status" -> Api.status(a)?.toString() ?: "PC not reachable"
                else -> "unknown tool $name"
            }
        } catch (e: SecurityException) { "not allowed: ${e.message}" } catch (e: Exception) { "failed: ${e.message}" }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { Notif.channels(c); Notif.info(c, "Lokey reminder", i.getStringExtra("text") ?: "") }
}

/** The thinking: Gemini through its plain REST API with function calling, on the phone's own key. Replies in the language the user used. */
object Brain {
    private val history = mutableListOf<JSONObject>() // this app session only; long-term things go to Mem
    private const val STEPS = 5

    private fun system(c: Context, asked: String): String {
        val mem = Mem.search(c, asked, 6).ifEmpty { Mem.search(c, null, 6) }.joinToString("\n") { "- " + it.text }
        val now = SimpleDateFormat("EEEE d MMMM yyyy, HH:mm", Locale.getDefault()).format(Date())
        return """You are Lokey, the user's personal assistant on their Android phone (vivo, OriginOS). It is $now.
Reply in the language the user spoke: English, Tamil, or Tanglish (Tamil in English letters). Keep answers short and natural, they may be spoken aloud. Use Tamil script only if the user wrote Tamil script.
Use tools to actually do things on the phone instead of explaining how. Never claim you did something a tool did not confirm. Never send messages or place calls yourself: the tools only open the composer or dialer.
Remember lasting facts about the user with the remember tool (not passwords, codes or card numbers).
${if (Store.paired(c)) "The user's PC is paired: for anything that needs the computer, use ask_pc." else "No PC is paired; you work alone on the phone."}
What you remember about the user:
${mem.ifEmpty { "(nothing yet)" }}"""
    }

    private fun post(c: Context, body: JSONObject): JSONObject {
        val u = URL("https://generativelanguage.googleapis.com/v1beta/models/${Store.model(c)}:generateContent")
        val con = u.openConnection() as HttpURLConnection
        try {
            con.requestMethod = "POST"; con.doOutput = true; con.connectTimeout = 10_000; con.readTimeout = 60_000
            con.setRequestProperty("Content-Type", "application/json"); con.setRequestProperty("x-goog-api-key", Store.apiKey(c))
            con.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = con.responseCode
            val txt = (if (code in 200..299) con.inputStream else con.errorStream)?.bufferedReader()?.readText() ?: ""
            if (code == 429) error("Gemini's free limit was hit, try again in a minute")
            if (code == 400 || code == 403) error("Gemini refused the key or request (${code}). Check the key in Settings")
            if (code !in 200..299) error("Gemini error $code")
            return JSONObject(txt)
        } finally { con.disconnect() }
    }

    /** one user request in, the final spoken/written answer out. Blocking: call from a thread. */
    fun ask(a: Activity, text: String, onStep: (String) -> Unit = {}): Result<String> = runCatching {
        if (Store.apiKey(a).isEmpty()) {
            // no key: if a PC is paired, it does the thinking
            if (Store.paired(a)) { Api.say(a, text).getOrThrow(); return@runCatching "Sent to your PC." }
            error("Add your Gemini key in Settings first")
        }
        history += JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", text)))
        while (history.size > 24) history.removeAt(0)
        var answer = ""
        for (step in 0 until STEPS) {
            val resp = post(a, JSONObject().put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system(a, text)))))
                .put("contents", JSONArray(history)).put("tools", JSONArray().put(JSONObject().put("functionDeclarations", Tools.declarations(a)))))
            val parts = resp.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts") ?: break
            history += JSONObject().put("role", "model").put("parts", parts)
            val calls = (0 until parts.length()).mapNotNull { parts.getJSONObject(it).optJSONObject("functionCall") }
            answer = (0 until parts.length()).mapNotNull { parts.getJSONObject(it).optString("text").takeIf { t -> t.isNotEmpty() } }.joinToString(" ").trim()
            if (calls.isEmpty()) break
            val results = JSONArray()
            for (cl in calls) {
                onStep(cl.optString("name"))
                var out = ""
                val latch = java.util.concurrent.CountDownLatch(1)
                val nm = cl.optString("name"); val ar = cl.optJSONObject("args") ?: JSONObject()
                if (nm == "ask_pc" || nm == "pc_status") out = Tools.run(a, nm, ar) // network: not on the UI thread
                else { a.runOnUiThread { out = Tools.run(a, nm, ar); latch.countDown() }; latch.await() } // intents start from the foreground screen
                results.put(JSONObject().put("functionResponse", JSONObject().put("name", cl.optString("name")).put("response", JSONObject().put("result", out))))
            }
            history += JSONObject().put("role", "user").put("parts", results)
        }
        answer.ifEmpty { "Done." }
    }
}
