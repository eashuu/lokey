package app.lokey.link

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.Toast

/** Allow / Deny pressed in the notification or on the widget */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val allow = i.action == ALLOW
        val id = i.getStringExtra("id") ?: Store.pending(c)?.optString("id") ?: return
        val pending = goAsync()
        Thread {
            val ok = Api.approve(c, id, allow)
            if (ok) { Store.setPending(c, null); Notif.clearAsk(c); LokeyWidget.refresh(c) }
            Handler(Looper.getMainLooper()).post { Toast.makeText(c, if (!ok) "Lokey: could not reach the PC" else if (allow) "Allowed on your PC" else "Denied", Toast.LENGTH_SHORT).show() }
            pending.finish()
        }.start()
    }
    companion object { const val ALLOW = "app.lokey.link.ALLOW"; const val DENY = "app.lokey.link.DENY" }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { runCatching { LinkService.start(c) } } // may be refused by the OS at boot; opening the app starts it
}
