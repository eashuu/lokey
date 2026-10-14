package app.lokey.link

import android.content.Intent
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * One entry point for the whole native side: call({method, params}) -> {result}. The method names are the ones in
 * shared/protocol.ts (plus the phone-only ones listed in PLUGIN.md). A failure never rejects: it resolves
 * {result: {ok:false, reason}}. Unsolicited events arrive on the 'event' listener as {name, data}.
 */
@CapacitorPlugin(name = "LokeyNative")
class LokeyNative : Plugin() {
    private val pool = Executors.newCachedThreadPool()

    override fun load() {
        App.init(context); App.plugin = this; App.activity = activity; App.prefs.edit().putBoolean("voice", false).apply()
        Observers.start()
        App.prefs.edit().remove("user_stopped").apply()   // opening Lokey undoes "Stop" from the notification
        LinkClient.start(); Island.nativeChanged(); LokeyService.sync(context)
        Launch.fromIntent(activity?.intent)
        Events.flush()
    }

    override fun handleOnResume() { Island.refresh(); Clips.capture(); Events.emit("app.resume", obj()) }
    override fun handleOnPause() { Island.refresh() }
    override fun handleOnNewIntent(intent: Intent) { Launch.fromIntent(intent); Launch.deliver() }
    override fun handleOnDestroy() { if (App.plugin === this) App.plugin = null }

    @PluginMethod
    fun call(c: PluginCall) {
        val method = c.getString("method") ?: return c.reject("method required")
        val params: JSONObject = c.getObject("params") ?: JSObject()
        pool.execute {
            val res: Any? = try { Router.call(method, params) } catch (t: Throwable) { Router.error(method, t) }
            val out = JSObject()
            out.put("result", when (res) { null -> JSONObject.NULL; is JSONObject, is JSONArray, is String, is Number, is Boolean -> res; else -> res.toString() })
            c.resolve(out)
        }
    }

    fun push(name: String, data: Any?, retain: Boolean) {
        val o = JSObject()
        o.put("name", name); o.put("data", data ?: JSONObject.NULL)
        notifyListeners("event", o, retain)
    }
}

object Router {
    private val table: Map<String, H> by lazy {
        buildMap {
            putAll(SystemApi.methods()); putAll(MediaApi.methods()); putAll(PhoneApi.methods()); putAll(Ui.methods())
            putAll(Perms.methods()); putAll(Wake.methods()); putAll(Secrets.methods()); putAll(ServiceApi.methods()); putAll(LinkClient.methods()); putAll(Diag.methods()); putAll(ShizukuApi.methods())
        }
    }

    fun call(method: String, p: JSONObject): Any? = (table[method] ?: throw Fail("unknown method: $method"))(p)

    fun error(method: String, t: Throwable): JSONObject = when (t) {
        is Fail -> fail(t.reason)
        is SecurityException -> fail("permission denied: ${t.message ?: method}")
        else -> { android.util.Log.w("Lokey", "$method failed", t); fail("${t.javaClass.simpleName}: ${t.message ?: method}") }
    }

    fun names(): List<String> = table.keys.sorted()
}

/** Native -> JS. Events marked durable are kept (on disk) while the WebView is not alive and delivered when it loads. */
object Events {
    private const val Q = "event_queue"

    fun emit(name: String, data: Any? = null, durable: Boolean = false) {
        val p = App.plugin
        if (p != null) p.push(name, data, durable) else if (durable) synchronized(this) {
            val q = JSONArray(App.prefs.getString(Q, "[]")); q.put(obj("name" to name, "data" to data, "at" to System.currentTimeMillis()))
            App.prefs.edit().putString(Q, q.toString()).apply()
        }
    }

    fun flush() {
        val q = synchronized(this) { val s = App.prefs.getString(Q, "[]") ?: "[]"; App.prefs.edit().remove(Q).apply(); JSONArray(s) }
        for (i in 0 until q.length()) q.getJSONObject(i).let { App.plugin?.push(it.getString("name"), it.opt("data"), true) }
    }
}

/** What the app was started for (Ask tile, widget, assistant gesture, share): the page asks once at boot, later launches arrive as 'app.launch'. */
object Launch {
    @Volatile var pending: JSONObject? = null
    @Volatile private var jsReady = false

    fun fromIntent(i: Intent?) {
        i ?: return
        val a = when (i.action) {
            ACT_ASK -> "ask"; ACT_LISTEN, Intent.ACTION_ASSIST, Intent.ACTION_VOICE_COMMAND, "android.intent.action.VOICE_ASSIST" -> "listen"
            ACT_CONFIRM -> "confirm"; ACT_WAKE -> "wake"
            Intent.ACTION_SEND -> "share"
            else -> return
        }
        pending = obj("action" to a, "text" to i.getStringExtra(Intent.EXTRA_TEXT), "id" to i.getStringExtra("id"), "kind" to i.getStringExtra("kind"), "phrase" to i.getStringExtra("phrase")?.ifEmpty { null }, "wakeAction" to i.getStringExtra("wakeAction"))
        i.action = null
    }

    fun deliver() { val p = pending; if (p != null && jsReady) { pending = null; Events.emit("app.launch", p, true) } }
    fun take(): JSONObject? { jsReady = true; val p = pending; pending = null; return p }

    fun intent(action: String): Intent = Intent(App.ctx, MainActivity::class.java).setAction(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    fun start(action: String, extra: Map<String, String> = emptyMap()) {
        val i = intent(action); extra.forEach { (k, v) -> i.putExtra(k, v) }
        App.ctx.startActivity(i)
    }

    const val ACT_ASK = "app.lokey.link.ASK"
    const val ACT_LISTEN = "app.lokey.link.LISTEN"
    const val ACT_CONFIRM = "app.lokey.link.CONFIRM"
    const val ACT_WAKE = "app.lokey.link.WAKE"
}
