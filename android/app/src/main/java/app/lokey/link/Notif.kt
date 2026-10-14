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
 * Notifications. On Android 16 (OriginOS 6) the approval card asks to be a "promoted ongoing" Live Update, which is what vivo's
 * Origin Island shows at the top of the screen. Whether the island accepts a third-party app is up to vivo, so this is asked for by
 * reflection and everything still works as a normal heads-up notification without it.
 */
object Notif {
    const val CH_LINK = "link"        // the quiet "connected" notification the foreground service needs
    const val CH_ASK = "approvals"    // heads-up, sound
    const val CH_INFO = "info"        // finished jobs, nudges
    const val ID_LINK = 1
    const val ID_ASK = 2
    private var infoId = 100

    fun channels(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_LINK, "Connection to your PC", NotificationManager.IMPORTANCE_MIN))
        nm.createNotificationChannel(NotificationChannel(CH_ASK, "Approval requests", NotificationManager.IMPORTANCE_HIGH).apply { description = "When Lokey on your PC needs your OK" })
        nm.createNotificationChannel(NotificationChannel(CH_INFO, "Lokey updates", NotificationManager.IMPORTANCE_DEFAULT))
    }

    private fun pi(c: Context, i: Intent, code: Int) = PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    private fun act(c: Context, action: String, id: String, code: Int) =
        PendingIntent.getBroadcast(c, code, Intent(c, ActionReceiver::class.java).setAction(action).putExtra("id", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun foreground(c: Context): Notification =
        Notification.Builder(c, CH_LINK).setSmallIcon(R.drawable.ic_lokey).setContentTitle("Lokey").setContentText("Connected to your PC")
            .setContentIntent(pi(c, Intent(c, MainActivity::class.java), 0)).setOngoing(true).build()

    /** a confirm card from the PC: heads-up with Allow / Deny buttons, and a popup dialog when tapped */
    fun ask(c: Context, card: JSONObject) {
        val id = card.optString("id")
        val open = pi(c, Intent(c, ApprovalActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), 1)
        val b = Notification.Builder(c, CH_ASK).setSmallIcon(R.drawable.ic_lokey)
            .setContentTitle(card.optString("title", "Lokey asks")).setContentText(card.optString("detail").lineSequence().firstOrNull() ?: "")
            .setStyle(Notification.BigTextStyle().bigText(card.optString("detail")))
            .setCategory(Notification.CATEGORY_REMINDER)
            .setContentIntent(open).setFullScreenIntent(open, true).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, "Deny", act(c, ActionReceiver.DENY, id, 2)).build())
            .addAction(Notification.Action.Builder(null, "Allow", act(c, ActionReceiver.ALLOW, id, 3)).build())
        if (Build.VERSION.SDK_INT >= 36) promote(b, "Allow?")
        c.getSystemService(NotificationManager::class.java).notify(ID_ASK, b.build())
    }

    fun clearAsk(c: Context) = c.getSystemService(NotificationManager::class.java).cancel(ID_ASK)

    fun info(c: Context, title: String, text: String) {
        val b = Notification.Builder(c, CH_INFO).setSmallIcon(R.drawable.ic_lokey).setContentTitle(title).setContentText(text)
            .setContentIntent(pi(c, Intent(c, MainActivity::class.java), 4)).setAutoCancel(true)
        c.getSystemService(NotificationManager::class.java).notify(infoId++, b.build())
    }

    /** Android 16 Live Update flags, by reflection so older SDKs and a changed API cannot break the build or the notification */
    private fun promote(b: Notification.Builder, short: String) {
        runCatching { Notification.Builder::class.java.getMethod("setRequestPromotedOngoing", Boolean::class.javaPrimitiveType).invoke(b, true) }
        runCatching { Notification.Builder::class.java.getMethod("setShortCriticalText", String::class.java).invoke(b, short) }
    }
}
