package app.lokey.link

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.os.Bundle
import android.os.Parcelable
import android.util.Log
import org.json.JSONObject

/**
 * EXPERIMENT, route "vivo-full": the whole `notification.superx.*` / `island.superx.*` schema that vivo's own apps appear to send (key names and
 * semantics recorded by the open-source OriginOS Toolkit, MIT, and the CunnyPlayground originos-experimental branch it ports; see docs/VIVO-ISLAND.md
 * and THIRD-PARTY-NOTICES.md). Written here from those facts in our own structure; nothing is copied. vivo's renderer is closed and ignores keys it
 * does not know, so NOTHING about on-device behaviour is verified: only the wire format is, by VivoSuperXTest. No package names are spoofed.
 *
 * Differences from the documented-subset route (VivoIsland): full schema (capsule / infos / shortInfos / island bundles), scene TRAIN, a dedicated
 * LOW silent ongoing channel, one fixed notification id (one pill), one Icon instance shared by every bundle, scene registration through the hidden
 * NotificationManager.setSuperXInfosSceneList (reflection, failures swallowed), and a graceful end (operation 2, then cancel).
 */
object VivoSuperX {
    private const val TAG = "LokeyVivoFull"
    const val CHANNEL = "vivo_full_v1"
    const val ID = 2900
    const val SCENE = "TRAIN"
    const val OP_SHOW = 0
    const val OP_END = 2
    const val P = "notification.superx."
    const val I = "island.superx."
    const val PROBE_ID = "vivo-probe"
    val ROUTES = listOf("subset", "full")
    val STYLES = listOf("overlay", "system", "both")

    /** what the right side of the pill renders; ids are the schema's */
    enum class Right(val id: Int) { RHYTHM(1), PROGRESS(2), LOADING(3), TEXT_ICON(4), ICON_TEXT(5), CAPSULE(6) }

    /** everything one pill needs, derived from a Face (pure, JVM-tested) */
    data class Plan(
        val template: Int, val right: Right, val title: String, val content: String, val leftText: String, val rightText: String,
        val percent: Int?, val accent: Int,
    )

    /** voice faces carry their state in the title (IslandFaces: Listening / Thinking / Speaking) */
    fun right(f: Face): Right = when (f.kind) {
        "voice" -> if (f.title.startsWith("Think", true)) Right.LOADING else if (f.title.startsWith("Speak", true)) Right.TEXT_ICON else Right.RHYTHM
        "timer", "job" -> Right.PROGRESS
        "approval" -> Right.CAPSULE
        "pc", "charging" -> Right.ICON_TEXT
        else -> Right.TEXT_ICON   // reminder and anything else
    }

    private fun accent(kind: String): Int = when (kind) {
        "voice" -> 0xFF80CBC4; "timer" -> 0xFFFFB74D; "job" -> 0xFF64B5F6; "approval" -> 0xFFEF5350; "pc" -> 0xFF9575CD; else -> 0xFF80CBC4
    }.toInt()

    fun plan(f: Face, now: Long): Plan {
        val r = right(f)
        val title = f.title.ifEmpty { "Lokey" }
        // the self-animating voice templates never carry the transcript: their text must not change while the state stays the same (update budget)
        val content = if (f.kind == "voice" && r != Right.TEXT_ICON) title else f.subtitle.ifEmpty { title }
        val pct = if (r == Right.PROGRESS) ((IslandModel.progressOf(f, now) ?: 0.0) * 100).toInt().coerceIn(0, 100) else null
        val rightText = when (r) {
            Right.CAPSULE -> "Approve?"
            Right.TEXT_ICON -> (if (f.kind == "reminder") title else content).take(24)
            Right.ICON_TEXT -> content.take(24)
            else -> content.take(24)
        }
        return Plan(if (r == Right.PROGRESS && pct != null && pct in 1..99) 2 else 1, r, title, content, title.take(12), rightText, pct, accent(f.kind))
    }

    /** the write surface; a Bundle on the device, a recording map in the JVM tests. Icons/PendingIntents are opaque (Any). */
    interface Sink {
        fun child(): Sink
        fun putInt(k: String, v: Int)
        fun putBoolean(k: String, v: Boolean)
        fun putString(k: String, v: String)
        fun putIntList(k: String, v: List<Int>)
        fun putParcel(k: String, v: Any?)
        fun putParcelList(k: String, v: List<Any>)
        fun putBundle(k: String, v: Sink)
    }

