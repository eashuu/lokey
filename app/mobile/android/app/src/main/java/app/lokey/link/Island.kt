package app.lokey.link

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.PixelFormat
import android.graphics.RectF
import android.os.Build
import android.os.PowerManager
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * The system-wide island: a black capsule in a TYPE_APPLICATION_OVERLAY window around the camera cutout (top-centre under the status bar
 * when there is none) that springs open into a card per activity. The NATIVE layer is authoritative: whether it shows is decided here from
 * the activity lifecycle (MainActivity started / stopped), the lock screen and settings kept in SharedPreferences, never from the page.
 * The page only sends faces (`island.update`) and settings once; its faces expire (IslandPolicy.alive) if it stops refreshing them, while
 * music, reminders, the PC link approvals and the idle capsule keep going natively. Unverified on a phone.
 */
object Island {
    private val ctx get() = App.ctx
    @Volatile private var pageFaces: List<Face> = emptyList()
    @Volatile private var pageAt = 0L
    @Volatile private var primary: String? = null
    @Volatile private var ordered: List<Face> = emptyList()
    private var currentId: String? = null
    private var manualAt = 0L
    @Volatile var expanded = false
    @Volatile var holding = false
    @Volatile var cameFromBackground = false
    @Volatile var lastReason = "not evaluated yet"
    @Volatile private var wakeUntil = 0L
    private var restored = false
    private var spiritSavedAt = 0L

    private var sig = 0
    private var liveSig = 0
    private var orderSig = 0
    private var approvals = emptySet<String>()
    private var spiritKey = 0
    private var spirit: Bitmap? = null
    private val icons = HashMap<Int, Bitmap?>()

    private var music: Face? = null
    private var musicPos = 0L; private var musicDur = 0L; private var musicAt = 0L; private var lastPlayingAt = 0L

    private var view: IslandView? = null
    private var lp: WindowManager.LayoutParams? = null
    private var anim: ValueAnimator? = null
    private var started = false
    val atomic: AtomicIslandAdapter = VivoIsland

    private fun d() = ctx.resources.displayMetrics.density
    private fun wm() = ctx.getSystemService(WindowManager::class.java)

    /** the user switch for the system island (default on: granting the overlay permission is then enough) */
    fun enabled() = App.prefs.getBoolean("island", true)
    fun alwaysVisible() = App.prefs.getBoolean("island_always", true)
    fun wanted() = enabled() && Perms.granted("overlay")
    fun shown() = view?.isAttachedToWindow == true && view?.visibility == View.VISIBLE

    // ---- model --------------------------------------------------------------------------------------------------
    fun current(): Face? = ordered.firstOrNull { it.id == currentId } ?: ordered.firstOrNull()
    fun count() = ordered.size
    fun indexOf(id: String?) = ordered.indexOfFirst { it.id == id }.coerceAtLeast(0)

    fun iconFor(f: Face): Bitmap? {
        val s = f.icon ?: return spirit
        val k = s.hashCode()
        return icons.getOrPut(k) { if (icons.size > 12) icons.clear(); decode(s) } ?: spirit
    }

    private fun decode(s: String): Bitmap? = runCatching { Base64.decode(s.substringAfter(','), Base64.DEFAULT).let { BitmapFactory.decodeByteArray(it, 0, it.size) } }.getOrNull()

    fun musicPlaying(f: Face): Boolean = if (f.id == NATIVE_MUSIC) MediaApi.playing() else true
    fun musicPos(f: Face): Pair<Long, Long> = if (f.id == NATIVE_MUSIC) {
        val s = if (MediaApi.playing()) System.currentTimeMillis() - musicAt else 0L
        (musicPos + s).coerceAtMost(if (musicDur > 0) musicDur else Long.MAX_VALUE) to musicDur
    } else 0L to 0L

