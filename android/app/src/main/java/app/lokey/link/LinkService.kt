package app.lokey.link

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.widget.Toast
import org.json.JSONObject

/** Holds the connection to the PC and turns what it says into notifications, popups and widget updates. */
class LinkService : Service() {
    @Volatile private var running = false
    private var worker: Thread? = null
    private val ui = Handler(Looper.getMainLooper())

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        Notif.channels(this)
        startForeground(Notif.ID_LINK, Notif.foreground(this))
        if (!running && Store.paired(this)) { running = true; worker = Thread(::loop, "lokey-link").also { it.start() } }
        if (!Store.paired(this)) stopSelf()
        return START_STICKY
    }

    override fun onDestroy() { running = false; Store.setConnected(this, false); LokeyWidget.refresh(this); super.onDestroy() }

    private fun toast(t: String) = ui.post { Toast.makeText(applicationContext, t, Toast.LENGTH_SHORT).show() }

    private fun loop() {
        var wait = 1000L
        var first = true
        val poll = Thread { while (running) { poll(); try { Thread.sleep(60_000) } catch (_: InterruptedException) { return@Thread } } }.also { it.start() }
        while (running && Store.paired(this)) {
            LokeyWidget.refresh(this)
            val code = Api.events(this, { running }, ::onEvent)
            LokeyWidget.refresh(this)
            if (code == 401) { Store.clear(this); Notif.info(this, "Lokey unpaired", "The PC removed this phone. Pair again to reconnect."); break }
            if (code == 200 && first) first = false
            try { Thread.sleep(wait) } catch (_: InterruptedException) { break }
            wait = if (code == 200) 1000 else (wait * 2).coerceAtMost(30_000) // back off while the PC is off or off the network
        }
        poll.interrupt()
        running = false
        stopSelf()
    }

    private var tick = 0
    private fun poll() { Api.status(this)?.let { Store.setStatus(this, it); LokeyWidget.refresh(this) }; if (tick++ % 5 == 0) runCatching { Mem.sync(this) } } // memory syncs on connect and every ~5 minutes

    private fun onEvent(name: String, data: String) {
        val j = runCatching { JSONObject(data) }.getOrNull() ?: return
        when (name) {
            "confirm" -> { Store.setPending(this, j); Notif.ask(this, j); LokeyWidget.refresh(this) }
            "confirm-done" -> {
                if (Store.pending(this)?.optString("id") == j.optString("id")) Store.setPending(this, null)
                Notif.clearAsk(this); LokeyWidget.refresh(this)
                toast(if (j.optBoolean("ok")) "Lokey: allowed" else "Lokey: not allowed")
            }
            "job" -> Notif.info(this, "Lokey", j.optString("text", j.optString("title")))
            "nudge" -> Notif.info(this, "Lokey", j.optString("text"))
        }
    }

    companion object {
        fun start(c: Context) { if (Store.paired(c)) c.startForegroundService(Intent(c, LinkService::class.java)) }
    }
}