    class BundleSink(val bundle: Bundle = Bundle()) : Sink {
        override fun child(): Sink = BundleSink()
        override fun putInt(k: String, v: Int) = bundle.putInt(k, v)
        override fun putBoolean(k: String, v: Boolean) = bundle.putBoolean(k, v)
        override fun putString(k: String, v: String) = bundle.putString(k, v)
        override fun putIntList(k: String, v: List<Int>) = bundle.putIntegerArrayList(k, ArrayList(v))
        override fun putParcel(k: String, v: Any?) { if (v is Parcelable) bundle.putParcelable(k, v) }
        override fun putParcelList(k: String, v: List<Any>) = bundle.putParcelableArrayList(k, ArrayList(v.filterIsInstance<Parcelable>()))
        override fun putBundle(k: String, v: Sink) { (v as? BundleSink)?.let { bundle.putBundle(k, it.bundle) } }
    }

    /** the full payload. `icon` is ONE shared instance for every bundle. */
    fun write(p: Plan, icon: Any?, click: Any?, out: Sink) {
        out.putInt(P + "operation", OP_SHOW)
        out.putBoolean(P + "showNotify", true)
        out.putInt(P + "template", p.template)
        out.putString(P + "scene", SCENE)
        out.putInt(P + "changedRecord", 0)
        click?.let { out.putParcel(P + "clickResp", it) }

        out.putBundle(P + "baseInfos", out.child().also {
            it.putString(P + "baseInfos.title", p.title); it.putString(P + "baseInfos.content", p.content); it.putParcel(P + "baseInfos.icon", icon) })
        // the collapsed pill; the notes we port from say the template resolver needs it
        out.putBundle(P + "capsule", out.child().also {
            it.putInt(P + "capsule.state", 1); it.putString(P + "capsule.content", p.title); it.putParcel(P + "capsule.icon", icon) })

        out.putBundle(P + "infos", out.child().also {
            if (p.template == 2) {
                it.putInt(P + "infos.progress", p.percent ?: 0); it.putInt(P + "infos.progressColor", p.accent)
                if (icon != null) { it.putParcelList(P + "infos.nodeIcon", listOf(icon, icon)); it.putParcel(P + "infos.indicatorIcon", icon); it.putInt(P + "infos.indicatorLoc", 1) }
            } else {
                it.putString(P + "infos.describe", p.title); it.putString(P + "infos.coreInfo", p.content); it.putParcel(P + "infos.image", icon)
            }
        })
        out.putBundle(P + "shortInfos", out.child().also {
            it.putString(P + "shortInfos.describeShort", p.title); it.putString(P + "shortInfos.coreInfoShort", p.content); it.putParcel(P + "shortInfos.image", icon) })

        out.putBundle(P + "island", out.child().also { isl ->
            isl.putInt(I + "leftTemplate", 1)
            isl.putInt(I + "rightTemplate", p.right.id)
            isl.putBundle(I + "leftInfo", isl.child().also { it.putString(I + "leftInfo.content", p.leftText); it.putParcel(I + "leftInfo.icon", icon) })
            isl.putBundle(I + "rightInfo", isl.child().also { r ->
                when (p.right) {
                    Right.RHYTHM -> { r.putInt(I + "rightInfo.waveState", 1); r.putIntList(I + "rightInfo.waveColor", listOf(p.accent)) }
                    Right.PROGRESS -> { r.putInt(I + "rightInfo.progressValue", p.percent ?: 0); r.putInt(I + "rightInfo.progressState", 0); r.putInt(I + "rightInfo.progressColor", p.accent) }
                    Right.LOADING -> r.putInt(I + "rightInfo.loadingColor", p.accent)
                    Right.TEXT_ICON, Right.ICON_TEXT -> { r.putString(I + "rightInfo.content", p.rightText); r.putParcel(I + "rightInfo.icon", icon) }
                    Right.CAPSULE -> { r.putString(I + "rightInfo.capsuleContent", p.rightText); r.putInt(I + "rightInfo.capsuleBgColor", p.accent) }
                }
            })
        })
    }

    /** the graceful unmount: only the end operation */
    fun writeEnd(out: Sink) { out.putInt(P + "operation", OP_END) }

