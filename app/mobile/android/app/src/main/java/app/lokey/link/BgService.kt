package app.lokey.link

import android.content.AttributionSource
import android.content.Context
import android.content.ContextWrapper
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.os.Process
import android.os.SystemClock
import android.system.Os
import android.view.InputDevice
import android.view.InputEvent
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent
import androidx.annotation.Keep
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.util.concurrent.TimeUnit

/**
 * The Shizuku user service. Shizuku starts this class in its own process (app_process, uid 2000 = shell) and hands the binder to Lokey.
 * Everything here uses the same hidden APIs scrcpy's server uses for `--new-display`:
 *  - DisplayManager(Context) built with a context that says it is com.android.shell, then createVirtualDisplay(...) with
 *    PUBLIC | PRESENTATION | OWN_CONTENT_ONLY | SUPPORTS_TOUCH | ROTATES_WITH_CONTENT (+ TRUSTED | OWN_DISPLAY_GROUP | ALWAYS_UNLOCKED |
 *    TOUCH_FEEDBACK_DISABLED on 13+, + OWN_FOCUS | DEVICE_DISPLAY_GROUP on 14+) and an ImageReader surface to read frames from,
 *  - InputManager.injectInputEvent + InputEvent.setDisplayId to touch / type on that display,
 *  - `am start --display <id>` to open an app on it.
 * Hidden-API restrictions do not apply to a process started by app_process (this is not a zygote app), which is why a Shizuku user
 * service may use them. NOTHING here ran on a phone yet: see docs/SHIZUKU-TIER.md.
 * This process knows nothing of the App object, the WebView or the plugin: it only does what a call asks.
 */
@Keep
class BgService(private val base: Context) : IBgService.Stub() {
    private class Shell(b: Context) : ContextWrapper(b) {
        override fun getPackageName(): String = "com.android.shell"
        override fun getOpPackageName(): String = "com.android.shell"
        override fun getApplicationContext(): Context = this
        override fun createPackageContext(packageName: String?, flags: Int): Context = this
        override fun getAttributionSource(): AttributionSource = AttributionSource.Builder(Process.SHELL_UID).setPackageName("com.android.shell").build()
        override fun getDeviceId(): Int = 0
    }

    private val ownPkg = base.packageName
    private val shell: Context by lazy { Shell(sysContext() ?: base) }
    private val worker = HandlerThread("lokey-bg").apply { start() }
    private val handler = Handler(worker.looper)
    private val lock = Any()

    private var vd: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var displayId = -1
    private var width = 0
    private var height = 0
    private var dpi = 0
    private var latest: Image? = null
    private var seq = 0L
    private var latestAt = 0L
    private var lastUse = 0L
    private var paused = false
    private var idleMs = 20_000L
    private var ime = "unchanged"

    // ---- Binder entry points ----------------------------------------------------------------------------------------------
    override fun destroy() { runCatching { teardown() }; System.exit(0) }

    override fun call(method: String, json: String): String {
        return try {
            val p = if (json.isBlank()) JSONObject() else JSONObject(json)
            val r = dispatch(method, p)
            (if (r.has("ok")) r else r.put("ok", true)).toString()
        } catch (t: Throwable) {
            val c = (t as? java.lang.reflect.InvocationTargetException)?.targetException ?: t
            JSONObject().put("ok", false).put("reason", "${c.javaClass.simpleName}: ${c.message ?: method}".take(300)).toString()
        }
    }

