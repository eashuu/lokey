package app.lokey.link

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.view.View

/** a touch target in window coordinates: kind = action | prev | toggle | next | seek | hold */
class Hit(val rect: RectF, val kind: String, val faceId: String, val actionId: String = "")

/**
 * The island itself: one custom View (no WebView, no child views) drawn with Canvas. `t` runs 0 (compact capsule around the camera hole)
 * to 1 (expanded card); Island animates it and sizes the overlay window. Colours: black so it merges with the camera.
 */
class IslandView(c: Context) : View(c) {
    private val d = c.resources.displayMetrics.density
    private fun dp(v: Float) = v * d
    var compact = RectF(); var expanded = RectF()      // screen coordinates
    var winX = 0f; var winY = 0f
    var t = 0f
    var topInset = 0f                                  // from the card's top edge to where content starts (below the camera hole)
    var holeW = 0f
    companion object { const val EAR_DP = 50f }
    private val hits = ArrayList<Hit>()
    init { isClickable = true }

    private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF000000.toInt() }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val txt = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt(); typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL) }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val path = Path()
    private val ACCENT = 0xFF9D8BFF.toInt(); private val GRAY = 0xFFA0A3AE.toInt(); private val BTN = 0xFF2A2D36.toInt()

    // ---- layout helpers shared with Island -----------------------------------------------------------------------
    fun contentHeight(f: Face, many: Boolean): Float {
        val body = when (f.kind) {
            "music" -> 52f + 24f + 52f
            "voice", "idle" -> 52f + 46f + 8f
            else -> 52f + (if (IslandModel.progressOf(f, 0) != null || f.kind == "job") 14f else 0f) + (if (IslandModel.actionsOf(f).isEmpty()) 0f else 44f)
        }
        return topInset + dp(body + 16f + (if (many) 12f else 0f))
    }

    /** geometry follows the spring but never more than 4 % past the card, so the shape stays inside its window */
    private fun lerp(a: Float, b: Float) = a + (b - a) * minOf(t, 1.04f)

    // ---- drawing ------------------------------------------------------------------------------------------------
    override fun onDraw(cv: Canvas) {
        val f = Island.current() ?: return
        hits.clear()
        val r = RectF(lerp(compact.left, expanded.left) - winX, lerp(compact.top, expanded.top) - winY, lerp(compact.right, expanded.right) - winX, lerp(compact.bottom, expanded.bottom) - winY)
        val radius = lerp(compact.height() / 2f, dp(28f)).coerceIn(dp(8f), minOf(r.height(), r.width()) / 2f)
        cv.drawRoundRect(r, radius, radius, bg)
        val now = System.currentTimeMillis()
        val ca = (1f - t * 2.4f).coerceIn(0f, 1f)
        if (ca > 0f) drawCompact(cv, f, r, ca, now)
        val ea = ((t - 0.35f) / 0.65f).coerceIn(0f, 1f)
        if (ea > 0f) drawExpanded(cv, f, r, ea, now)
    }

    /** `rad` = half the box side. Images are fitted (aspect kept) into the box and never cut by a circle: the spirit is drawn whole; other icons (album art) get rounded corners only. */
    private fun drawIcon(cv: Canvas, f: Face, cx: Float, cy: Float, rad: Float, a: Float) {
        val bmp: Bitmap? = Island.iconFor(f)
        if (bmp != null && bmp.width > 0 && bmp.height > 0) {
            val s = Math.min(2 * rad / bmp.width, 2 * rad / bmp.height)
            val w = bmp.width * s; val h = bmp.height * s
            val dst = RectF(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
            fill.color = 0xFFFFFFFF.toInt(); fill.alpha = (255 * a).toInt(); fill.isFilterBitmap = true
            if (f.icon != null) { path.reset(); path.addRoundRect(dst, Math.min(w, h) * 0.22f, Math.min(w, h) * 0.22f, Path.Direction.CW); cv.save(); cv.clipPath(path); cv.drawBitmap(bmp, null, dst, fill); cv.restore() }
            else cv.drawBitmap(bmp, null, dst, fill)
        } else {   // fallback glyph: accent disc with an L
            fill.color = ACCENT; fill.alpha = (255 * a).toInt(); cv.drawCircle(cx, cy, rad, fill)
            txt.textSize = rad * 1.1f; txt.textAlign = Paint.Align.CENTER; txt.alpha = (255 * a).toInt(); txt.color = 0xFF000000.toInt()
            cv.drawText("L", cx, cy + rad * 0.4f, txt); txt.color = 0xFFFFFFFF.toInt()
        }
    }

    private fun label(cv: Canvas, s: String, x: Float, y: Float, size: Float, color: Int, a: Float, align: Paint.Align = Paint.Align.LEFT, maxW: Float = 0f, bold: Boolean = false) {
        txt.textSize = size; txt.color = color; txt.alpha = (255 * a).toInt(); txt.textAlign = align
        txt.typeface = Typeface.create("sans-serif-medium", if (bold) Typeface.BOLD else Typeface.NORMAL)
        val out = if (maxW > 0 && txt.measureText(s) > maxW) android.text.TextUtils.ellipsize(s, android.text.TextPaint(txt), maxW, android.text.TextUtils.TruncateAt.END).toString() else s
        cv.drawText(out, x, y, txt)
        txt.color = 0xFFFFFFFF.toInt(); txt.alpha = 255
    }

    private fun bars(cv: Canvas, cx: Float, cy: Float, a: Float, live: Boolean, now: Long) {
        fill.color = ACCENT; fill.alpha = (255 * a).toInt()
        for (i in 0 until 4) {
            val h = if (live) dp(5f) + dp(11f) * (0.5f + 0.5f * Math.sin(now / 130.0 + i * 1.7).toFloat()) else dp(5f)
            val x = cx + (i - 1.5f) * dp(5f)
            cv.drawRoundRect(RectF(x - dp(1.5f), cy - h / 2, x + dp(1.5f), cy + h / 2), dp(1.5f), dp(1.5f), fill)
        }
    }

    private fun ring(cv: Canvas, cx: Float, cy: Float, rad: Float, p: Double?, a: Float, now: Long) {
        stroke.strokeWidth = dp(2.5f); stroke.color = 0xFF2A2D36.toInt(); stroke.alpha = (255 * a).toInt()
        cv.drawCircle(cx, cy, rad, stroke)
        stroke.color = ACCENT; stroke.alpha = (255 * a).toInt()
        val box = RectF(cx - rad, cy - rad, cx + rad, cy + rad)
        if (p != null) cv.drawArc(box, -90f, (360 * p).toFloat(), false, stroke) else cv.drawArc(box, (now / 4 % 360).toFloat(), 100f, false, stroke)
    }

    private fun drawCompact(cv: Canvas, f: Face, r: RectF, a: Float, now: Long) {
        val h = compact.height(); val cy = r.top + h / 2f
        val ear = (compact.width() - holeW) / 2f
        drawIcon(cv, f, r.left + ear / 2f + dp(1f), cy, dp(14f), a)
        val rx = r.right - ear / 2f - dp(1f)
        when (f.kind) {
            "timer" -> if (f.endAt != null) label(cv, IslandModel.countdown(f.endAt - now), rx, cy + dp(4f), dp(11.5f), 0xFFFFFFFF.toInt(), a, Paint.Align.CENTER, ear - dp(4f), true)
                       else ring(cv, rx, cy, dp(9f), IslandModel.progressOf(f, now), a, now)
            "voice" -> bars(cv, rx, cy, a, true, now)
            "music" -> bars(cv, rx, cy, a, Island.musicPlaying(f), now)
            "job" -> ring(cv, rx, cy, dp(9f), IslandModel.progressOf(f, now), a, now)
            "approval" -> label(cv, "Allow?", rx, cy + dp(3.5f), dp(10.5f), 0xFFF0B429.toInt(), a, Paint.Align.CENTER, ear - dp(4f), true)
            "reminder" -> label(cv, "Due", rx, cy + dp(3.5f), dp(11f), 0xFFF0B429.toInt(), a, Paint.Align.CENTER, ear - dp(4f), true)
            "pc" -> label(cv, "PC", rx, cy + dp(3.5f), dp(11f), 0xFFFFFFFF.toInt(), a, Paint.Align.CENTER, ear - dp(4f), true)
            "charging" -> label(cv, f.title.take(5), rx, cy + dp(3.5f), dp(11f), 0xFF4ADE80.toInt(), a, Paint.Align.CENTER, ear - dp(4f), true)
        }
    }

    private fun button(cv: Canvas, rc: RectF, text: String, primary: Boolean, a: Float, kind: String, f: Face, id: String) {
        fill.color = if (primary) 0xFFFFFFFF.toInt() else BTN; fill.alpha = (255 * a).toInt()
        cv.drawRoundRect(rc, rc.height() / 2, rc.height() / 2, fill)
        label(cv, text, rc.centerX(), rc.centerY() + dp(4.5f), dp(14f), if (primary) 0xFF000000.toInt() else 0xFFFFFFFF.toInt(), a, Paint.Align.CENTER, rc.width() - dp(12f), true)
        hits += Hit(rc, kind, f.id, id)
    }

    private fun glyph(cv: Canvas, kind: String, cx: Float, cy: Float, s: Float, color: Int, a: Float) {
        fill.color = color; fill.alpha = (255 * a).toInt(); path.reset()
        when (kind) {
            "play" -> { path.moveTo(cx - s * 0.35f, cy - s * 0.5f); path.lineTo(cx + s * 0.55f, cy); path.lineTo(cx - s * 0.35f, cy + s * 0.5f); path.close() }
            "pause" -> { path.addRect(cx - s * 0.4f, cy - s * 0.5f, cx - s * 0.12f, cy + s * 0.5f, Path.Direction.CW); path.addRect(cx + s * 0.12f, cy - s * 0.5f, cx + s * 0.4f, cy + s * 0.5f, Path.Direction.CW) }
            "next" -> { path.moveTo(cx - s * 0.5f, cy - s * 0.45f); path.lineTo(cx + s * 0.25f, cy); path.lineTo(cx - s * 0.5f, cy + s * 0.45f); path.close(); path.addRect(cx + s * 0.3f, cy - s * 0.45f, cx + s * 0.5f, cy + s * 0.45f, Path.Direction.CW) }
            "prev" -> { path.moveTo(cx + s * 0.5f, cy - s * 0.45f); path.lineTo(cx - s * 0.25f, cy); path.lineTo(cx + s * 0.5f, cy + s * 0.45f); path.close(); path.addRect(cx - s * 0.5f, cy - s * 0.45f, cx - s * 0.3f, cy + s * 0.45f, Path.Direction.CW) }
        }
        cv.drawPath(path, fill)
    }

    private fun drawExpanded(cv: Canvas, f: Face, r: RectF, a: Float, now: Long) {
        val pad = dp(18f); val x0 = r.left + pad; val x1 = r.right - pad
        var y = r.top + topInset
        drawIcon(cv, f, x0 + dp(20f), y + dp(22f), dp(20f), a)
        val tx = x0 + dp(52f)
        val timerText = if (f.kind == "timer" && f.endAt != null) IslandModel.countdown(f.endAt - now) else null
        val titleW = x1 - tx - (if (timerText != null) dp(80f) else 0f)
        label(cv, f.title, tx, y + dp(19f), dp(16f), 0xFFFFFFFF.toInt(), a, Paint.Align.LEFT, titleW, true)
        if (f.subtitle.isNotEmpty()) label(cv, f.subtitle, tx, y + dp(38f), dp(13f), GRAY, a, Paint.Align.LEFT, titleW)
        if (timerText != null) label(cv, timerText, x1, y + dp(30f), dp(24f), 0xFFFFFFFF.toInt(), a, Paint.Align.RIGHT, 0f, true)
        y += dp(52f)
        val cur = Island.current()?.id
        when (f.kind) {
            "music" -> {
                val (pos, dur) = Island.musicPos(f)
                val bar = RectF(x0, y + dp(6f), x1, y + dp(10f))
                fill.color = BTN; fill.alpha = (255 * a).toInt(); cv.drawRoundRect(bar, dp(2f), dp(2f), fill)
                val p = if (dur > 0) (pos.toFloat() / dur).coerceIn(0f, 1f) else (f.progress ?: 0.0).toFloat()
                fill.color = 0xFFFFFFFF.toInt(); fill.alpha = (255 * a).toInt(); cv.drawRoundRect(RectF(x0, bar.top, x0 + bar.width() * p, bar.bottom), dp(2f), dp(2f), fill)
                if (dur > 0) { label(cv, IslandModel.countdown(pos), x0, y + dp(23f), dp(10.5f), GRAY, a); label(cv, IslandModel.countdown(dur), x1, y + dp(23f), dp(10.5f), GRAY, a, Paint.Align.RIGHT) }
                hits += Hit(RectF(x0, y, x1, y + dp(16f)), "seek", f.id)
                y += dp(24f)
                val cy = y + dp(26f); val cx = (x0 + x1) / 2
                glyph(cv, "prev", cx - dp(80f), cy, dp(20f), 0xFFFFFFFF.toInt(), a); hits += Hit(RectF(cx - dp(112f), cy - dp(24f), cx - dp(48f), cy + dp(24f)), "prev", f.id)
                fill.color = 0xFFFFFFFF.toInt(); fill.alpha = (255 * a).toInt(); cv.drawCircle(cx, cy, dp(22f), fill)
                glyph(cv, if (Island.musicPlaying(f)) "pause" else "play", cx, cy, dp(18f), 0xFF000000.toInt(), a); hits += Hit(RectF(cx - dp(26f), cy - dp(26f), cx + dp(26f), cy + dp(26f)), "toggle", f.id)
                glyph(cv, "next", cx + dp(80f), cy, dp(20f), 0xFFFFFFFF.toInt(), a); hits += Hit(RectF(cx + dp(48f), cy - dp(24f), cx + dp(112f), cy + dp(24f)), "next", f.id)
                y += dp(52f)
            }
            "voice", "idle" -> {
                val b = RectF(x0, y, x1, y + dp(46f))
                fill.color = ACCENT; fill.alpha = (255 * a * (if (Island.holding) 1f else 0.85f)).toInt(); cv.drawRoundRect(b, dp(23f), dp(23f), fill)
                label(cv, if (Island.holding) "Listening..." else "Hold to talk", b.centerX(), b.centerY() + dp(5f), dp(15f), 0xFF000000.toInt(), a, Paint.Align.CENTER, 0f, true)
                hits += Hit(b, "hold", f.id)
                y += dp(54f)
            }
            else -> {
                val p = IslandModel.progressOf(f, now)
                if (p != null || f.kind == "job") {
                    val bar = RectF(x0, y + dp(4f), x1, y + dp(8f))
                    fill.color = BTN; fill.alpha = (255 * a).toInt(); cv.drawRoundRect(bar, dp(2f), dp(2f), fill)
                    fill.color = ACCENT; fill.alpha = (255 * a).toInt()
                    if (p != null) cv.drawRoundRect(RectF(x0, bar.top, x0 + bar.width() * p.toFloat(), bar.bottom), dp(2f), dp(2f), fill)
                    else { val w = bar.width() * 0.3f; val s = x0 + (bar.width() - w) * (0.5f + 0.5f * Math.sin(now / 500.0).toFloat()); cv.drawRoundRect(RectF(s, bar.top, s + w, bar.bottom), dp(2f), dp(2f), fill) }
                    y += dp(14f)
                }
                val acts = IslandModel.actionsOf(f).take(3)
                if (acts.isNotEmpty()) {
                    val gap = dp(8f); val w = (x1 - x0 - gap * (acts.size - 1)) / acts.size
                    acts.forEachIndexed { i, ac -> button(cv, RectF(x0 + i * (w + gap), y, x0 + i * (w + gap) + w, y + dp(40f)), ac.label, ac.primary, a, "action", f, ac.id) }
                    y += dp(44f)
                }
            }
        }
        val n = Island.count()
        if (n > 1) for (i in 0 until n) {
            fill.color = if (Island.indexOf(cur) == i) 0xFFFFFFFF.toInt() else 0xFF55585F.toInt(); fill.alpha = (255 * a).toInt()
            cv.drawCircle((r.left + r.right) / 2 + (i - (n - 1) / 2f) * dp(10f), r.bottom - dp(10f), dp(2.5f), fill)
        }
    }

    // ---- touch --------------------------------------------------------------------------------------------------
    private var downX = 0f; private var downY = 0f; private var moved = false; private var downHit: Hit? = null; private var lastTap = 0L; private var prevExpanded = false
    private val longPress = Runnable { Island.holding = true; performHapticFeedback(HapticFeedbackConstants.LONG_PRESS); Island.hold(true); invalidate() }

    private fun hitAt(x: Float, y: Float) = if (Island.expanded && t > 0.9f) hits.firstOrNull { it.rect.contains(x, y) } else null

    override fun onTouchEvent(e: MotionEvent): Boolean {
        val slop = dp(10f)
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = e.x; downY = e.y; moved = false; downHit = hitAt(e.x, e.y)
                if (downHit == null || downHit!!.kind == "hold") App.ui.postDelayed(longPress, 420)
            }
            MotionEvent.ACTION_MOVE -> if (!moved && (Math.abs(e.x - downX) > slop || Math.abs(e.y - downY) > slop)) { moved = true; if (!Island.holding) App.ui.removeCallbacks(longPress) }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                App.ui.removeCallbacks(longPress)
                if (Island.holding) { Island.holding = false; Island.hold(false); invalidate(); return true }
                if (e.actionMasked == MotionEvent.ACTION_CANCEL) return true
                val dx = e.x - downX; val dy = e.y - downY
                when {
                    moved && Math.abs(dx) > dp(48f) && Math.abs(dx) > Math.abs(dy) -> Island.cycle(if (dx < 0) 1 else -1)
                    moved && dy < -dp(36f) -> Island.expand(false)
                    moved -> {}
                    downHit != null && downHit!!.kind != "hold" -> Island.perform(downHit!!, e.x, e.y)
                    downHit == null -> {
                        val now = System.currentTimeMillis()
                        if (now - lastTap < 320) { lastTap = 0; Island.expand(prevExpanded); Island.double() }
                        else { lastTap = now; prevExpanded = Island.expanded; if (!Island.expanded) Island.tap(); Island.expand(!Island.expanded) }
                    }
                }
            }
        }
        return true
    }

    /** fraction (0..1) along the seek bar for window x */
    fun seekFraction(hit: Hit, x: Float): Float = ((x - hit.rect.left) / hit.rect.width()).coerceIn(0f, 1f)
}