    /** what actually goes on the wire; two plans with the same signature need no second post */
    fun sig(p: Plan) = listOf(p.template, p.right.id, p.title, p.content, p.leftText, p.rightText, p.percent).joinToString("|")

    /** route default: the stored choice, else full on vivo / iQOO and subset elsewhere */
    fun routeOf(stored: String?, vivo: Boolean) = if (stored in ROUTES) stored!! else if (vivo) "full" else "subset"

    /** the first-run "Island check" is due on a vivo device that has neither finished the check nor answered "did it show" before */
    fun needsCheck(vivo: Boolean, checkDone: String, showed: String) = vivo && checkDone != "done" && showed.isEmpty()

    /** vivo allows 1 update per 10 s per activity: decide() says -1 nothing to send, 0 send now, >0 wait that long (latest state wins) */
    class Coalescer(private val gap: Long = 10_000L) {
        private var last: String? = null
        private var at = 0L
        fun decide(sig: String, now: Long): Long = when {
            last == null -> 0
            sig == last -> -1
            else -> maxOf(0L, at + gap - now)
        }
        fun sent(sig: String, now: Long) { last = sig; at = now }
        fun reset() { last = null; at = 0 }
    }

    /** whether our own overlay pill is hidden: only when the user chose System AND said the system pill showed. Never assumed. */
    fun hideOverlay(style: String, showed: String) = style == "system" && showed == "yes"

    // ---- device side ---------------------------------------------------------------------------------------------
    fun route() = routeOf(App.prefs.getString("vivo_route", null), VivoIsland.isVivoDevice())
    fun needsCheck() = needsCheck(VivoIsland.isVivoDevice(), App.prefs.getString("island_check", "") ?: "", showed())
    fun routeFull() = route() == "full"
    fun style() = App.prefs.getString("island_style", "overlay").let { if (it in STYLES) it!! else "overlay" }
    /** "yes" / "no" / "" (not asked): the user's own answer to "did the system pill show?" */
    fun showed() = App.prefs.getString("vivo_showed", "") ?: ""

    fun setPrefs(p: JSONObject) {
        val e = App.prefs.edit()
        p.str("vivoRoute").takeIf { it in ROUTES }?.let { e.putString("vivo_route", it) }
        p.str("vivoStyle").takeIf { it in STYLES }?.let { e.putString("island_style", it) }
        if (p.has("vivoCheck")) e.putString("island_check", if (p.bool("vivoCheck")) "done" else "")
        if (p.has("vivoShowed")) e.putString("vivo_showed", if (p.isNull("vivoShowed")) "" else if (p.bool("vivoShowed")) "yes" else "no")
        e.apply()
    }

    @Volatile var lastProbe: JSONObject? = null
    private var posted = false
    private var latest: Face? = null
    private var deferred: Runnable? = null
    private var sceneDone = false
    private var staleCleared = false
    private val co = Coalescer()

    private fun nm(c: Context) = c.getSystemService(NotificationManager::class.java)

