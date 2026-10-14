package app.lokey.link

import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * bg.ui: the UI tree of the second screen through the Lokey accessibility service (AccessibilityService.getWindowsOnAllDisplays, Android 11+).
 * Same node fields as `ui.tree` (see PLUGIN.md); bounds are in the virtual display's own pixels, which is what bg.tap takes.
 * Whether the service can see windows of a display another process created is NOT verified on a phone: when it cannot, ShizukuApi
 * falls back to uiautomator inside the shell process.
 */
object BgUi {
    private fun svc(): LokeyAccess = LokeyAccess.instance ?: throw Fail("needs the Lokey accessibility service (perm.request accessibility)")

    private fun root(display: Int): AccessibilityNodeInfo {
        if (Build.VERSION.SDK_INT < 30) throw Fail("reading another display needs Android 11")
        val wins = svc().windowsOnAllDisplays.get(display) ?: throw Fail("the accessibility service sees no windows on display $display")
        val w = wins.filter { it.type == AccessibilityWindowInfo.TYPE_APPLICATION }.maxByOrNull { it.layer } ?: wins.firstOrNull { it.root != null }
            ?: throw Fail("no app window on display $display yet")
        return w.root ?: throw Fail("the window on display $display is not readable (secure window, or still starting)")
    }

    fun tree(display: Int, max: Int): JSONObject {
        val root = root(display)
        val out = JSONArray()
        var n = 0
        fun walk(x: AccessibilityNodeInfo, depth: Int) {
            if (n >= max || depth > 45 || !x.isVisibleToUser) return
            val pwd = x.isPassword
            val text = if (pwd) null else (x.text?.toString() ?: x.hintText?.toString())?.take(200)?.takeIf { it.isNotEmpty() }
            val desc = x.contentDescription?.toString()?.take(120)?.takeIf { it.isNotEmpty() }
            if (text != null || desc != null || x.isClickable || x.isEditable || x.isScrollable || x.isCheckable) {
                val r = Rect(); x.getBoundsInScreen(r)
                val o = obj("id" to n, "cls" to (x.className?.toString()?.substringAfterLast('.') ?: ""), "b" to arr(listOf(r.left, r.top, r.right, r.bottom)))
                text?.let { o.put("text", it) }; desc?.let { o.put("desc", it) }
                x.viewIdResourceName?.let { o.put("res", it.substringAfter(":id/")) }
                if (x.isClickable) o.put("click", true); if (x.isLongClickable) o.put("long", true); if (x.isEditable) o.put("edit", true)
                if (x.isScrollable) o.put("scroll", true); if (x.isCheckable) o.put("checked", x.isChecked); if (x.isFocused) o.put("focus", true)
                if (pwd) o.put("password", true); if (!x.isEnabled) o.put("disabled", true)
                out.put(o); n++
            }
            for (i in 0 until x.childCount) x.getChild(i)?.let { walk(it, depth + 1) }
        }
        walk(root, 0)
        return ok("pkg" to root.packageName?.toString(), "displayId" to display, "count" to out.length(), "truncated" to (n >= max), "nodes" to out, "source" to "accessibility")
    }

    /** typing for characters the key map does not have (Tamil, emoji...): sets the text of the focused field of that display. Never into a password field. */
    fun setText(display: Int, text: String): JSONObject {
        if (display < 0) throw Fail("no second screen yet")
        val f = root(display).findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: throw Fail("no text field is focused on the second screen; tap one first")
        if (f.isPassword) throw Fail("that is a password field; Lokey does not type there")
        val cur = if (f.isShowingHintText) "" else f.text?.toString().orEmpty()
        val b = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, cur + text) }
        if (!f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, b)) throw Fail("the field refused the text")
        return ok("typed" to text.length, "via" to "accessibility")
    }
}
