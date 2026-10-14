package app.lokey.link

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** The accessibility service: reads the foreground window, performs taps / typing / scrolling / screenshots when the page asks (after its own confirm cards). */
class LokeyAccess : AccessibilityService() {
    override fun onServiceConnected() { instance = this; App.init(this); Events.emit("perm.changed", obj("name" to "accessibility", "granted" to true)) }
    override fun onInterrupt() {}
    override fun onUnbind(i: android.content.Intent?): Boolean { if (instance === this) instance = null; Events.emit("perm.changed", obj("name" to "accessibility", "granted" to false)); return super.onUnbind(i) }

    override fun onAccessibilityEvent(e: AccessibilityEvent) {
        if (e.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = e.packageName?.toString() ?: return
        if (pkg == "com.android.systemui" || pkg == imePackage()) return
        if (pkg == fgPkg) return
        fgPkg = pkg
        Events.emit("foreground.changed", fg())
    }

    private fun imePackage() = runCatching { Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD).substringBefore('/') }.getOrNull()

    companion object {
        @Volatile var instance: LokeyAccess? = null
        @Volatile var fgPkg: String? = null

        private fun label(pkg: String) = runCatching { App.ctx.packageManager.let { it.getApplicationLabel(it.getApplicationInfo(pkg, 0)).toString() } }.getOrDefault(pkg)

        fun fg(): JSONObject = fgPkg.let { obj("title" to (if (it == null) "" else label(it)), "exe" to (it ?: ""), "pid" to 0) }
    }
}

/** ui.* / input.* / text.* / screenshot / windows.* / foreground.get, all on the accessibility service */
object Ui {
    private val svc: LokeyAccess get() = LokeyAccess.instance ?: throw Fail("needs the Lokey accessibility service (perm.request accessibility)")
    private var nodes = ArrayList<AccessibilityNodeInfo>()

    fun methods(): Map<String, H> = mapOf(
        "ui.tree" h { tree(it.int("maxNodes", 350)) },
        "ui.click" h { click(it, false) },
        "ui.longClick" h { click(it, true) },
        "ui.setText" h { setText(it) },
        "ui.scroll" h { scroll(it) },
        "ui.swipe" h { swipe(it.num("x1"), it.num("y1"), it.num("x2"), it.num("y2"), it.long("durationMs", 300)) },
        "ui.back" h { global(AccessibilityService.GLOBAL_ACTION_BACK) },
        "ui.home" h { global(AccessibilityService.GLOBAL_ACTION_HOME) },
        "ui.recents" h { global(AccessibilityService.GLOBAL_ACTION_RECENTS) },
        "ui.notifications" h { global(AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS) },
        "ui.quickSettings" h { global(AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS) },
        "screenshot" h { screenshot(it.int("maxWidth", 1080), it.int("quality", 70)) },
        "text.insert" h { insert(it.str("text")) },
        "text.focusRect" h { focusRect() },
        "text.selection" h { selection() },
        "foreground.get" h { foreground() },
        "windows.list" h { windows() },
        "windows.focus" h { focusWindow(it.int("hwnd")) },
        "windows.forceForeground" h { focusWindow(it.int("hwnd")) },
        "input.chord" h { chord(it.need("name")) },
        "input.keys" h { keys(it.need("combo")) },
        "input.mouse" h { mouse(it) },
    )

    private val dm get() = App.ctx.resources.displayMetrics
    private fun className(n: AccessibilityNodeInfo) = n.className?.toString()?.substringAfterLast('.') ?: ""

