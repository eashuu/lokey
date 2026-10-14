package app.lokey.link

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews

/** Home-screen widget: PC state at a glance, Allow / Deny when the PC is waiting for you, Ask opens the quick-ask popup. */
class LokeyWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) { for (id in ids) m.updateAppWidget(id, build(c)) }

    companion object {
        fun refresh(c: Context) {
            val m = AppWidgetManager.getInstance(c)
            val ids = m.getAppWidgetIds(ComponentName(c, LokeyWidget::class.java))
            for (id in ids) m.updateAppWidget(id, build(c))
        }

        private fun build(c: Context): RemoteViews {
            val v = RemoteViews(c.packageName, R.layout.widget)
            val pending = Store.pending(c)
            val st = Store.status(c)
            val line: String; val sub: String
            when {
                !Store.paired(c) -> { line = "Not paired"; sub = "Open Lokey to pair with your PC" }
                pending != null -> { line = pending.optString("title", "Lokey is asking"); sub = pending.optString("detail").lineSequence().firstOrNull() ?: "" }
                !Store.connected(c) -> { line = "PC not reachable"; sub = "Same Wi-Fi as your PC?" }
                else -> {
                    val agent = st?.optString("agent") ?: "idle"
                    line = if (agent == "idle") "Your PC is ready" else "Lokey: $agent"
                    val np = st?.optJSONObject("nowPlaying")
                    val bat = st?.optJSONObject("battery")?.let { if (it.optBoolean("present", true)) "${it.optInt("pct")}%" else null }
                    sub = listOfNotNull(np?.optString("title")?.takeIf { it.isNotEmpty() }?.let { "♪ $it" }, bat?.let { "PC battery $it" }).joinToString(" · ")
                }
            }
            v.setTextViewText(R.id.line, line)
            v.setTextViewText(R.id.sub, sub)
            val vis = if (pending != null) View.VISIBLE else View.GONE
            v.setViewVisibility(R.id.allow, vis); v.setViewVisibility(R.id.deny, vis)
            val mutable = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            v.setOnClickPendingIntent(R.id.allow, PendingIntent.getBroadcast(c, 10, Intent(c, ActionReceiver::class.java).setAction(ActionReceiver.ALLOW), mutable))
            v.setOnClickPendingIntent(R.id.deny, PendingIntent.getBroadcast(c, 11, Intent(c, ActionReceiver::class.java).setAction(ActionReceiver.DENY), mutable))
            v.setOnClickPendingIntent(R.id.ask, PendingIntent.getActivity(c, 12, Intent(c, SayActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), mutable))
            v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(c, 13, Intent(c, MainActivity::class.java), mutable))
            return v
        }
    }
}
