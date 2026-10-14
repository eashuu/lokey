package app.lokey.link

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject

/**
 * Notifications. Confirm cards and job progress ask to be "promoted ongoing" (Android 16 Live Updates, which vivo's Origin Island may show).
 * That is requested by reflection, so older systems and a changed API cannot break the notification: it is then a normal heads-up one.
 * Whether OriginOS actually puts a third-party app on the island is up to vivo and is unverified.
 */
object Notif {
    const val CH_LINK = "link"        // the quiet foreground-service notification
    const val CH_ASK = LiveUpdates.CH_ASK
    const val CH_INFO = "info"        // finished jobs, nudges
    const val CH_JOB = LiveUpdates.CH_LIVE
    const val CH_REMIND = LiveUpdates.CH_REMIND
    const val ID_FG = 1
    private var auto = 100

    fun channels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_LINK, "Lokey is running", NotificationManager.IMPORTANCE_MIN))
        nm.createNotificationChannel(NotificationChannel(CH_INFO, "Lokey updates", NotificationManager.IMPORTANCE_DEFAULT))
        LiveUpdates.channels(c)
    }

    private fun nm(c: Context) = c.getSystemService(NotificationManager::class.java)
    private fun flags() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    private fun open(c: Context, action: String, code: Int, id: String? = null): PendingIntent =
        PendingIntent.getActivity(c, code, Launch.intent(action).also { i -> id?.let { i.putExtra("id", it) } }, flags())
    private fun act(c: Context, action: String, id: String, code: Int) =
        PendingIntent.getBroadcast(c, code + (id.hashCode() and 0xffff) * 4, Intent(c, ActionReceiver::class.java).setAction(action).putExtra("id", id), flags())

    /** stable int id for a caller's string id */
    fun nid(id: String): Int = if (id.isEmpty()) ++auto else 1000 + (id.hashCode() and 0xffff)

    private fun svc(c: Context, a: String, code: Int) = PendingIntent.getBroadcast(c, code, Intent(c, ActionReceiver::class.java).setAction(a), flags())

    /** the quiet ongoing notification of the foreground service, with Ask / Pause listening / Stop (and Start listening when the mic service could not start) */
    fun foreground(c: Context, text: String): Notification {
        val b = Notification.Builder(c, CH_LINK).setSmallIcon(R.drawable.ic_lokey).setContentTitle("Lokey").setContentText(text)
            .setContentIntent(open(c, Launch.ACT_ASK, 1)).setOngoing(true)
        b.addAction(Notification.Action.Builder(null, "Ask", svc(c, ActionReceiver.SVC_ASK, 31)).build())
        if (Wake.needsStart()) b.addAction(Notification.Action.Builder(null, "Start listening", open(c, Launch.ACT_ASK, 34)).build())
        else if (Wake.isPaused() || Wake.wanted()) b.addAction(Notification.Action.Builder(null, if (Wake.isPaused()) "Resume listening" else "Pause listening", svc(c, ActionReceiver.SVC_PAUSE, 32)).build())
        b.addAction(Notification.Action.Builder(null, "Stop", svc(c, ActionReceiver.SVC_STOP, 33)).build())
        return b.build()
    }

    /** a heard wake-up while the app could not be started directly: a high-priority notification with a full-screen intent (needs that permission on Android 14+) */
    fun wakeFallback(c: Context, kind: String, phrase: String, action: String) {
        val pi = PendingIntent.getActivity(c, 35, Launch.intent(Launch.ACT_WAKE).putExtra("kind", kind).putExtra("phrase", phrase).putExtra("wakeAction", action), flags())
        val b = Notification.Builder(c, CH_ASK).setSmallIcon(R.drawable.ic_lokey).setContentTitle("Lokey heard you").setContentText("Tap to talk").setContentIntent(pi).setAutoCancel(true)
            .setCategory(Notification.CATEGORY_CALL)
        if (Perms.granted("full-screen-intent")) b.setFullScreenIntent(pi, true)
        nm(c).notify(nid("wake"), b.build())
    }

    fun refreshForeground(c: Context, text: String) { runCatching { nm(c).notify(ID_FG, foreground(c, text)) } }

    fun info(c: Context, title: String, text: String, id: String = "") {
        val b = Notification.Builder(c, CH_INFO).setSmallIcon(R.drawable.ic_lokey).setContentTitle(title).setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text)).setContentIntent(open(c, Launch.ACT_ASK, 4)).setAutoCancel(true)
        nm(c).notify(nid(id), b.build())
    }

    fun reminder(c: Context, title: String, text: String) {
        val b = Notification.Builder(c, CH_REMIND).setSmallIcon(R.drawable.ic_lokey).setContentTitle(title).setContentText(text)
            .setCategory(Notification.CATEGORY_REMINDER).setContentIntent(open(c, Launch.ACT_ASK, 5)).setAutoCancel(true)
        nm(c).notify(nid(""), b.build())
    }

    /** {id, title, detail, allowLabel?, denyLabel?}: a heads-up card; the buttons come back as the 'confirm.action' event {id, allow} */
    fun confirm(c: Context, p: JSONObject) {
        val id = p.need("id"); val detail = p.str("detail")
        val b = Notification.Builder(c, CH_ASK).setSmallIcon(R.drawable.ic_lokey).setContentTitle(p.str("title", "Lokey asks")).setContentText(detail.lineSequence().firstOrNull() ?: "")
            .setStyle(Notification.BigTextStyle().bigText(detail)).setCategory(Notification.CATEGORY_REMINDER)
            .setContentIntent(open(c, Launch.ACT_CONFIRM, 2, id)).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, p.str("denyLabel", "Deny"), act(c, ActionReceiver.DENY, id, 2)).build())
            .addAction(Notification.Action.Builder(null, p.str("allowLabel", "Allow"), act(c, ActionReceiver.ALLOW, id, 3)).build())
        if (p.bool("fullScreen") && Perms.granted("full-screen-intent")) b.setFullScreenIntent(open(c, Launch.ACT_CONFIRM, 6, id), true)
        promote(b, "Allow?")
        nm(c).notify(nid(id), b.build())
        Store.setPending(obj("id" to id, "title" to p.str("title", "Lokey asks"), "detail" to detail))
        LokeyWidget.refresh(c)
    }

    /** {id, title, text, pct (0..100, -1 = unknown), done?} */
    fun progress(c: Context, p: JSONObject) {
        val id = p.need("id"); val pct = p.int("pct", -1); val done = p.bool("done")
        if (done && p.str("text").isEmpty()) { cancel(c, id); return }
        val b = Notification.Builder(c, if (done) CH_INFO else CH_JOB).setSmallIcon(R.drawable.ic_lokey).setContentTitle(p.str("title", "Lokey")).setContentText(p.str("text"))
            .setContentIntent(open(c, Launch.ACT_ASK, 7)).setOnlyAlertOnce(true).setOngoing(!done).setAutoCancel(done)
        if (!done) { b.setProgress(100, pct.coerceIn(0, 100), pct < 0); promote(b, if (pct >= 0) "$pct%" else "...") }
        nm(c).notify(nid(id), b.build())
    }

    fun cancel(c: Context, id: String) {
        nm(c).cancel(nid(id))
        if (Store.pending()?.optString("id") == id) { Store.setPending(null); LokeyWidget.refresh(c) }
    }

    /** Android 16 Live Update flags (by reflection) */
    private fun promote(b: Notification.Builder, short: String) {
        if (Build.VERSION.SDK_INT < 36 || !LiveUpdates.enabled()) return
        runCatching { Notification.Builder::class.java.getMethod("setRequestPromotedOngoing", Boolean::class.javaPrimitiveType).invoke(b, true) }
        runCatching { Notification.Builder::class.java.getMethod("setShortCriticalText", String::class.java).invoke(b, short) }
    }
}

/** small persistent state the widget and tiles read: a pending confirm card and the widget text the page pushed */
object Store {
    fun pending(): JSONObject? = App.prefs.getString("pending", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    fun setPending(j: JSONObject?) { App.prefs.edit().apply { if (j == null) remove("pending") else putString("pending", j.toString()) }.apply() }
    fun widget(): JSONObject = runCatching { JSONObject(App.prefs.getString("widget", "{}")) }.getOrDefault(JSONObject())
    fun setWidget(j: JSONObject) { App.prefs.edit().putString("widget", j.toString()).apply() }
}