    // ---- reading --------------------------------------------------------------------------------------------------
    /** flat list of the visible, meaningful nodes (text, description, clickable, editable, scrollable); ids are valid until the next ui.tree */
    private fun tree(max: Int): JSONObject {
        val root = svc.rootInActiveWindow ?: throw Fail("no readable window (screen off, or a secure screen)")
        val list = ArrayList<AccessibilityNodeInfo>(); val out = JSONArray()
        fun walk(n: AccessibilityNodeInfo, depth: Int) {
            if (list.size >= max || depth > 45 || !n.isVisibleToUser) return
            val pwd = n.isPassword
            val text = if (pwd) null else (n.text?.toString() ?: n.hintText?.toString())?.take(200)?.takeIf { it.isNotEmpty() }
            val desc = n.contentDescription?.toString()?.take(120)?.takeIf { it.isNotEmpty() }
            if (text != null || desc != null || n.isClickable || n.isEditable || n.isScrollable || n.isCheckable) {
                val r = Rect(); n.getBoundsInScreen(r)
                val o = obj("id" to list.size, "cls" to className(n), "b" to arr(listOf(r.left, r.top, r.right, r.bottom)))
                text?.let { o.put("text", it) }; desc?.let { o.put("desc", it) }
                n.viewIdResourceName?.let { o.put("res", it.substringAfter(":id/")) }
                if (n.isClickable) o.put("click", true); if (n.isLongClickable) o.put("long", true); if (n.isEditable) o.put("edit", true)
                if (n.isScrollable) o.put("scroll", true); if (n.isCheckable) o.put("checked", n.isChecked); if (n.isFocused) o.put("focus", true)
                if (pwd) o.put("password", true); if (!n.isEnabled) o.put("disabled", true)
                list.add(n); out.put(o)
            }
            for (i in 0 until n.childCount) n.getChild(i)?.let { walk(it, depth + 1) }
        }
        walk(root, 0)
        synchronized(this) { nodes = list }
        return ok("pkg" to root.packageName?.toString(), "w" to dm.widthPixels, "h" to dm.heightPixels, "count" to out.length(), "truncated" to (list.size >= max), "nodes" to out)
    }

    private fun byId(id: Int): AccessibilityNodeInfo = synchronized(this) { nodes.getOrNull(id) }?.also { it.refresh() } ?: throw Fail("unknown node id $id; call ui.tree again")

    private fun target(p: JSONObject): AccessibilityNodeInfo? = when {
        p.has("id") -> byId(p.int("id"))
        p.str("text").isNotEmpty() -> svc.rootInActiveWindow?.findAccessibilityNodeInfosByText(p.str("text"))?.firstOrNull { it.isVisibleToUser }
        else -> null
    }

    private fun center(n: AccessibilityNodeInfo): Pair<Float, Float> { val r = Rect(); n.getBoundsInScreen(r); return r.exactCenterX() to r.exactCenterY() }

