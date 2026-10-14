package app.lokey.link

import android.app.PendingIntent
import android.app.Notification
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.service.quicksettings.TileService
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.app.RemoteInput
import android.service.quicksettings.Tile
import androidx.core.app.ServiceCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * The foreground service keeps Lokey alive for what needs it: wake-up listening (microphone), the floating island, and "keep running".
 * It stops itself when none of those is wanted. The microphone type is only used when wake is on and the mic permission is granted;
 * Android 14+ refuses to start a microphone service from the background, so that case falls back to a plain one and reports it in wake.status.
 */
class LokeyService : Service() {
    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        App.init(this)
        Notif.channels(this)
        val wantMic = (Wake.wanted() || voiceOn()) && Perms.has(android.Manifest.permission.RECORD_AUDIO) && i?.getBooleanExtra("noMic", false) != true
        var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        if (wantMic && Build.VERSION.SDK_INT >= 30) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        val text = if (voiceOn()) "Voice session" else if (Wake.wanted()) "Listening for wake-up" else "Running"
        try { ServiceCompat.startForeground(this, Notif.ID_FG, Notif.foreground(this, text), type); micOk = wantMic }
        catch (e: Exception) {
            // Android refused the microphone type (background start): run without it
            micOk = false
            try { ServiceCompat.startForeground(this, Notif.ID_FG, Notif.foreground(this, text), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) } catch (e2: Exception) { stopSelf(); return START_NOT_STICKY }
        }
        running = true
        voiceLock(voiceOn())
        Wake.apply(this, micOk)
        Island.apply(this)
        LinkClient.start()
        if (!needed()) { stopSelf(); return START_NOT_STICKY }
        return START_STICKY
    }

    override fun onDestroy() { running = false; voiceLock(false); Wake.stopCapture(); Island.remove(); LinkClient.stop(); super.onDestroy() }

    /** swiped away from recents: ask Android to start this service again in a moment (the mic type may be refused from the background, then it runs without it) */
    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        if (!needed()) return
        runCatching {
            val pi = android.app.PendingIntent.getForegroundService(this, 77, Intent(this, LokeyService::class.java), android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE)
            getSystemService(android.app.AlarmManager::class.java).set(android.app.AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 1500, pi)
        }
    }

    private var lock: android.os.PowerManager.WakeLock? = null
    /** a partial wake lock only while a voice session runs (10 min safety timeout) */
    private fun voiceLock(on: Boolean) {
        if (on && lock == null) lock = getSystemService(android.os.PowerManager::class.java).newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "lokey:voice").also { it.acquire(10 * 60_000L) }
        else if (!on) { lock?.let { if (it.isHeld) it.release() }; lock = null }
    }

    companion object {
        @Volatile var running = false
        @Volatile var micOk = false

        fun voiceOn() = App.prefs.getBoolean("voice", false)
        fun needed(): Boolean = !App.prefs.getBoolean("user_stopped", false) && (voiceOn() || Wake.wanted() || Island.wanted() || LinkClient.hasCreds() || App.prefs.getBoolean("keep", false))

        /** (re)evaluates what the service should be doing, starting or stopping it */
        fun sync(c: Context, noMic: Boolean = false) {
            App.init(c)
            if (needed()) runCatching { c.startForegroundService(Intent(c, LokeyService::class.java).putExtra("noMic", noMic)) }
            else if (running) c.stopService(Intent(c, LokeyService::class.java))
        }
    }
}

object ServiceApi {
    fun methods(): Map<String, H> = mapOf(
        "service.set" h { App.prefs.edit().putBoolean("keep", it.bool("on")).apply(); LokeyService.sync(App.ctx); ok("running" to LokeyService.running) },
        "service.status" h { obj("running" to LokeyService.running, "keep" to App.prefs.getBoolean("keep", false), "mic" to LokeyService.micOk, "island" to Island.shown(), "wake" to Wake.status()) },
        "app.launchAction" h { obj("launch" to Launch.take()) },
        "app.openSelf" h { Launch.start(Launch.ACT_ASK); ok() },
        "app.methods" h { arr(Router.names()) },
        "island.update" h { Island.update(it) },
        "island.setEnabled" h { Island.setEnabled(it) },
        "island.set" h { Island.setEnabled(obj("overlay" to it.bool("on"))) },
        "island.status" h { Island.status() },
        "island.vivoProbe" h { VivoIsland.probe(App.ctx, it) },
        "app.bringToFront" h { Island.bringToFront(it.bool("voice")) },
        "app.sendToBack" h { Island.sendToBack() },
        "service.voice" h { App.prefs.edit().putBoolean("voice", it.bool("on")).apply(); LokeyService.sync(App.ctx); ok("running" to LokeyService.running, "mic" to LokeyService.micOk) },
        "widget.update" h { Store.setWidget(it); LokeyWidget.refresh(App.ctx); ok() },
    )
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        App.init(c)
        Notif.channels(c)
        App.prefs.edit().putBoolean("voice", false).apply()
        runCatching { Reminders.rearm() }
        LokeyService.sync(c, noMic = true)   // a boot-time start may not use the microphone; opening Lokey once re-enables wake
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { App.init(c); Notif.channels(c); i.getStringExtra("id")?.let { Reminders.fired(it) } }
}