    private fun refreshMusic(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - musicAt < 800) return
        val s = runCatching { MediaApi.state() }.getOrNull()
        if (s == null || !s.optBoolean("hasSession") || s.optString("title").isEmpty()) { music = null; return }
        val playing = s.optBoolean("playing")
        if (playing) lastPlayingAt = now
        musicPos = s.optLong("positionMs"); musicDur = s.optLong("durationMs"); musicAt = now
        if (!playing && now - lastPlayingAt > 30_000) { music = null; return }
        val art = if (s.isNull("art")) null else s.optString("art").ifEmpty { null }
        music = Face(NATIVE_MUSIC, "music", s.optString("title"), s.optString("artist"), if (musicDur > 0) musicPos.toDouble() / musicDur else null, icon = art, priority = 40)
    }

    /** every face there is right now: the page faces (while fresh), the PC link, reminders, wake "listening", music, and the idle capsule */
    internal fun allFaces(now: Long): List<Face> {
        val page = pageFaces.filter { IslandPolicy.alive(it, pageAt, now) }
        val native = LinkClient.faces() + Reminders.faces(now) + listOfNotNull(if (now < wakeUntil) Face("wake-listening", "voice", "Listening", "Lokey heard you", endAt = wakeUntil, priority = 95) else null)
        val idle = if (alwaysVisible()) listOf(Face("idle", "idle", "Lokey")) else emptyList()
        return IslandModel.merge(IslandPolicy.mergeLink(page, native) + idle, music)
    }

    private fun recompute() {
        val all = allFaces(System.currentTimeMillis())
        ordered = IslandModel.order(IslandModel.visible(all, alwaysVisible()), primary)
        val manual = System.currentTimeMillis() - manualAt < 8000
        if (!manual || ordered.none { it.id == currentId }) currentId = (ordered.firstOrNull { it.id == primary } ?: ordered.firstOrNull())?.id
    }

    private var liveTickOn = false
    /** keeps the notifications honest when no overlay (and so no overlay ticker) runs: faces that expired are noticed within 5 s, music is refreshed */
    private val liveTick = Runnable { liveTickOn = false; refreshMusic(); recompute(); syncLive() }

    /** posts the Live Update notifications for the activity faces and auto-opens a new approval */
    private fun syncLive() {
        val live = ordered.filter { it.kind in IslandModel.LIVE_KINDS }
        val pill = ordered.filter { it.kind != "idle" }   // the vivo pill also shows music and charging
        val s = live.hashCode()
        if (s != liveSig) { liveSig = s; LiveUpdates.sync(ctx, live) }
        VivoSuperX.publish(ctx, pill)   // cheap when nothing changed: the coalescer compares what would go on the wire
        if (pill.isNotEmpty() && !liveTickOn) { liveTickOn = true; App.ui.postDelayed(liveTick, 5000) }
        val ap = live.filter { it.kind == "approval" }.map { it.id }.toSet()
        (ap - approvals).firstOrNull()?.let { currentId = it; manualAt = 0; expand(true) }
        approvals = ap
    }

    /** a native source changed (link card, reminder, wake): recompute, update notifications and the overlay */
    fun nativeChanged() { App.ui.post { restore(); recompute(); syncLive(); evalMain() } }

    fun wakeListening(ms: Long) { wakeUntil = System.currentTimeMillis() + ms; nativeChanged(); App.ui.postDelayed({ nativeChanged() }, ms + 300) }

    /** the page faces survive process death (they still expire by IslandPolicy.alive) */
    private fun restore() {
        if (restored) return
        restored = true
        if (pageFaces.isNotEmpty()) return
        runCatching {
            val j = JSONObject(App.prefs.getString("island_faces", null) ?: return)
            val u = IslandModel.parse(j)
            pageFaces = u.faces; primary = u.primary; pageAt = j.optLong("at")
        }
        runCatching { App.prefs.getString("island_spirit", null)?.let { spirit = decode(it) } }
    }

    // ---- JS side ------------------------------------------------------------------------------------------------
    fun update(p: JSONObject): JSONObject {
        restored = true
        val u = IslandModel.parse(p)
        val now = System.currentTimeMillis()
        pageAt = now; Diag.page(now)
        u.spirit?.let { s ->
            val k = s.hashCode()
            if (k != spiritKey) { spiritKey = k; spirit = decode(s); if (now - spiritSavedAt > 30_000) { spiritSavedAt = now; App.prefs.edit().putString("island_spirit", s).apply() } }
        }
        val s = u.faces.hashCode() * 31 + (u.primary?.hashCode() ?: 0)
        if (s != sig) {   // the spirit image refreshes several times a second; only a changed activity list does the heavy work
            sig = s; pageFaces = u.faces; primary = u.primary
            runCatching { App.prefs.edit().putString("island_faces", JSONObject(p.toString()).also { it.remove("spirit"); it.put("at", now) }.toString()).apply() }
            if (wanted() && !LokeyService.running) LokeyService.sync(ctx)
        }
        App.ui.post { recompute(); syncLive(); evalMain() }
        return ok("faces" to u.faces.size)
    }

    /**
     * Settings, kept natively: `vivoRoute` ('subset'|'full'), `vivoStyle` ('overlay'|'system'|'both'), `vivoShowed` (the user's answer), `systemIsland` (the user switch), `liveUpdates`, `vivo`, `vivoScenes`, `alwaysVisible`. The legacy `overlay` flag
     * is only a hint from the page visibility handling: `true` switches the island on, `false` is ignored (the native lifecycle decides when to hide).
     */
    fun setEnabled(p: JSONObject): JSONObject {
        val e = App.prefs.edit()
        if (p.has("systemIsland")) e.putBoolean("island", p.bool("systemIsland")) else if (p.has("overlay") && p.bool("overlay")) e.putBoolean("island", true)
        if (p.has("liveUpdates")) e.putBoolean("lu_enabled", p.bool("liveUpdates"))
        if (p.has("alwaysVisible")) e.putBoolean("island_always", p.bool("alwaysVisible"))
        if (p.has("vivo")) e.putBoolean("vivo_island", p.bool("vivo"))
        e.apply()
        p.optJSONObject("vivoScenes")?.let { VivoIsland.setScenes(it) }
        VivoSuperX.setPrefs(p)   // vivoRoute, vivoStyle, vivoShowed
        liveSig = 0
        if (!LiveUpdates.enabled()) LiveUpdates.clear(ctx)
        LokeyService.sync(ctx)
        nativeChanged()
        return ok("vivo" to VivoIsland.enabled(), "systemIsland" to enabled(), "overlay" to enabled(), "liveUpdates" to LiveUpdates.enabled(), "overlayGranted" to Perms.granted("overlay"))
    }

    private fun cutout(): RectF? {
        if (Build.VERSION.SDK_INT < 29) return null
        val sw = ctx.resources.displayMetrics.widthPixels
        return runCatching {
            @Suppress("DEPRECATION") wm().defaultDisplay.cutout?.boundingRects?.filter { it.top <= 24 * d() && it.width() < sw / 2 && it.height() > 0 }
                ?.minByOrNull { Math.abs(it.centerX() - sw / 2) }?.let { RectF(it) }
        }.getOrNull()
    }

    fun status(): JSONObject {
        val c = cutout()
        return obj("overlayGranted" to Perms.granted("overlay"), "promotedGranted" to (LiveUpdates.canPromote(ctx) ?: false), "promotedSupported" to LiveUpdates.supported(),
            "cutout" to c?.let { obj("left" to it.left.toInt(), "top" to it.top.toInt(), "right" to it.right.toInt(), "bottom" to it.bottom.toInt()) },
            "overlayRunning" to (view?.isAttachedToWindow == true), "sdk" to Build.VERSION.SDK_INT, "reason" to lastReason,
            "overlayEnabled" to enabled(), "systemIsland" to enabled(), "liveUpdates" to LiveUpdates.enabled(), "visible" to shown(), "faces" to ordered.size,
            "promotable" to JSONObject().also { o -> LiveUpdates.promotable.forEach { (k, v) -> o.put(k, v ?: JSONObject.NULL) } },   // Notification.hasPromotableCharacteristics() per face
            "atomicIsland" to atomic.available(), "vivoSuperx" to VivoIsland.status(ctx))
    }

    fun onMedia() { App.ui.post { refreshMusic(true); recompute(); syncLive(); evalMain() } }
    fun refresh() { App.ui.post { restore(); recompute(); evalMain() } }
    fun apply(c: Context) { App.init(c); nativeChanged() }
    fun remove() { App.ui.post { removeView() } }
    fun overlayShown() = view?.isAttachedToWindow == true

    /** an Allow / Deny / Done / Snooze tapped on the island or a notification: native sources are answered natively. True = handled here. */
    fun handleAction(faceId: String, actionId: String): Boolean {
        if (LinkParse.cardId(faceId) != null) { LinkClient.answer(faceId, actionId == "allow"); return true }
        if (faceId.startsWith("rem-")) { Reminders.act(faceId.removePrefix("rem-"), actionId); nativeChanged(); return true }
        return faceId == "wake-listening" || faceId == "idle"
    }

    // ---- activity / window --------------------------------------------------------------------------------------
    private fun ensureStarted() {
        if (started) return
        started = true
        val f = IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF); addAction(Intent.ACTION_USER_PRESENT); addAction(Intent.ACTION_CONFIGURATION_CHANGED) }
        runCatching { ContextCompat.registerReceiver(ctx, object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) { refresh() } }, f, ContextCompat.RECEIVER_NOT_EXPORTED) }
    }

    internal fun evalMain() {
        ensureStarted()
        refreshMusic()
        recompute()
        val portrait = ctx.resources.configuration.orientation == Configuration.ORIENTATION_PORTRAIT
        val f = current()
        val locked = runCatching { ctx.getSystemService(KeyguardManager::class.java).isKeyguardLocked || !ctx.getSystemService(PowerManager::class.java).isInteractive }.getOrDefault(false)
        val dec = IslandPolicy.decide(enabled(), Perms.granted("overlay"), f != null, App.foreground, portrait, locked, ordered.any { it.kind == "approval" })
        lastReason = dec.reason
        if (VivoSuperX.hideOverlay(VivoSuperX.style(), VivoSuperX.showed())) { lastReason = "hidden: island style is System and you said the vivo pill showed"; removeView(); return }
        if (!dec.show || f == null) { removeView(); return }
        val v = ensureView() ?: run { lastReason = "off: Android refused the overlay window"; return }
        v.visibility = View.VISIBLE
        lp?.let { it.flags = it.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv() }
        layout(v, f); applyBounds(v); v.invalidate()
    }

    private fun ensureView(): IslandView? {
        view?.let { return it }
        val v = IslandView(ctx)
        val p = WindowManager.LayoutParams(1, 1, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED, PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START; title = "LokeyIsland"
            if (Build.VERSION.SDK_INT >= 30) { layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS; fitInsetsTypes = 0 }
            else if (Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        if (!runCatching { wm().addView(v, p) }.isSuccess) return null
        lp = p; view = v; expanded = false; holding = false
        App.ui.postDelayed(ticker, 500)
        return v
    }

    private fun removeView() {
        anim?.cancel(); anim = null
        view?.let { v -> runCatching { wm().removeView(v) } }
        view = null; lp = null; expanded = false; holding = false
        App.ui.removeCallbacks(ticker)
    }

    private val ticker = object : Runnable {
        override fun run() {
            if (view == null) return
            refreshMusic(); recompute()
            val os = ordered.map { it.id + it.title + it.subtitle }.hashCode()
            if (os != orderSig) { orderSig = os; syncLive(); evalMain() }
            (view ?: return).invalidate()
            val f = current()
            val fast = f != null && (f.kind == "voice" || f.kind == "job" || (f.kind == "music" && musicPlaying(f)))
            App.ui.postDelayed(this, if (fast) 90 else 1000)
        }
    }

    /** compact capsule around the camera hole (or top-centre under the status bar) and the expanded card, in screen px */
    private fun layout(v: IslandView, f: Face) = layoutFor(v, f, cutout())

    internal fun layoutFor(v: IslandView, f: Face, hole: RectF?) {
        val dm = ctx.resources.displayMetrics; val d = dm.density; val sw = dm.widthPixels.toFloat()

        // a capsule at least 38 dp tall (room for a 28 dp avatar), centred on the camera hole's real centre; the hole only sets the gap between the ears
        val h = maxOf(38 * d, (hole?.height() ?: 0f) + 8 * d).coerceAtMost(56 * d)
        if (hole != null) {
            val hw = hole.width().coerceIn(16 * d, 64 * d)
            val w = hw + 2 * IslandView.EAR_DP * d
            val left = (hole.centerX() - w / 2).coerceIn(0f, sw - w)
            val top = maxOf(0f, hole.centerY() - h / 2)
            v.compact = RectF(left, top, left + w, top + h)
            v.holeW = hw; v.topInset = maxOf(hole.bottom - top, h) + 6 * d
        } else {
            val sb = ctx.resources.getIdentifier("status_bar_height", "dimen", "android").let { if (it > 0) ctx.resources.getDimensionPixelSize(it).toFloat() else 24 * d }
            val w = 56 * d + 2 * IslandView.EAR_DP * d; val top = sb + 4 * d
            v.compact = RectF((sw - w) / 2, top, (sw + w) / 2, top + h)
            v.holeW = 56 * d; v.topInset = h + 6 * d
        }
        val ew = minOf(sw - 24 * d, 360 * d); val el = (sw - ew) / 2
        v.expanded = RectF(el, v.compact.top, el + ew, v.compact.top + v.contentHeight(f, ordered.size > 1))
    }

    /** the overlay window in screen px: the compact capsule, or (expanded / animating) the card with room for the spring overshoot */
    internal fun windowBoxFor(v: IslandView): RectF {
        val d = d(); val sw = ctx.resources.displayMetrics.widthPixels.toFloat()
        return if (expanded || v.t > 0.001f) RectF(maxOf(0f, v.expanded.left - 24 * d), v.expanded.top, minOf(sw, v.expanded.right + 24 * d), v.expanded.bottom + 28 * d) else RectF(v.compact)
    }

    private fun applyBounds(v: IslandView) {
        val p = lp ?: return
        val box = windowBoxFor(v)
        p.x = box.left.toInt(); p.y = box.top.toInt(); p.width = Math.ceil(box.width().toDouble()).toInt(); p.height = Math.ceil(box.height().toDouble()).toInt()
        v.winX = p.x.toFloat(); v.winY = p.y.toFloat()
        runCatching { wm().updateViewLayout(v, p) }
    }

    fun expand(on: Boolean) {
        expanded = on
        App.ui.post {
            val v = view ?: return@post
            val f = current() ?: return@post
            anim?.cancel()
            layout(v, f); applyBounds(v)
            val a = ValueAnimator.ofFloat(v.t, if (on) 1f else 0f).apply {
                duration = if (on) 420 else 260
                interpolator = if (on) OvershootInterpolator(0.9f) else DecelerateInterpolator()   // the spring
                addUpdateListener { v.t = it.animatedValue as Float; v.invalidate() }
                addListener(object : AnimatorListenerAdapter() { override fun onAnimationEnd(an: Animator) { if (!expanded) { v.t = 0f; applyBounds(v); v.invalidate() } else v.t = 1f } })
            }
            anim = a; a.start()
        }
    }

    fun cycle(dir: Int) {
        val next = IslandModel.cycle(ordered, current()?.id, dir) ?: return
        currentId = next; manualAt = System.currentTimeMillis()
        App.ui.post { view?.let { v -> current()?.let { layout(v, it); if (expanded) applyBounds(v); v.invalidate() } } }
    }

    // ---- gestures out to the page --------------------------------------------------------------------------------
    fun tap() { val id = current()?.id; Events.emit("island.tap", obj("faceId" to id, "face" to id), durable = true) }
    fun double() { Events.emit("island.double", obj(), durable = true) }

    fun hold(start: Boolean) {
        Events.emit("island.hold", obj("state" to (if (start) "start" else "end"), "down" to start), durable = true)
        if (start && !App.foreground) bringToFront(true)
    }

    private fun emitAction(face: String, action: String) = Events.emit("island.action", obj("faceId" to face, "face" to face, "actionId" to action, "action" to action), durable = true)

    fun perform(h: Hit, x: Float, y: Float) {
        val native = h.faceId == NATIVE_MUSIC
        when (h.kind) {
            "action" -> if (!handleAction(h.faceId, h.actionId)) emitAction(h.faceId, h.actionId)
            "prev", "next", "toggle" -> if (native) runCatching { Router.call("media.control", obj("action" to h.kind)) } else if (!handleAction(h.faceId, h.kind)) emitAction(h.faceId, h.kind)
            "seek" -> if (native && musicDur > 0) runCatching { Router.call("media.control", obj("action" to "seek", "positionMs" to (view!!.seekFraction(h, x) * musicDur).toLong())) }
        }
    }

    // ---- app in / out of the foreground ---------------------------------------------------------------------------
    /** brings Lokey forward so the page can open the microphone (Android blocks background capture); needs the overlay permission to start from the background */
    fun bringToFront(voice: Boolean): JSONObject {
        if (App.foreground) return ok("already" to true)
        cameFromBackground = true
        if (voice) Launch.pending = obj("action" to "listen")
        return try { Launch.start(if (voice) Launch.ACT_LISTEN else Launch.ACT_ASK); ok("overlayGranted" to Perms.granted("overlay")) } catch (e: Exception) { fail("Android refused to open Lokey from the background (grant overlay access)") }
    }

    fun sendToBack(): JSONObject {
        val a = App.activity ?: return fail("Lokey is not open")
        cameFromBackground = false
        main { a.moveTaskToBack(true) }
        return ok()
    }

    internal fun attach(v: IslandView) { view = v; lp = WindowManager.LayoutParams(); expanded = false }
    internal fun windowParams(): WindowManager.LayoutParams? = lp
    internal fun evalNow() = evalMain()
    internal fun resetForTest() { removeView(); restored = true; liveSig = 0; orderSig = 0; approvals = emptySet(); wakeUntil = 0; pageAt = 0; pageFaces = emptyList(); primary = null; ordered = emptyList(); currentId = null; sig = 0; spirit = null; spiritKey = 0; music = null }

    const val NATIVE_MUSIC = "native-music"
}

/** test hooks (JVM tests only) */
internal fun Island.attachForTest(v: IslandView) = attach(v)
