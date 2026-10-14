package app.lokey.link

import android.os.Build
import org.json.JSONObject

/** diag.beat (the page calls it every 20 s while alive) and diag.status: why the background things are or are not working */
object Diag {
    @Volatile var lastBeat = 0L
    @Volatile var lastPage = 0L
    fun page(now: Long) { lastPage = now }

    fun status(): JSONObject {
        val now = System.currentTimeMillis()
        return obj(
            "serviceRunning" to LokeyService.running, "serviceMic" to LokeyService.micOk, "overlayShown" to Island.overlayShown(), "overlayReason" to Island.lastReason,
            "overlayGranted" to Perms.granted("overlay"), "systemIsland" to Island.enabled(), "appForeground" to App.foreground,
            "jsHeartbeatAgeMs" to (if (lastBeat == 0L) null else now - lastBeat), "lastIslandUpdateAgeMs" to (if (lastPage == 0L) null else now - lastPage),
            "wakeListening" to Wake.status().optBoolean("listening"), "wakeEnabled" to Wake.wanted(), "wakePaused" to Wake.isPaused(), "wakeError" to Wake.status().opt("error"),
            "wakeLastEventAt" to (if (Wake.lastEventAt == 0L) null else Wake.lastEventAt), "wakeLastDecision" to Wake.lastDecision,
            "linkPaired" to LinkClient.hasCreds(), "linkConnected" to LinkClient.connected, "linkLastEventAt" to (if (LinkClient.lastEventAt == 0L) null else LinkClient.lastEventAt),
            "batteryExempt" to Perms.granted("battery-optimisation-exempt"), "sdk" to Build.VERSION.SDK_INT, "manufacturer" to Build.MANUFACTURER, "brand" to Build.BRAND,
        )
    }

    fun methods(): Map<String, H> = mapOf(
        "diag.beat" h { lastBeat = System.currentTimeMillis(); ok() },
        "diag.status" h { status() },
    )
}
