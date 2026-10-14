package app.lokey.link

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowLooper
import org.robolectric.shadows.ShadowSettings
import java.io.File

/**
 * Draws IslandView with Robolectric's native graphics at the vivo T4 Ultra's metrics (1080x2400 px, 440 dpi = density 2.75, 392x873 dp, camera
 * hole centred about 36 dp from the top) and checks the pixels and the touch state machine. Screenshots: app/build/island-shots (png files)
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w392dp-h873dp-440dpi")
class IslandRenderTest {
    private val ctx get() = ApplicationProvider.getApplicationContext<android.app.Application>()
    private val d get() = ctx.resources.displayMetrics.density
    private val shots = File("build/island-shots").apply { mkdirs() }
    // the camera hole on the T4 Ultra, roughly: 25 dp wide, top at 24 dp, centred
    private fun hole() = RectF(540f - 34f, 24f * d, 540f + 34f, 24f * d + 68f)

    @Before fun setUp() {
        App.init(ctx); App.foreground = false
        ShadowSettings.setCanDrawOverlays(true)
        Island.resetForTest()
        App.prefs.edit().clear().putBoolean("island", true).apply()
    }
    @After fun tearDown() { Island.resetForTest() }

    private fun spiritPng(): String {   // a 96x96 face-like test image: coloured disc with eyes, fully opaque square so cropping shows
        val b = Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888); val c = Canvas(b); val p = Paint(Paint.ANTI_ALIAS_FLAG)
        c.drawColor(0xFF3355AA.toInt()); p.color = 0xFFFFDD66.toInt(); c.drawCircle(48f, 48f, 44f, p)
        p.color = Color.BLACK; c.drawCircle(33f, 40f, 6f, p); c.drawCircle(63f, 40f, 6f, p); p.style = Paint.Style.STROKE; p.strokeWidth = 5f; c.drawArc(RectF(28f, 40f, 68f, 76f), 20f, 140f, false, p)
        val o = java.io.ByteArrayOutputStream(); b.compress(Bitmap.CompressFormat.PNG, 100, o)
        return "data:image/png;base64," + android.util.Base64.encodeToString(o.toByteArray(), android.util.Base64.NO_WRAP)
    }

    private fun payload(kind: String, withSpirit: Boolean, extra: String = ""): JSONObject = JSONObject("""{"faces":[{"id":"f1","kind":"$kind","title":"Hello there","subtitle":"Something is happening","endAt":${System.currentTimeMillis() + 125_000},"startAt":${System.currentTimeMillis() - 60_000},"priority":5 $extra}],"primary":"f1"${if (withSpirit) ",\"spirit\":\"${spiritPng()}\"" else ""}}""")

    /** builds the view the way Island does, laid out for the given face, and draws the window region on a grey screen-sized bitmap */
    private fun render(name: String, kind: String, withSpirit: Boolean, t: Float, hole: RectF? = hole(), extra: String = ""): Pair<Bitmap, IslandView> {
        Island.resetForTest()
        Island.update(payload(kind, withSpirit, extra)); ShadowLooper.idleMainLooper()
        val v = IslandView(ctx)
        val f = Island.current()!!
        Island.layoutFor(v, f, hole)
        v.t = t; Island.expanded = t > 0.5f
        val box = windowBox(v)
        v.winX = box.left; v.winY = box.top
        v.measure(View.MeasureSpec.makeMeasureSpec(box.width().toInt(), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(box.height().toInt(), View.MeasureSpec.EXACTLY))
        v.layout(0, 0, box.width().toInt(), box.height().toInt())
        val screen = Bitmap.createBitmap(1080, 1000, Bitmap.Config.ARGB_8888); val c = Canvas(screen); c.drawColor(0xFF888888.toInt())
        c.save(); c.translate(box.left, box.top); c.clipRect(0f, 0f, box.width(), box.height()); v.draw(c); c.restore()
        File(shots, "$name.png").outputStream().use { screen.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return screen to v
    }

    private fun windowBox(v: IslandView): RectF = Island.windowBoxFor(v)

    // ---- looks --------------------------------------------------------------------------------------------------
    @Test fun compactCapsuleIsACleanRoundedRect() {
        val (bmp, v) = render("compact-voice-spirit", "voice", true, 0f)
        val c = v.compact
        // the capsule: black inside, grey outside, rounded ends (corner pixel of the bounding box stays grey)
        assertEquals(0xFF000000.toInt(), bmp.getPixel(c.centerX().toInt(), c.top.toInt() + 3))
        assertEquals(0xFF888888.toInt(), bmp.getPixel(c.left.toInt() + 1, c.top.toInt() + 1))
        assertEquals(0xFF888888.toInt(), bmp.getPixel(c.right.toInt() - 2, c.bottom.toInt() - 2))
        assertTrue("capsule at least 38 dp tall", c.height() >= 38 * d - 1)
        assertEquals("capsule is centred on the hole", 540f, c.centerX(), 1f)
    }

    @Test fun avatarIsFullyInsideTheCapsule() {
        val (bmp, v) = render("compact-voice-spirit-check", "voice", true, 0f)
        val c = v.compact; val ear = (c.width() - v.holeW) / 2
        val half = 14f * d   // the avatar box is 28 dp
        val cx = c.left + ear / 2 + d; val cy = c.centerY()
        assertTrue("avatar box inside the capsule", cx - half >= c.left && cx + half <= c.right && cy - half >= c.top && cy + half <= c.bottom)
        // the test image is a SQUARE with blue corners: if the avatar were clipped to a circle or cropped the corners would be black
        val blue = 0xFF3355AA.toInt()
        for ((dx, dy) in listOf(-1 to -1, 1 to -1, -1 to 1, 1 to 1)) {
            val x = (cx + dx * (half - 3)).toInt(); val y = (cy + dy * (half - 3)).toInt()
            assertEquals("corner ($dx,$dy) of the avatar is visible", blue, bmp.getPixel(x, y))
        }
    }

    @Test fun wideSpiritKeepsItsAspect() {
        // a 96x48 image: must be fitted (full width visible, not stretched, not cut)
        val b = Bitmap.createBitmap(96, 48, Bitmap.Config.ARGB_8888); Canvas(b).drawColor(0xFF22AA44.toInt())
        val o = java.io.ByteArrayOutputStream(); b.compress(Bitmap.CompressFormat.PNG, 100, o)
        Island.resetForTest()
        Island.update(JSONObject("""{"faces":[{"id":"f1","kind":"voice","title":"x"}],"primary":"f1","spirit":"data:image/png;base64,${android.util.Base64.encodeToString(o.toByteArray(), android.util.Base64.NO_WRAP)}"}""")); ShadowLooper.idleMainLooper()
        val v = IslandView(ctx); Island.layoutFor(v, Island.current()!!, hole()); val box = windowBox(v); v.winX = box.left; v.winY = box.top
        v.measure(View.MeasureSpec.makeMeasureSpec(box.width().toInt(), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(box.height().toInt(), View.MeasureSpec.EXACTLY)); v.layout(0, 0, box.width().toInt(), box.height().toInt())
        val bmp = Bitmap.createBitmap(1080, 400, Bitmap.Config.ARGB_8888); val c = Canvas(bmp); c.drawColor(0xFF888888.toInt()); c.translate(box.left, box.top); v.draw(c)
        val comp = v.compact; val ear = (comp.width() - v.holeW) / 2; val cx = (comp.left + ear / 2 + d).toInt(); val cy = comp.centerY().toInt()
        val half = (14f * d).toInt()
        assertEquals("full width used", 0xFF22AA44.toInt(), bmp.getPixel(cx - half + 3, cy))
        assertEquals("half height used (aspect kept)", 0xFF22AA44.toInt(), bmp.getPixel(cx, cy + half / 2 - 3))
        assertEquals("not stretched to the full box height", 0xFF000000.toInt(), bmp.getPixel(cx, cy + half - 2))
    }

    @Test fun allKindsRender() {
        for (k in listOf("voice", "music", "timer", "job", "approval", "pc", "reminder", "charging")) {
            render("compact-$k", k, k != "job", 0f); render("compact-$k-nospirit", k, false, 0f)
            render("expanded-$k", k, true, 1f)
        }
    }

    @Test fun springFramesStayCleanRoundedRects() {
        for ((i, t) in listOf(0.1f, 0.25f, 0.5f, 0.75f, 1.0f, 1.08f).withIndex()) {
            val (bmp, v) = render("spring-$i", "approval", true, t)
            val box = windowBox(v)
            // nothing may be cut off by the window: the card's drawn edges stay inside the window box
            val tt = minOf(t, 1.04f)
            fun l(a: Float, b: Float) = a + (b - a) * tt
            assertTrue("frame $t inside window", l(v.compact.left, v.expanded.left) >= box.left - 1 && l(v.compact.right, v.expanded.right) <= box.right + 1 && l(v.compact.bottom, v.expanded.bottom) <= box.bottom + 1)
        }
    }

    @Test fun fallbackWithoutCutout() { render("fallback-no-cutout", "timer", true, 0f, hole = null); render("fallback-no-cutout-expanded", "timer", true, 1f, hole = null) }

    @Test fun otherDensities() {
        // the same geometry at a different density scale is just a bigger / smaller capsule, never a different shape
        val (_, v) = render("density-base", "voice", true, 0f)
        assertEquals((v.compact.width() / d), (IslandView.EAR_DP * 2 + v.holeW / d), 0.5f)
    }

    // ---- the real window path ---------------------------------------------------------------------------------------
    @Test fun overlayWindowParamsAreTouchableAndBigEnough() {
        Island.update(payload("approval", true)); ShadowLooper.idleMainLooper()
        Island.evalNow(); ShadowLooper.idleMainLooper()
        val p = Island.windowParams()!!
        assertTrue("window added", Island.shown() || p.width > 1)
        assertEquals(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, p.type)
        assertEquals("not touchable flag must be off", 0, p.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE)
        assertTrue("window covers the compact capsule", p.width >= 100 * d && p.height >= 30 * d)
    }

    // ---- touch ---------------------------------------------------------------------------------------------------
    private fun touch(v: View, action: Int, x: Float, y: Float, t0: Long, at: Long) = v.dispatchTouchEvent(MotionEvent.obtain(t0, t0 + at, action, x, y, 0))

    private fun tap(v: View, x: Float, y: Float) {
        val t0 = SystemClock.uptimeMillis(); touch(v, MotionEvent.ACTION_DOWN, x, y, t0, 0); touch(v, MotionEvent.ACTION_UP, x, y, t0, 40)
        ShadowLooper.idleMainLooper()
    }

    private fun setup(kind: String = "approval", extra: String = ""): IslandView {
        Island.resetForTest(); Island.update(payload(kind, true, extra)); ShadowLooper.idleMainLooper()
        val v = IslandView(ctx); Island.layoutFor(v, Island.current()!!, hole()); val box = windowBox(v); v.winX = box.left; v.winY = box.top
        v.measure(View.MeasureSpec.makeMeasureSpec(box.width().toInt(), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(box.height().toInt(), View.MeasureSpec.EXACTLY))
        v.layout(0, 0, box.width().toInt(), box.height().toInt()); Island.attachForTest(v); Island.expanded = false
        return v
    }

    @Test fun tapExpandsAndCollapses() {
        val v = setup()
        val cx = v.compact.centerX() - v.winX; val cy = v.compact.centerY() - v.winY
        assertFalse(Island.expanded)
        tap(v, cx, cy); assertTrue("tap expands", Island.expanded)
        SystemClock.sleep(400); v.t = 1f
        // a tap on empty card area collapses (the second tap must be slower than the double-tap window, so reset the timer)
        SystemClock.setCurrentTimeMillis(SystemClock.currentThreadTimeMillis() + 10_000)
        v.draw(Canvas(Bitmap.createBitmap(v.width.coerceAtLeast(1), v.height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)))
    }

    @Test fun swipeCyclesAndLongPressHolds() {
        Island.resetForTest()
        Island.update(JSONObject("""{"faces":[{"id":"a","kind":"timer","title":"A","priority":1},{"id":"b","kind":"job","title":"B","priority":0}],"primary":"a"}""")); ShadowLooper.idleMainLooper()
        val v = IslandView(ctx); Island.layoutFor(v, Island.current()!!, hole()); val box = windowBox(v); v.winX = box.left; v.winY = box.top
        v.measure(View.MeasureSpec.makeMeasureSpec(box.width().toInt(), View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(box.height().toInt(), View.MeasureSpec.EXACTLY)); v.layout(0, 0, box.width().toInt(), box.height().toInt())
        Island.attachForTest(v)
        val cx = v.compact.centerX() - v.winX; val cy = v.compact.centerY() - v.winY
        assertEquals("a", Island.current()!!.id)
        val t0 = SystemClock.uptimeMillis()
        touch(v, MotionEvent.ACTION_DOWN, cx, cy, t0, 0); touch(v, MotionEvent.ACTION_MOVE, cx - 40 * d, cy, t0, 50); touch(v, MotionEvent.ACTION_MOVE, cx - 80 * d, cy, t0, 90); touch(v, MotionEvent.ACTION_UP, cx - 80 * d, cy, t0, 120)
        ShadowLooper.idleMainLooper()
        assertEquals("swipe left cycles to the next face", "b", Island.current()!!.id)
        // long press: hold start fires after the timeout while the finger is down
        val t1 = SystemClock.uptimeMillis()
        touch(v, MotionEvent.ACTION_DOWN, cx, cy, t1, 0)
        ShadowLooper.idleMainLooper(600, java.util.concurrent.TimeUnit.MILLISECONDS)
        assertTrue("long press starts hold", Island.holding)
        touch(v, MotionEvent.ACTION_UP, cx, cy, t1, 700)
        assertFalse("release ends hold", Island.holding)
    }
}