    private fun channel(c: Context) {
        nm(c).createNotificationChannel(NotificationChannel(CHANNEL, "Lokey system island", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Used only by the vivo full-schema island experiment"; setSound(null, null); enableVibration(false) })
    }

    /** vivo's own apps register their scene through this hidden call; reflection, any failure is ignored */
    private fun registerScene(c: Context) {
        if (sceneDone) return
        runCatching {
            NotificationManager::class.java.getMethod("setSuperXInfosSceneList", List::class.java, List::class.java, List::class.java, List::class.java)
                .invoke(nm(c), arrayListOf(SCENE), arrayListOf("true"), arrayListOf(c.packageName), arrayListOf("true"))
            sceneDone = true
        }.onFailure { Log.i(TAG, "scene registration unavailable: ${it.javaClass.simpleName}") }
    }

    private fun iconFor(c: Context, f: Face): Icon =
        Island.iconFor(f)?.let { b -> runCatching { Icon.createWithBitmap(if (b.width > 128) Bitmap.createScaledBitmap(b, 128, (128f * b.height / b.width).toInt().coerceAtLeast(1), true) else b) }.getOrNull() }
            ?: Icon.createWithResource(c, R.drawable.ic_lokey)

    fun build(c: Context, f: Face, now: Long = System.currentTimeMillis()): Notification {
        val p = plan(f, now)
        val click = PendingIntent.getActivity(c, ID, Launch.intent(if (f.kind == "approval") Launch.ACT_CONFIRM else Launch.ACT_ASK).putExtra("id", f.id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val sink = BundleSink()
        write(p, iconFor(c, f), click, sink)
        return Notification.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_lokey).setContentTitle(p.title).setContentText(p.content).setOngoing(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC).setContentIntent(click).addExtras(sink.bundle).build()
    }

    private fun post(c: Context, f: Face, sig: String) {
        channel(c); registerScene(c)
        nm(c).notify(ID, build(c, f))
        posted = true; co.sent(sig, System.currentTimeMillis())
        App.ui.removeCallbacks(tick); App.ui.postDelayed(tick, 10_000)   // timers / progress change without any face change: look again
    }

    private lateinit var appCtx: Context
    private val tick = Runnable { synchronized(this) { if (posted) flush(appCtx) } }

    /** sends the latest face if it differs from what is up, no sooner than vivo's 10 s per update */
    @Synchronized private fun flush(c: Context) {
        val f = latest ?: return
        deferred?.let { App.ui.removeCallbacks(it) }; deferred = null
        val now = System.currentTimeMillis()
        val s = sig(plan(f, now))
        val w = co.decide(s, now)
        when {
            w < 0 -> if (posted) { App.ui.removeCallbacks(tick); App.ui.postDelayed(tick, 10_000) }
            w == 0L -> runCatching { post(c, f, s) }
            else -> Runnable { synchronized(this) { deferred = null; flush(c) } }.also { deferred = it; App.ui.postDelayed(it, w) }
        }
    }

    /**
     * One pill: the first non-idle face (voice, timer, job, approval, pc, reminder, music, charging). The first post is immediate, later ones are
     * posted only when the wire content changed and at most once per 10 s (the latest state wins, a trailing update is scheduled). Voice states use the
     * self-animating RHYTHM / LOADING templates, so only state transitions cost an update.
     */
    @Synchronized fun publish(c: Context, faces: List<Face>) {
        appCtx = c.applicationContext
        if (!staleCleared) { staleCleared = true; runCatching { nm(c).cancel(ID) } }   // a pill left behind by a dead process
        val f = faces.firstOrNull { it.kind != "idle" }
        if (!routeFull() || !VivoIsland.enabled() || !Perms.granted("notifications") || f == null) { end(c); return }
        VivoIsland.attempted = true
        latest = f
        flush(c)
    }

    /** graceful end: one last write with operation 2, then cancel (at once when the process is going away) */
    @Synchronized fun end(c: Context, immediate: Boolean = false) {
        deferred?.let { App.ui.removeCallbacks(it) }; deferred = null; latest = null
        if (!posted) return
        posted = false; co.reset(); App.ui.removeCallbacks(tick)
        runCatching {
            val s = BundleSink(); writeEnd(s)
            nm(c).notify(ID, Notification.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_lokey).setContentTitle("Lokey").setOngoing(true).addExtras(s.bundle).build())
        }
        if (immediate) runCatching { nm(c).cancel(ID) } else App.ui.postDelayed({ if (!posted) nm(c).cancel(ID) }, 1500)
    }

    /** probe: posts the full payload now (regardless of route / throttle), reads back what the system kept, ends itself after 30 s */
    fun probe(c: Context, f: Face): JSONObject {
        runCatching { post(c, f, sig(plan(f, System.currentTimeMillis()))) }.onFailure { return fail("could not post: ${it.javaClass.simpleName}") }
        App.ui.postDelayed({ end(c) }, 30_000)
        val n = nm(c)
        val back = n.activeNotifications.firstOrNull { it.id == ID }?.notification?.extras
        val keys = back?.keySet()?.filter { it.startsWith(P) }.orEmpty()
        val nested = JSONObject().also { o -> keys.forEach { k -> back?.getBundle(k)?.let { b -> o.put(k, org.json.JSONArray(b.keySet().toList())) } } }
        val pl = plan(f, System.currentTimeMillis())
        return ok("route" to "full", "posted" to (back != null), "extrasReadBack" to keys, "nestedReadBack" to nested, "extrasKept" to keys.isNotEmpty(),
            "scene" to SCENE, "template" to pl.template, "rightTemplate" to pl.right.name, "channelImportance" to n.getNotificationChannel(CHANNEL)?.importance, "sceneRegistered" to sceneDone)
            .also { lastProbe = it }
    }
}
