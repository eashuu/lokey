package app.lokey.link

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Process-wide handles. Services and receivers call App.init(context) first, so they work even when the WebView is not alive. */
object App {
    lateinit var ctx: Context
    @Volatile var plugin: LokeyNative? = null
    @Volatile var activity: Activity? = null
    /** MainActivity is resumed (the WebView is in front) */
    @Volatile var foreground = false
    /** number of started MainActivity instances (the lifecycle truth for "is Lokey on screen") */
    @Volatile var started = 0
    val ui = Handler(Looper.getMainLooper())
    fun init(c: Context) { if (!::ctx.isInitialized) ctx = c.applicationContext }
    val prefs: SharedPreferences get() = ctx.getSharedPreferences("lokey", Context.MODE_PRIVATE)
    val pkg: String get() = ctx.packageName
}

/** Thrown by handlers; the router turns it into {ok:false, reason} instead of crashing anything. */
class Fail(val reason: String) : Exception(reason)

typealias H = (JSONObject) -> Any?
infix fun String.h(f: H): Pair<String, H> = this to f

fun obj(vararg p: Pair<String, Any?>): JSONObject = JSONObject().also { j -> p.forEach { (k, v) -> j.put(k, v ?: JSONObject.NULL) } }
fun arr(items: Iterable<Any?>): JSONArray = JSONArray().also { a -> items.forEach { a.put(it ?: JSONObject.NULL) } }
fun ok(vararg p: Pair<String, Any?>): JSONObject = obj("ok" to true, *p)
fun fail(reason: String): JSONObject = obj("ok" to false, "reason" to reason)

fun JSONObject.str(k: String, d: String = ""): String = if (isNull(k) || !has(k)) d else optString(k, d)
fun JSONObject.num(k: String, d: Double = 0.0): Double = if (isNull(k) || !has(k)) d else optDouble(k, d)
fun JSONObject.int(k: String, d: Int = 0): Int = if (isNull(k) || !has(k)) d else optDouble(k, d.toDouble()).toInt()
fun JSONObject.long(k: String, d: Long = 0): Long = if (isNull(k) || !has(k)) d else optDouble(k, d.toDouble()).toLong()
fun JSONObject.bool(k: String, d: Boolean = false): Boolean = if (isNull(k) || !has(k)) d else optBoolean(k, d)
fun JSONObject.need(k: String): String = str(k).ifEmpty { throw Fail("missing param: $k") }
fun JSONArray.strings(): List<String> = (0 until length()).map { optString(it) }

/** run f on the main thread and wait for it (view / window work) */
fun <T> main(f: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) return f()
    val out = AtomicReference<Result<T>>()
    val l = CountDownLatch(1)
    App.ui.post { out.set(runCatching(f)); l.countDown() }
    if (!l.await(10, TimeUnit.SECONDS)) throw Fail("main thread busy")
    return out.get().getOrThrow()
}

fun Bitmap.dataUrl(fmt: Bitmap.CompressFormat = Bitmap.CompressFormat.JPEG, q: Int = 80): String {
    val b = ByteArrayOutputStream(); compress(fmt, q, b)
    val mime = if (fmt == Bitmap.CompressFormat.PNG) "image/png" else "image/jpeg"
    return "data:$mime;base64," + Base64.encodeToString(b.toByteArray(), Base64.NO_WRAP)
}

fun Bitmap.fit(max: Int): Bitmap {
    val s = max.toFloat() / maxOf(width, height)
    return if (s >= 1f) this else Bitmap.createScaledBitmap(this, maxOf(1, (width * s).toInt()), maxOf(1, (height * s).toInt()), true)
}

fun Drawable.bitmap(size: Int): Bitmap {
    val b = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val c = Canvas(b); setBounds(0, 0, size, size); draw(c)
    return b
}

