package app.lokey.link

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews

/**
 * Home-screen widget. Lines: the text the page pushed with widget.update {line, sub}; else the song playing; else a hint.
 * Buttons: Ask (opens Lokey to type), Listen (opens Lokey listening), and Allow / Deny while a confirm card is waiting.
 */
class LokeyWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) { App.init(c); for (id in ids) m.updateAppWidget(id, build(c)) }

    companion object {
        fun refresh(c: Context) {
            App.init(c)
            val m = AppWidgetManager.getInstance(c)
            val ids = m.getAppWidgetIds(ComponentName(c, LokeyWidget::class.java))
            if (ids.isEmpty()) return
            val v = build(c)
            for (id in ids) m.updateAppWidget(id, v)
        }

        private fun build(c: Context): RemoteViews {
            val v = RemoteViews(c.packageName, R.layout.widget)
            val pending = Store.pending()
            val w = Store.widget()
            val m = runCatching { MediaApi.state() }.getOrNull()
            val line: String; val sub: String
            when {
                pending != null -> { line = pending.optString("title", "Lokey is asking"); sub = pending.optString("detail").lineSequence().firstOrNull() ?: "" }
                w.str("line").isNotEmpty() -> { line = w.str("line"); sub = w.str("sub") }
                m?.optBoolean("playing") == true -> { line = "Playing: " + m.optString("title"); sub = m.optString("artist") }
                else -> { line = "Ask me anything"; sub = "Tap Ask or Listen" }
            }
            v.setTextViewText(R.id.line, line)
            v.setTextViewText(R.id.sub, sub)
            val vis = if (pending != null) View.VISIBLE else View.GONE
            v.setViewVisibility(R.id.allow, vis); v.setViewVisibility(R.id.deny, vis)
            val f = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            fun act(a: String, code: Int) = PendingIntent.getBroadcast(c, code, Intent(c, ActionReceiver::class.java).setAction(a), f)
            fun open(a: String, code: Int) = PendingIntent.getActivity(c, code, Launch.intent(a), f)
            v.setOnClickPendingIntent(R.id.allow, act(ActionReceiver.ALLOW, 10))
            v.setOnClickPendingIntent(R.id.deny, act(ActionReceiver.DENY, 11))
            v.setOnClickPendingIntent(R.id.ask, open(Launch.ACT_ASK, 12))
            v.setOnClickPendingIntent(R.id.listen, open(Launch.ACT_LISTEN, 13))
            v.setOnClickPendingIntent(R.id.root, open(Launch.ACT_ASK, 14))
            return v
        }
    }
}