    override fun frame(quality: Int, maxWidth: Int): ParcelFileDescriptor? {
        val f = grab(quality.coerceIn(20, 95), maxWidth.coerceIn(120, 2000)) ?: return null
        val pipe = ParcelFileDescriptor.createPipe()
        Thread {
            runCatching {
                DataOutputStream(ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])).use { o ->
                    o.writeInt(f.w); o.writeInt(f.h); o.writeInt(f.ageMs); o.writeByte((if (f.black) 1 else 0) or (if (f.stale) 2 else 0)); o.write(f.jpeg)
                }
            }
        }.start()
        return pipe[0]
    }

    // ---- calls --------------------------------------------------------------------------------------------------------------
    private fun dispatch(m: String, p: JSONObject): JSONObject = when (m) {
        "probe" -> JSONObject().put("uid", Os.getuid()).put("sdk", Build.VERSION.SDK_INT).put("release", Build.VERSION.RELEASE).put("model", Build.MODEL)
            .put("brand", Build.BRAND).put("input", runCatching { injector(); true }.getOrDefault(false))
        "display.create" -> createDisplay(p.optInt("width", 720), p.optInt("height", 1600), p.optInt("dpi", 320), p.optLong("idleMs", 20_000), p.optBoolean("decorations", false))
        "display.destroy" -> { teardown(); JSONObject() }
        "display.info" -> info()
        "launch" -> launch(p.optString("pkg"), p.optString("activity"), p.optBoolean("fresh", false))
        "tap" -> { val d = target(p); touchTap(p.num("x"), p.num("y"), d); JSONObject() }
        "longPress" -> { val d = target(p); touchHold(p.num("x"), p.num("y"), p.optLong("ms", 700).coerceIn(300, 3000), d); JSONObject() }
        "swipe" -> { val d = target(p); touchSwipe(p.num("x1"), p.num("y1"), p.num("x2"), p.num("y2"), p.optLong("ms", 300).coerceIn(60, 3000), d); JSONObject() }
        "text" -> typeText(p.optString("text"), target(p))
        "key" -> { val d = target(p); key(keyCode(p.optString("key")), d); JSONObject() }
        "foreground" -> foreground(target(p))
        "ui.dump" -> uiDump(target(p))
        "shell" -> runShell(p.optString("command"))
        else -> JSONObject().put("ok", false).put("reason", "unknown service method: $m")
    }

    private fun JSONObject.num(k: String): Float = optDouble(k, Double.NaN).toFloat().also { if (it.isNaN()) throw IllegalArgumentException("missing $k") }

    /** the display an input goes to: the virtual one, or any id the caller names (0 = the real screen, for the silent-input helpers) */
    private fun target(p: JSONObject): Int {
        val d = if (p.has("display")) p.getInt("display") else displayId
        if (d < 0) throw IllegalStateException("no second screen yet: call display.create first")
        return d
    }

    // ---- the virtual display -----------------------------------------------------------------------------------------------
    private fun createDisplay(w0: Int, h0: Int, dpi0: Int, idle: Long, decorations: Boolean): JSONObject {
        teardown()
        val w = (w0.coerceIn(240, 1600) / 2) * 2
        val h = (h0.coerceIn(320, 3200) / 2) * 2
        val d = dpi0.coerceIn(120, 640)
        val r = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 3)
        r.setOnImageAvailableListener({ rd ->
            val img = try { rd.acquireLatestImage() } catch (_: Exception) { null } ?: return@setOnImageAvailableListener
            synchronized(lock) { latest?.close(); latest = img; seq++; latestAt = SystemClock.uptimeMillis() }
        }, handler)
        var flags = 1 or 2 or 8 or (1 shl 6) or (1 shl 7)                    // PUBLIC | PRESENTATION | OWN_CONTENT_ONLY | SUPPORTS_TOUCH | ROTATES_WITH_CONTENT
        if (decorations) flags = flags or (1 shl 9)                          // SHOULD_SHOW_SYSTEM_DECORATIONS (a launcher + bars on the display; some devices draw them broken)
        if (Build.VERSION.SDK_INT >= 33) flags = flags or (1 shl 10) or (1 shl 11) or (1 shl 12) or (1 shl 13)   // TRUSTED | OWN_DISPLAY_GROUP | ALWAYS_UNLOCKED | TOUCH_FEEDBACK_DISABLED
        if (Build.VERSION.SDK_INT >= 34) flags = flags or (1 shl 14) or (1 shl 15)                                  // OWN_FOCUS | DEVICE_DISPLAY_GROUP
        flags = flags or (1 shl 8)                                           // DESTROY_CONTENT_ON_REMOVAL: apps on the display end with it (they do not jump to the real screen)
        val ctor = DisplayManager::class.java.getDeclaredConstructor(Context::class.java).apply { isAccessible = true }
        val dm = ctor.newInstance(shell) as DisplayManager
        val v = try { dm.createVirtualDisplay("lokey-bg", w, h, d, r.surface, flags) } catch (t: Throwable) { r.close(); throw t }
            ?: run { r.close(); throw IllegalStateException("the system refused to create a display (createVirtualDisplay returned null)") }
        vd = v; reader = r; displayId = v.display.displayId; width = w; height = h; dpi = d; idleMs = idle.coerceIn(0, 600_000); paused = false; lastUse = SystemClock.uptimeMillis()
        ime = setImePolicy(displayId)
        if (idleMs > 0) handler.postDelayed(guard, 3000)
        return info().put("flags", flags)
    }

    private fun info(): JSONObject = JSONObject().put("active", vd != null).put("displayId", displayId).put("width", width).put("height", height).put("dpi", dpi)
        .put("idle", paused).put("idleMs", idleMs).put("ime", ime).put("sdk", Build.VERSION.SDK_INT)

    private fun teardown() {
        handler.removeCallbacks(guard)
        runCatching { vd?.release() }
        synchronized(lock) { latest?.close(); latest = null }
        runCatching { reader?.close() }
        vd = null; reader = null; displayId = -1; paused = false
    }

    /** performance guard: when nothing has asked for a picture for a while the display stops being drawn into the reader (and the compositor stops working for it) */
    private val guard = object : Runnable {
        override fun run() {
            val v = vd ?: return
            if (idleMs > 0 && !paused && SystemClock.uptimeMillis() - lastUse > idleMs) { runCatching { v.surface = null }; paused = true }
            handler.postDelayed(this, 3000)
        }
    }

    private class Frame(val jpeg: ByteArray, val w: Int, val h: Int, val ageMs: Int, val black: Boolean, val stale: Boolean)

    private fun grab(q: Int, maxW: Int): Frame? {
        val v = vd ?: return null
        val rd = reader ?: return null
        lastUse = SystemClock.uptimeMillis()
        var stale = false
        if (paused) {
            val before = synchronized(lock) { seq }
            v.surface = rd.surface; paused = false
            val end = SystemClock.uptimeMillis() + 1500
            while (SystemClock.uptimeMillis() < end && synchronized(lock) { seq } == before) Thread.sleep(40)
            stale = synchronized(lock) { seq } == before
        }
        synchronized(lock) {
            val img = latest ?: return null
            val p = img.planes[0]
            val buf = p.buffer.also { it.rewind() }
            val rowPx = p.rowStride / p.pixelStride
            val full = Bitmap.createBitmap(rowPx, img.height, Bitmap.Config.ARGB_8888)
            full.copyPixelsFromBuffer(buf)
            val bmp = if (rowPx != img.width) Bitmap.createBitmap(full, 0, 0, img.width, img.height).also { full.recycle() } else full
            val black = isBlack(bmp)
            val out = if (bmp.width > maxW) Bitmap.createScaledBitmap(bmp, maxW, (bmp.height * maxW.toFloat() / bmp.width).toInt().coerceAtLeast(1), true).also { bmp.recycle() } else bmp
            val bytes = ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, q, it) }.toByteArray()
            val f = Frame(bytes, out.width, out.height, (SystemClock.uptimeMillis() - latestAt).toInt().coerceAtLeast(0), black, stale)
            out.recycle()
            return f
        }
    }

    /** a black picture means: nothing drawn yet, or a window with FLAG_SECURE (secure layers are blanked for anything that is not secure; the display is not) */
    private fun isBlack(b: Bitmap): Boolean {
        var lit = 0
        val sx = (b.width / 24).coerceAtLeast(1); val sy = (b.height / 24).coerceAtLeast(1)
        var y = 0
        while (y < b.height) { var x = 0; while (x < b.width) { val c = b.getPixel(x, y); if (((c shr 16) and 255) + ((c shr 8) and 255) + (c and 255) > 36) lit++; x += sx }; y += sy }
        return lit <= 2
    }

    /** IME on the real screen would pop up while the user does something else: hide it on the virtual display (13+) or keep it local (11+) */
    private fun setImePolicy(id: Int): String = try {
        val sm = Class.forName("android.os.ServiceManager")
        val binder = sm.getMethod("getService", String::class.java).invoke(null, "window") as IBinder
        val wm = Class.forName("android.view.IWindowManager\$Stub").getMethod("asInterface", IBinder::class.java).invoke(null, binder)!!
        val policy = if (Build.VERSION.SDK_INT >= 33) 2 else 0
        wm.javaClass.getMethod("setDisplayImePolicy", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType).invoke(wm, id, policy)
        if (policy == 2) "hidden" else "local"
    } catch (t: Throwable) { "default (${t.javaClass.simpleName})" }

    // ---- input ---------------------------------------------------------------------------------------------------------------
    private var im: Any? = null
    private var injectM: java.lang.reflect.Method? = null
    private var setDisplayM: java.lang.reflect.Method? = null

    private fun injector() {
        if (injectM != null) return
        val mgr = shell.getSystemService(Context.INPUT_SERVICE) ?: throw IllegalStateException("no input service")
        injectM = mgr.javaClass.getMethod("injectInputEvent", InputEvent::class.java, Int::class.javaPrimitiveType)
        setDisplayM = InputEvent::class.java.getMethod("setDisplayId", Int::class.javaPrimitiveType)
        im = mgr
    }

    private fun inject(e: InputEvent, display: Int, wait: Boolean = false) {
        injector()
        setDisplayM!!.invoke(e, display)
        val ok = injectM!!.invoke(im, e, if (wait) 2 else 0) as Boolean
        if (e is MotionEvent) e.recycle()
        if (!ok) throw IllegalStateException("the system dropped the input event (display $display)")
    }

    private fun motion(action: Int, down: Long, x: Float, y: Float): MotionEvent {
        val pp = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER }
        val pc = MotionEvent.PointerCoords().apply { this.x = x; this.y = y; pressure = if (action == MotionEvent.ACTION_UP) 0f else 1f; size = 1f }
        return MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, 1, arrayOf(pp), arrayOf(pc), 0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0)
    }

    private fun touchTap(x: Float, y: Float, d: Int) = touchHold(x, y, 55, d)

    private fun touchHold(x: Float, y: Float, ms: Long, d: Int) {
        val t = SystemClock.uptimeMillis()
        inject(motion(MotionEvent.ACTION_DOWN, t, x, y), d)
        Thread.sleep(ms)
        inject(motion(MotionEvent.ACTION_UP, t, x, y), d, wait = true)
    }

    private fun touchSwipe(x1: Float, y1: Float, x2: Float, y2: Float, ms: Long, d: Int) {
        val t = SystemClock.uptimeMillis()
        val steps = (ms / 16).toInt().coerceIn(3, 120)
        inject(motion(MotionEvent.ACTION_DOWN, t, x1, y1), d)
        for (i in 1 until steps) { Thread.sleep(ms / steps); val f = i / steps.toFloat(); inject(motion(MotionEvent.ACTION_MOVE, t, x1 + (x2 - x1) * f, y1 + (y2 - y1) * f), d) }
        Thread.sleep(ms / steps)
        inject(motion(MotionEvent.ACTION_UP, t, x2, y2), d, wait = true)
    }

    private fun key(code: Int, d: Int) {
        val t = SystemClock.uptimeMillis()
        inject(KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD), d)
        inject(KeyEvent(t, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD), d, wait = true)
    }

    private fun keyCode(n: String): Int = when (n.lowercase()) {
        "back" -> KeyEvent.KEYCODE_BACK; "home" -> KeyEvent.KEYCODE_HOME; "enter", "return" -> KeyEvent.KEYCODE_ENTER; "tab" -> KeyEvent.KEYCODE_TAB
        "delete", "backspace" -> KeyEvent.KEYCODE_DEL; "escape", "esc" -> KeyEvent.KEYCODE_ESCAPE; "menu" -> KeyEvent.KEYCODE_MENU; "recents" -> KeyEvent.KEYCODE_APP_SWITCH
        "search" -> KeyEvent.KEYCODE_SEARCH; "space" -> KeyEvent.KEYCODE_SPACE; "up" -> KeyEvent.KEYCODE_DPAD_UP; "down" -> KeyEvent.KEYCODE_DPAD_DOWN
        "left" -> KeyEvent.KEYCODE_DPAD_LEFT; "right" -> KeyEvent.KEYCODE_DPAD_RIGHT; "pageup" -> KeyEvent.KEYCODE_PAGE_UP; "pagedown" -> KeyEvent.KEYCODE_PAGE_DOWN
        else -> throw IllegalArgumentException("unknown key: $n")
    }

    /** printable text as key events (the focused field gets them like a hardware keyboard); characters with no key mapping are reported, not guessed */
    private fun typeText(text: String, d: Int): JSONObject {
        if (text.isEmpty()) return JSONObject().put("ok", false).put("reason", "no text")
        val map = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD)
        val events = map.getEvents(text.toCharArray()) ?: return JSONObject().put("ok", false).put("reason", "non-ASCII text cannot be typed with keys").put("needsAccessibility", true)
        for (e in events) { inject(e, d); Thread.sleep(8) }
        return JSONObject().put("typed", text.length)
    }

    // ---- apps ---------------------------------------------------------------------------------------------------------------
    private fun launch(pkg: String, activity: String, fresh: Boolean): JSONObject {
        if (ShizukuAllow.denyPackage(pkg)) return JSONObject().put("ok", false).put("reason", "Lokey never operates $pkg (banking, payment, wallet, password or authenticator apps)")
        if (displayId < 0) throw IllegalStateException("no second screen yet")
        var comp = if (activity.isNotEmpty()) (if (activity.startsWith(".")) "$pkg/$pkg$activity" else "$pkg/$activity") else ""
        if (comp.isEmpty()) {
            val r = exec(listOf("cmd", "package", "resolve-activity", "--brief", "-c", "android.intent.category.LAUNCHER", pkg), 6000)
            comp = r.second.lines().map { it.trim() }.lastOrNull { it.contains('/') && !it.contains(' ') } ?: return JSONObject().put("ok", false).put("reason", "$pkg has no launcher activity")
        }
        if (fresh) exec(listOf("am", "force-stop", pkg), 5000)
        // NEW_TASK | MULTIPLE_TASK: a task of its own on the second screen, so an app the user has open on the real screen is not dragged over
        val r = exec(listOf("am", "start", "-W", "--display", displayId.toString(), "--activity-multiple-task", "-n", comp), 12_000)
        val bad = r.first != 0 || Regex("Error|Exception|does not exist|not found|Permission Denial", RegexOption.IGNORE_CASE).containsMatchIn(r.second)
        return JSONObject().put("ok", !bad).put("component", comp).put("output", r.second.take(600)).also { if (bad) it.put("reason", "am start failed: " + r.second.lines().firstOrNull { l -> l.contains("Error") || l.contains("Exception") }?.trim().orEmpty()) }
    }

    /** the app in front on a display, from `dumpsys activity activities` (format differs between releases: best effort) */
    private fun foreground(d: Int): JSONObject {
        val out = exec(listOf("dumpsys", "activity", "activities"), 8000).second
        val sec = Regex("Display #$d\\b[^\\n]*\\n").find(out)?.let { m -> out.substring(m.range.last, (Regex("\\nDisplay #\\d+").find(out, m.range.last)?.range?.first ?: out.length)) }
            ?: return JSONObject().put("ok", true).put("pkg", JSONObject.NULL).put("note", "no activities listed for display $d")
        val m = Regex("ActivityRecord\\{[^ ]+ u\\d+ ([A-Za-z0-9_.]+)/([A-Za-z0-9_.$]+)").find(sec)
        return JSONObject().put("pkg", m?.groupValues?.get(1) ?: JSONObject.NULL).put("activity", m?.groupValues?.get(2) ?: JSONObject.NULL)
    }

    /** UI tree through uiautomator (fallback for when the accessibility service cannot see the display). The --display flag is NOT verified to exist on every release. */
    private fun uiDump(d: Int): JSONObject {
        val f = "/data/local/tmp/lokey_ui_$d.xml"
        val r = exec(listOf("uiautomator", "dump", "--display", d.toString(), f), 15_000)
        val xml = runCatching { java.io.File(f).readText() }.getOrNull()
        runCatching { java.io.File(f).delete() }
        if (xml.isNullOrBlank()) return JSONObject().put("ok", false).put("reason", "uiautomator gave nothing (${r.second.take(160).trim()})")
        val nodes = org.json.JSONArray()
        var pkg: String? = null
        val rx = Regex("<node ([^>]*?)/?>")
        fun attr(s: String, k: String) = Regex("(?:^| )$k=\"([^\"]*)\"").find(s)?.groupValues?.get(1) ?: ""
        for (m in rx.findAll(xml)) {
            val a = m.groupValues[1]
            if (pkg == null) pkg = attr(a, "package").ifEmpty { null }
            val text = attr(a, "text"); val desc = attr(a, "content-desc"); val click = attr(a, "clickable") == "true"; val pw = attr(a, "password") == "true"
            val edit = attr(a, "class").endsWith("EditText"); val scroll = attr(a, "scrollable") == "true"
            if (text.isEmpty() && desc.isEmpty() && !click && !edit && !scroll) continue
            val b = Regex("\\[(\\d+),(\\d+)]\\[(\\d+),(\\d+)]").find(attr(a, "bounds")) ?: continue
            val o = JSONObject().put("id", nodes.length()).put("cls", attr(a, "class").substringAfterLast('.')).put("b", org.json.JSONArray(b.groupValues.drop(1).map { it.toInt() }))
            if (text.isNotEmpty() && !pw) o.put("text", text.take(200)); if (desc.isNotEmpty()) o.put("desc", desc.take(120))
            if (click) o.put("click", true); if (edit) o.put("edit", true); if (scroll) o.put("scroll", true); if (pw) o.put("password", true)
            attr(a, "resource-id").takeIf { it.isNotEmpty() }?.let { o.put("res", it.substringAfter(":id/")) }
            nodes.put(o)
            if (nodes.length() >= 350) break
        }
        return JSONObject().put("pkg", pkg ?: JSONObject.NULL).put("w", width).put("h", height).put("count", nodes.length()).put("nodes", nodes).put("source", "uiautomator")
    }

    // ---- shell ---------------------------------------------------------------------------------------------------------------
    private fun runShell(command: String): JSONObject {
        val v = ShizukuAllow.check(command, ownPkg)
        val argv = v.argv ?: return JSONObject().put("ok", false).put("reason", v.error ?: "not allowed")
        val r = exec(argv, 15_000)
        return JSONObject().put("ok", r.first == 0).put("code", r.first).put("output", r.second.take(8000))
    }

    private fun exec(argv: List<String>, timeoutMs: Long): Pair<Int, String> {
        val p = ProcessBuilder(argv).redirectErrorStream(true).start()
        val sb = StringBuilder()
        val t = Thread { runCatching { p.inputStream.bufferedReader().use { r -> val buf = CharArray(4096); while (true) { val n = r.read(buf); if (n < 0) break; if (sb.length < 600_000) sb.append(buf, 0, n) } } } }.also { it.start() }
        if (!p.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) { p.destroyForcibly(); t.join(500); return -1 to (sb.toString() + "\n[timed out]") }
        t.join(1000)
        return p.exitValue() to sb.toString()
    }

    private fun sysContext(): Context? = runCatching {
        val at = Class.forName("android.app.ActivityThread")
        val cur = at.getMethod("currentActivityThread").invoke(null) ?: at.getMethod("systemMain").invoke(null)
        at.getMethod("getSystemContext").invoke(cur) as Context
    }.getOrNull()
}