/** Allow / Deny pressed on a confirm card or the widget: told to the page ('confirm.action'), kept until the page is alive */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        App.init(c)
        if (i.action == LiveUpdates.ACT_FACE) {   // a button on an island Live Update notification
            val face = i.getStringExtra("faceId") ?: return
            val act = i.getStringExtra("actionId") ?: ""
            if (!Island.handleAction(face, act)) Events.emit("island.action", obj("faceId" to face, "face" to face, "actionId" to act, "action" to act), durable = true)
            if (i.getBooleanExtra("close", false)) c.getSystemService(android.app.NotificationManager::class.java).cancel(LiveUpdates.id(face))
            return
        }
        when (i.action) {   // buttons on the foreground-service notification
            SVC_ASK -> { runCatching { Launch.start(Launch.ACT_ASK) }; return }
            SVC_PAUSE -> { Wake.togglePaused(); return }
            SVC_STOP -> { App.prefs.edit().putBoolean("user_stopped", true).apply(); c.stopService(Intent(c, LokeyService::class.java)); return }
        }
        val id = i.getStringExtra("id") ?: Store.pending()?.optString("id") ?: return
        Events.emit("confirm.action", obj("id" to id, "allow" to (i.action == ALLOW)), durable = true)
        Notif.cancel(c, id)
        Store.setPending(null); LokeyWidget.refresh(c)
        if (App.plugin == null) Launch.pending = obj("action" to "confirm", "id" to id)
    }

    companion object { const val ALLOW = "app.lokey.link.ALLOW"; const val DENY = "app.lokey.link.DENY"; const val SVC_ASK = "app.lokey.link.SVC_ASK"; const val SVC_PAUSE = "app.lokey.link.SVC_PAUSE"; const val SVC_STOP = "app.lokey.link.SVC_STOP" }
}

/**
 * Notification access: other apps' notifications (list / reply / dismiss) and the gate for MediaSessions.
 * The object-like helpers below work on the live service instance, and fail with a clear reason when access is not on.
 */
class LokeyNotifs : NotificationListenerService() {
    override fun onListenerConnected() { instance = this; App.init(this); MediaApi.attach(); Events.emit("perm.changed", obj("name" to "notification-listener", "granted" to true)) }
    override fun onListenerDisconnected() { if (instance === this) instance = null; MediaApi.detach() }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (sbn.packageName == packageName || sbn.isOngoing || sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        Events.emit("notification.posted", summary(sbn))
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) { if (sbn.packageName != packageName) Events.emit("notification.removed", obj("key" to sbn.key)) }

    companion object {
        @Volatile var instance: LokeyNotifs? = null

        private fun label(pkg: String) = runCatching { App.ctx.packageManager.let { it.getApplicationLabel(it.getApplicationInfo(pkg, 0)).toString() } }.getOrDefault(pkg)

        fun summary(s: StatusBarNotification): JSONObject {
            val e = s.notification.extras
            val reply = s.notification.actions?.any { a -> a.remoteInputs?.isNotEmpty() == true } == true
            return obj("key" to s.key, "package" to s.packageName, "app" to label(s.packageName), "title" to e.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
                "text" to (e.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: e.getCharSequence(Notification.EXTRA_TEXT))?.toString(), "time" to s.postTime, "ongoing" to s.isOngoing, "canReply" to reply,
                "actions" to arr(s.notification.actions?.map { it.title?.toString() }.orEmpty()))
        }

        fun list(limit: Int): Any {
            val l = instance ?: return fail("needs notification access (perm.request notification-listener)")
            return arr(l.activeNotifications.filter { it.packageName != App.pkg }.sortedByDescending { it.postTime }.take(limit).map(::summary))
        }

        fun reply(key: String, text: String): JSONObject {
            val l = instance ?: return fail("needs notification access (perm.request notification-listener)")
            val s = l.activeNotifications.firstOrNull { it.key == key } ?: return fail("that notification is gone")
            for (a in s.notification.actions.orEmpty()) {
                val ri = a.remoteInputs?.firstOrNull() ?: continue
                val i = Intent(); val b = Bundle(); b.putCharSequence(ri.resultKey, text)
                RemoteInput.addResultsToIntent(a.remoteInputs, i, b)
                a.actionIntent.send(App.ctx, 0, i)
                return ok()
            }
            return fail("that notification cannot be replied to")
        }

        fun dismiss(key: String): JSONObject { val l = instance ?: return fail("needs notification access"); l.cancelNotification(key); return ok() }
    }
}

private fun tileLaunch(t: TileService, action: String) {
    val i = Launch.intent(action)
    if (Build.VERSION.SDK_INT >= 34) t.startActivityAndCollapse(PendingIntent.getActivity(t, action.hashCode(), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    else @Suppress("DEPRECATION") t.startActivityAndCollapse(i)
}

class AskTile : TileService() {
    override fun onStartListening() { qsTile?.apply { state = Tile.STATE_INACTIVE; updateTile() } }
    override fun onClick() { App.init(this); tileLaunch(this, Launch.ACT_ASK) }
}

class ListenTile : TileService() {
    override fun onStartListening() { App.init(this); qsTile?.apply { state = if (Wake.status().optBoolean("listening")) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE; updateTile() } }
    override fun onClick() { App.init(this); tileLaunch(this, Launch.ACT_LISTEN) }
}

/** Being the "digital assistant": the power-button / corner-swipe assistant gesture opens Lokey straight into listening. */
class LokeyVoiceService : VoiceInteractionService()

class LokeySessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession = object : VoiceInteractionSession(this) {
        override fun onShow(args: Bundle?, showFlags: Int) {
            super.onShow(args, showFlags)
            App.init(context)
            Launch.pending = obj("action" to "listen")
            runCatching { startAssistantActivity(Launch.intent(Launch.ACT_LISTEN)) }.onFailure { runCatching { context.startActivity(Launch.intent(Launch.ACT_LISTEN)) } }
            hide()
        }
    }
}
