package app.lokey.link

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Android 16 Live Updates (promoted ongoing notifications) for the island activities: one notification per face, updated in place
 * under the same id and cancelled when the face is gone. Promotion needs POST_PROMOTED_NOTIFICATIONS, a channel above MIN, an ongoing
 * notification with a title and a standard style (no custom views, not colorized), and the per-app "Live updates" switch in Settings.
 * The 36-only calls go through reflection (compileSdk is 35), guarded by SDK_INT; on older systems the same builders give plain
 * heads-up / ongoing notifications. Whether vivo's Origin Island shows a third-party Live Update is up to OriginOS: unverified.
 */
object LiveUpdates {
    const val CH_LIVE = "live_v2"        // DEFAULT, silent
    const val CH_ASK = "asks_v2"         // HIGH
    const val CH_REMIND = "remind_v2"    // HIGH
    const val ACT_FACE = "app.lokey.link.FACE_ACTION"

    private val posted = HashSet<String>()
    /** debug: faceId -> Notification.hasPromotableCharacteristics() of the last post (null when the API is missing) */
    val promotable = HashMap<String, Boolean?>()

    fun enabled() = App.prefs.getBoolean("lu_enabled", true)

    fun channels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_LIVE, "Lokey activity", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "What Lokey is doing right now (listening, timers, jobs)"; setSound(null, null); enableVibration(false) })
        nm.createNotificationChannel(NotificationChannel(CH_ASK, "Lokey asks", NotificationManager.IMPORTANCE_HIGH).apply { description = "When Lokey needs your OK" })
        nm.createNotificationChannel(NotificationChannel(CH_REMIND, "Reminders", NotificationManager.IMPORTANCE_HIGH))
        listOf("approvals", "jobs", "reminders").forEach { nm.deleteNotificationChannel(it) }   // the first build's channels (importance cannot be raised once made)
    }

    fun supported() = Build.VERSION.SDK_INT >= 36

    /** the user's per-app "Live updates" switch (null when this Android has no such switch) */
    fun canPromote(c: Context): Boolean? = if (!supported()) null else runCatching {
        c.getSystemService(NotificationManager::class.java).let { it.javaClass.getMethod("canPostPromotedNotifications").invoke(it) as Boolean }
    }.getOrNull()

    private fun flags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    private fun open(c: Context, action: String, id: String) = PendingIntent.getActivity(c, id.hashCode(), Launch.intent(action).putExtra("id", id), flags())
    private fun act(c: Context, f: Face, a: FaceAction): PendingIntent =
        PendingIntent.getBroadcast(c, (f.id + "/" + a.id).hashCode(), Intent(c, ActionReceiver::class.java).setAction(ACT_FACE).putExtra("faceId", f.id).putExtra("actionId", a.id)
            .putExtra("close", f.kind == "approval" || f.kind == "reminder"), flags())

    fun id(faceId: String) = 2000 + (faceId.hashCode() and 0xffff)

    /** the notification for a face (also used by the debug status) */
    fun build(c: Context, f: Face, now: Long = System.currentTimeMillis(), op: Int = 0): Notification {
        val click = open(c, if (f.kind == "approval") Launch.ACT_CONFIRM else if (f.kind == "voice") Launch.ACT_LISTEN else Launch.ACT_ASK, f.id)
        val ch = when (f.kind) { "approval" -> CH_ASK; "reminder" -> CH_REMIND; else -> CH_LIVE }
        val b = Notification.Builder(c, ch).setSmallIcon(R.drawable.ic_lokey).setOngoing(true).setOnlyAlertOnce(true).setContentTitle(f.title.ifEmpty { "Lokey" })
            .setContentIntent(click)
        if (f.subtitle.isNotEmpty()) b.setContentText(f.subtitle)
        when (f.kind) {
            "approval", "pc", "reminder" -> b.setStyle(Notification.BigTextStyle().bigText(f.subtitle.ifEmpty { f.title }))
            "timer" -> if (f.endAt != null) { b.setShowWhen(true).setWhen(f.endAt).setUsesChronometer(true); runCatching { b.setChronometerCountDown(true) } }
        }
        val p = IslandModel.progressOf(f, now)
        if (f.kind == "job" || (f.kind == "timer" && p != null)) b.setProgress(100, ((p ?: 0.0) * 100).toInt(), p == null)
        if (f.kind == "reminder") b.setCategory(Notification.CATEGORY_REMINDER)
        IslandModel.actionsOf(f).take(3).forEach { b.addAction(Notification.Action.Builder(null, it.label, act(c, f, it)).build()) }
        promote(b, IslandModel.chip(f))
        VivoIsland.decorate(b, c, f, op, click)
        return b.build()
    }

    private fun promote(b: Notification.Builder, chip: String?) {
        if (!supported()) return
        runCatching { Notification.Builder::class.java.getMethod("setRequestPromotedOngoing", Boolean::class.javaPrimitiveType).invoke(b, true) }
        if (chip != null) runCatching { Notification.Builder::class.java.getMethod("setShortCriticalText", String::class.java).invoke(b, chip.take(7)) }
    }

    private val last = HashMap<String, Face>()
    private val lastPostAt = HashMap<String, Long>()
    private val deferred = HashMap<String, Runnable>()

    private fun post(c: Context, f: Face, op: Int) {
        val n = build(c, f, op = op)
        promotable[f.id] = if (supported()) runCatching { n.javaClass.getMethod("hasPromotableCharacteristics").invoke(n) as Boolean }.getOrNull() else null
        c.getSystemService(NotificationManager::class.java).notify(id(f.id), n)
        posted += f.id; last[f.id] = f; lastPostAt[f.id] = System.currentTimeMillis()
    }

    /** ends a face's notification: with vivo extras that is operation 2 (end) under the same id, then removal */
    fun endNow(c: Context, f: Face) {
        val nm = c.getSystemService(NotificationManager::class.java)
        deferred.remove(f.id)?.let { App.ui.removeCallbacks(it) }
        if (VivoIsland.enabled() && VivoIsland.attempted) {
            runCatching { nm.notify(id(f.id), build(c, f, op = 2)) }
            App.ui.postDelayed({ nm.cancel(id(f.id)) }, 1500)
        } else nm.cancel(id(f.id))
        posted.remove(f.id); promotable.remove(f.id); last.remove(f.id); lastPostAt.remove(f.id)
    }

    /**
     * posts / updates / cancels so the notifications match `faces`. First post = vivo operation 0 (create), later = 1 (update); with the vivo
     * extras on, updates are coalesced to one per 10 s per face (vivo's documented limit, extra updates are dropped by the system): the latest wins.
     */
    @Synchronized fun sync(c: Context, faces: List<Face>) {
        val want = if (enabled() && Perms.granted("notifications")) faces.filter { it.kind in IslandModel.LIVE_KINDS } else emptyList()
        (posted - want.map { it.id }.toSet()).forEach { fid -> val f = last[fid]; if (f != null) endNow(c, f) else { c.getSystemService(NotificationManager::class.java).cancel(id(fid)); posted.remove(fid) } }
        val throttle = VivoIsland.enabled()
        for (f in want) runCatching {
            val first = f.id !in posted
            val wait = if (throttle && !first) VivoMap.waitMs(lastPostAt[f.id] ?: 0, System.currentTimeMillis()) else 0
            if (wait > 0) {
                last[f.id] = f
                if (deferred[f.id] == null) {
                    val r = Runnable { synchronized(this) { deferred.remove(f.id); last[f.id]?.let { x -> if (f.id in posted) runCatching { post(c, x, 1) } } } }
                    deferred[f.id] = r; App.ui.postDelayed(r, wait)
                }
            } else post(c, f, if (first) 0 else 1)
        }
    }

    fun clear(c: Context) = sync(c, emptyList())
}