    // ---- gestures -------------------------------------------------------------------------------------------------
    private fun gesture(vararg s: GestureDescription.StrokeDescription): JSONObject {
        val g = GestureDescription.Builder().also { b -> s.forEach { b.addStroke(it) } }.build()
        val l = CountDownLatch(1); var done = false
        val sent = main {
            svc.dispatchGesture(g, object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(d: GestureDescription?) { done = true; l.countDown() }
                override fun onCancelled(d: GestureDescription?) { l.countDown() }
            }, null)
        }
        if (!sent) return fail("the system refused the gesture")
        l.await(15, TimeUnit.SECONDS)
        return if (done) ok() else fail("the gesture was cancelled (a secure screen, or something else was touched)")
    }

    private fun px(x: Double) = x.toFloat().coerceIn(1f, dm.widthPixels - 2f)
    private fun py(y: Double) = y.toFloat().coerceIn(1f, dm.heightPixels - 2f)
    private fun stroke(x1: Double, y1: Double, x2: Double = x1, y2: Double = y1, at: Long = 0, dur: Long = 50) =
        GestureDescription.StrokeDescription(Path().apply { moveTo(px(x1), py(y1)); if (x1 != x2 || y1 != y2) lineTo(px(x2), py(y2)) }, at, dur.coerceAtLeast(1))

    fun tap(x: Double, y: Double) = gesture(stroke(x, y))
    fun longPress(x: Double, y: Double) = gesture(stroke(x, y, dur = 700))
    fun doubleTap(x: Double, y: Double) = gesture(stroke(x, y), stroke(x, y, at = 130))
    private fun swipe(x1: Double, y1: Double, x2: Double, y2: Double, ms: Long) = gesture(stroke(x1, y1, x2, y2, dur = ms.coerceIn(50, 5000)))

    private fun click(p: JSONObject, long: Boolean): JSONObject {
        val n = target(p)
        if (n != null) {
            var a: AccessibilityNodeInfo? = n
            while (a != null) { if (if (long) a.isLongClickable else a.isClickable) { if (a.performAction(if (long) AccessibilityNodeInfo.ACTION_LONG_CLICK else AccessibilityNodeInfo.ACTION_CLICK)) return ok(); break }; a = a.parent }
            val (x, y) = center(n)
            return if (long) longPress(x.toDouble(), y.toDouble()) else tap(x.toDouble(), y.toDouble())
        }
        if (!p.has("x") || !p.has("y")) throw Fail("give id, text, or x and y")
        return if (long) longPress(p.num("x"), p.num("y")) else tap(p.num("x"), p.num("y"))
    }

    private fun setText(p: JSONObject): JSONObject {
        val n = target(p) ?: svc.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: throw Fail("no text field")
        if (n.isPassword) return fail("that is a password field")
        val b = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, p.str("text")) }
        return if (n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)) ok() else fail("the field did not accept the text")
    }

    /** direction = which way the content should move for the reader: down shows what is lower on the page */
    private fun scroll(p: JSONObject): JSONObject {
        val dir = p.str("dir", "down")
        val n = target(p) ?: svc.rootInActiveWindow?.let { r -> firstScrollable(r) }
        if (n != null) {
            val act = when (dir) {
                "up" -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_UP; "left" -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_LEFT
                "right" -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_RIGHT; else -> AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_DOWN
            }
            if (n.performAction(act.id)) return ok()
        }
        val w = dm.widthPixels.toDouble(); val h = dm.heightPixels.toDouble()
        return when (dir) {
            "up" -> swipe(w / 2, h * 0.3, w / 2, h * 0.75, 300); "left" -> swipe(w * 0.25, h / 2, w * 0.8, h / 2, 300)
            "right" -> swipe(w * 0.8, h / 2, w * 0.25, h / 2, 300); else -> swipe(w / 2, h * 0.75, w / 2, h * 0.3, 300)
        }
    }

    private fun firstScrollable(n: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (n.isScrollable && n.isVisibleToUser) return n
        for (i in 0 until n.childCount) n.getChild(i)?.let { c -> firstScrollable(c)?.let { return it } }
        return null
    }

    private fun global(a: Int): JSONObject = if (svc.performGlobalAction(a)) ok() else fail("the system refused that action")

    // ---- screenshot -----------------------------------------------------------------------------------------------
    private fun screenshot(maxW: Int, q: Int): JSONObject {
        if (Build.VERSION.SDK_INT < 30) return fail("screenshots need Android 11")
        val l = CountDownLatch(1); var res: android.accessibilityservice.AccessibilityService.ScreenshotResult? = null; var err = 0
        svc.takeScreenshot(Display.DEFAULT_DISPLAY, App.ctx.mainExecutor, object : AccessibilityService.TakeScreenshotCallback {
            override fun onSuccess(r: AccessibilityService.ScreenshotResult) { res = r; l.countDown() }
            override fun onFailure(code: Int) { err = code; l.countDown() }
        })
        if (!l.await(8, TimeUnit.SECONDS)) return fail("screenshot timed out")
        val r = res ?: return fail(when (err) { 3 -> "screenshots are limited to about one per second"; 5 -> "this screen is protected"; else -> "screenshot failed (code $err)" })
        val hw = Bitmap.wrapHardwareBuffer(r.hardwareBuffer, r.colorSpace) ?: return fail("screenshot unreadable")
        val soft = hw.copy(Bitmap.Config.ARGB_8888, false); hw.recycle(); r.hardwareBuffer.close()
        val s = soft.fit(maxW)
        val out = java.io.ByteArrayOutputStream(); s.compress(Bitmap.CompressFormat.JPEG, q.coerceIn(30, 95), out)
        return ok("mime" to "image/jpeg", "base64" to android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP), "w" to s.width, "h" to s.height, "screenW" to soft.width, "screenH" to soft.height)
    }

    // ---- typing / focus -------------------------------------------------------------------------------------------
    private fun focused(): AccessibilityNodeInfo? = svc.rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)

    /** types into the focused field at the cursor (replacing a selection); the `hwnd` argument of the Windows version is ignored */
    private fun insert(text: String): JSONObject {
        val n = focused() ?: return fail("no focused text field")
        if (n.isPassword) return fail("that is a password field")
        val cur = if (n.isShowingHintText) "" else n.text?.toString().orEmpty()
        val a = n.textSelectionStart.takeIf { it in 0..cur.length } ?: cur.length
        val b = n.textSelectionEnd.takeIf { it in a..cur.length } ?: a
        val neu = cur.substring(0, a) + text + cur.substring(b)
        val set = n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, neu) })
        if (!set) { Clips.set(text); return if (n.performAction(AccessibilityNodeInfo.ACTION_PASTE)) ok() else fail("the field did not accept the text") }
        val pos = a + text.length
        n.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, Bundle().apply { putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, pos); putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, pos) })
        return ok()
    }

    fun pasteFocused() { focused()?.performAction(AccessibilityNodeInfo.ACTION_PASTE) }

    private fun focusRect(): JSONObject {
        val n = LokeyAccess.instance?.let { focused() }
        if (n == null) return obj("x" to 0, "y" to 0, "w" to dm.widthPixels, "h" to dm.heightPixels, "source" to "screen", "password" to false, "hwnd" to 0)
        val r = Rect(); n.getBoundsInScreen(r)
        return obj("x" to r.left, "y" to r.top, "w" to r.width(), "h" to r.height(), "source" to "uia", "password" to n.isPassword, "hwnd" to 0)
    }

    private fun selection(): JSONObject {
        val n = focused() ?: return obj("text" to null, "reason" to "no focused text field")
        if (n.isPassword) return obj("text" to null, "reason" to "password field")
        val t = n.text?.toString().orEmpty(); val a = n.textSelectionStart; val b = n.textSelectionEnd
        return if (a in 0 until b && b <= t.length) obj("text" to t.substring(a, b)) else obj("text" to null, "reason" to "nothing selected")
    }

    // ---- foreground / windows -------------------------------------------------------------------------------------
    private fun label(pkg: String) = runCatching { App.ctx.packageManager.let { it.getApplicationLabel(it.getApplicationInfo(pkg, 0)).toString() } }.getOrDefault(pkg)

    private fun foreground(): JSONObject {
        if (LokeyAccess.instance != null && LokeyAccess.fgPkg != null) return LokeyAccess.fg()
        // fallback: the usage-stats log, when usage access is granted
        if (Perms.granted("usage-access")) runCatching {
            val now = System.currentTimeMillis(); val ev = App.ctx.getSystemService(UsageStatsManager::class.java).queryEvents(now - 600_000, now); val e = UsageEvents.Event(); var pkg: String? = null
            while (ev.hasNextEvent()) { ev.getNextEvent(e); if (e.eventType == UsageEvents.Event.ACTIVITY_RESUMED) pkg = e.packageName }
            if (pkg != null) return obj("title" to label(pkg), "exe" to pkg, "pid" to 0)
        }
        return obj("title" to "", "exe" to "", "pid" to 0, "reason" to "needs the accessibility service or usage access")
    }

    private fun windows(): JSONArray {
        val w = svc.windows.filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }
        return arr(w.mapNotNull { win ->
            val pkg = win.root?.packageName?.toString() ?: return@mapNotNull null
            obj("hwnd" to win.id, "title" to (win.title?.toString() ?: label(pkg)), "exe" to pkg, "app" to label(pkg), "minimized" to false, "active" to win.isActive)
        })
    }

    private fun focusWindow(id: Int): JSONObject {
        val pkg = svc.windows.firstOrNull { it.id == id }?.root?.packageName?.toString() ?: return fail("that window is gone")
        return Apps.launch(pkg)
    }

    // ---- keys / mouse ---------------------------------------------------------------------------------------------
    private fun chord(name: String): JSONObject = when (name) {
        "back" -> global(AccessibilityService.GLOBAL_ACTION_BACK)
        "home" -> global(AccessibilityService.GLOBAL_ACTION_HOME)
        "recents" -> global(AccessibilityService.GLOBAL_ACTION_RECENTS)
        "notifications" -> global(AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS)
        "quick_settings" -> global(AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS)
        "power_menu" -> global(AccessibilityService.GLOBAL_ACTION_POWER_DIALOG)
        "split_screen" -> global(AccessibilityService.GLOBAL_ACTION_TOGGLE_SPLIT_SCREEN)
        "lock" -> if (Build.VERSION.SDK_INT >= 28) global(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN) else fail("needs Android 9")
        "screenshot" -> if (Build.VERSION.SDK_INT >= 28) global(AccessibilityService.GLOBAL_ACTION_TAKE_SCREENSHOT) else fail("needs Android 9")
        "volume_up", "volume_down", "mute", "play_pause", "next", "prev" -> keys(name)
        else -> fail("unknown shortcut: $name")
    }

    private fun mediaKey(code: Int): JSONObject {
        val a = App.ctx.getSystemService(android.media.AudioManager::class.java)
        a.dispatchMediaKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, code)); a.dispatchMediaKeyEvent(android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, code))
        return ok()
    }

    /** the keys that mean something on a touch phone; anything else is refused with a reason */
    private fun keys(combo: String): JSONObject {
        val k = combo.lowercase().replace(" ", "")
        val a = App.ctx.getSystemService(android.media.AudioManager::class.java)
        return when (k) {
            "back", "escape", "esc" -> global(AccessibilityService.GLOBAL_ACTION_BACK)
            "home" -> global(AccessibilityService.GLOBAL_ACTION_HOME)
            "recents", "alt+tab" -> global(AccessibilityService.GLOBAL_ACTION_RECENTS)
            "enter", "return" -> if (Build.VERSION.SDK_INT >= 30 && focused()?.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id) == true) ok() else fail("no focused field to press Enter in")
            "ctrl+a" -> focused()?.let { n -> val len = n.text?.length ?: 0; if (n.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, Bundle().apply { putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, 0); putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, len) })) ok() else fail("could not select") } ?: fail("no focused field")
            "ctrl+c" -> if (focused()?.performAction(AccessibilityNodeInfo.ACTION_COPY) == true) ok() else fail("nothing to copy")
            "ctrl+x" -> if (focused()?.performAction(AccessibilityNodeInfo.ACTION_CUT) == true) ok() else fail("nothing to cut")
            "ctrl+v" -> if (focused()?.performAction(AccessibilityNodeInfo.ACTION_PASTE) == true) ok() else fail("no focused field to paste into")
            "volume_up" -> { a.adjustStreamVolume(android.media.AudioManager.STREAM_MUSIC, android.media.AudioManager.ADJUST_RAISE, android.media.AudioManager.FLAG_SHOW_UI); ok() }
            "volume_down" -> { a.adjustStreamVolume(android.media.AudioManager.STREAM_MUSIC, android.media.AudioManager.ADJUST_LOWER, android.media.AudioManager.FLAG_SHOW_UI); ok() }
            "mute" -> { a.adjustStreamVolume(android.media.AudioManager.STREAM_MUSIC, android.media.AudioManager.ADJUST_TOGGLE_MUTE, android.media.AudioManager.FLAG_SHOW_UI); ok() }
            "play_pause", "media_play_pause" -> mediaKey(android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            "next", "media_next" -> mediaKey(android.view.KeyEvent.KEYCODE_MEDIA_NEXT)
            "prev", "media_prev" -> mediaKey(android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS)
            else -> fail("the key \"$combo\" is not available on Android (back, home, recents, enter, ctrl+a/c/x/v, volume and media keys are)")
        }
    }

    /** physical screen pixels, like the Windows version; `amount` = wheel notches (positive = down) */
    private fun mouse(p: JSONObject): JSONObject {
        val w = dm.widthPixels.toDouble(); val h = dm.heightPixels.toDouble()
        val x = p.num("x", w / 2); val y = p.num("y", h / 2)
        return when (p.str("action")) {
            "move" -> ok()
            "click" -> tap(x, y)
            "double" -> doubleTap(x, y)
            "right", "middle" -> longPress(x, y)
            "scroll" -> { val d = (Math.abs(p.num("amount", 3.0)) * 0.12 * h).coerceAtMost(h * 0.6); if (p.num("amount", 3.0) >= 0) swipe(x, y + d / 2, x, y - d / 2, 300) else swipe(x, y - d / 2, x, y + d / 2, 300) }
            "drag" -> swipe(x, y, p.num("toX", x), p.num("toY", y), 500)
            else -> fail("unknown mouse action")
        }
    }
}
