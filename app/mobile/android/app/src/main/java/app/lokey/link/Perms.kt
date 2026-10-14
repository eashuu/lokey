package app.lokey.link

import android.Manifest
import android.app.AlarmManager
import android.app.AppOpsManager
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** perm.status {name?} / perm.request {name}: runtime permissions are asked in place, special ones open the exact Settings screen. */
object Perms {
    private val ctx get() = App.ctx

    /** runtime permission groups, by the names the page uses */
    private fun runtime(name: String): List<String> = when (name) {
        "mic" -> listOf(Manifest.permission.RECORD_AUDIO)
        "notifications" -> if (Build.VERSION.SDK_INT >= 33) listOf(Manifest.permission.POST_NOTIFICATIONS) else emptyList()
        "contacts" -> listOf(Manifest.permission.READ_CONTACTS)
        "sms" -> listOf(Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS)
        "calendar" -> listOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)
        "calllog" -> listOf(Manifest.permission.READ_CALL_LOG)
        "location" -> listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        "nearby" -> buildList {
            if (Build.VERSION.SDK_INT >= 31) { add(Manifest.permission.BLUETOOTH_CONNECT); add(Manifest.permission.BLUETOOTH_SCAN) }
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.NEARBY_WIFI_DEVICES)
        }
        "media" -> if (Build.VERSION.SDK_INT >= 33) listOf(Manifest.permission.READ_MEDIA_IMAGES) else listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        else -> emptyList()
    }

    private val special = listOf("overlay", "accessibility", "notification-listener", "battery-optimisation-exempt", "usage-access", "write-settings",
        "exact-alarm", "full-screen-intent", "assistant", "autostart", "background-power", "app-info", "live_updates")
    private val runtimeNames = listOf("mic", "notifications", "contacts", "sms", "calendar", "calllog", "location", "nearby", "media")
    val names get() = runtimeNames + special

    private fun canon(n: String) = when (n) { "battery" -> "battery-optimisation-exempt"; "live-updates", "liveUpdates" -> "live_updates"; else -> n }

    fun has(p: String) = ctx.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    fun granted(name: String): Boolean = when (name) {
        "notifications" -> NotificationManagerCompat.from(ctx).areNotificationsEnabled()
        "overlay" -> Settings.canDrawOverlays(ctx)
        "accessibility" -> LokeyAccess.instance != null || enabledList("enabled_accessibility_services")
        "notification-listener" -> NotificationManagerCompat.getEnabledListenerPackages(ctx).contains(App.pkg)
        "battery-optimisation-exempt" -> ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(App.pkg)
        "usage-access" -> runCatching {
            val a = ctx.getSystemService(AppOpsManager::class.java)
            val mode = if (Build.VERSION.SDK_INT >= 29) a.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), App.pkg)
            else @Suppress("DEPRECATION") a.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), App.pkg)
            mode == AppOpsManager.MODE_ALLOWED
        }.getOrDefault(false)
        "write-settings" -> Settings.System.canWrite(ctx)
        "exact-alarm" -> Build.VERSION.SDK_INT < 31 || ctx.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
        "full-screen-intent" -> Build.VERSION.SDK_INT < 34 || ctx.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
        "assistant" -> listOf("assistant", "voice_interaction_service").any { runCatching { Settings.Secure.getString(ctx.contentResolver, it) }.getOrNull()?.contains(App.pkg) == true }
        "live_updates" -> LiveUpdates.canPromote(ctx) == true
        "autostart", "background-power", "app-info" -> false   // no API to read these
        else -> runtime(name).let { l -> if (l.isEmpty()) name in runtimeNames else l.all(::has) }
    }

    private fun enabledList(key: String) =
        runCatching { Settings.Secure.getString(ctx.contentResolver, key).orEmpty().split(':').any { it.startsWith(App.pkg + "/") && it.endsWith("LokeyAccess") } }.getOrDefault(false)

    fun open(action: String, data: String? = null, extras: Map<String, String> = emptyMap()): Boolean {
        val i = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        data?.let { i.data = Uri.parse(it) }
        extras.forEach { (k, v) -> i.putExtra(k, v) }
        return runCatching { ctx.startActivity(i); true }.getOrDefault(false)
    }

    private fun accessComp() = ComponentName(App.pkg, LokeyAccess::class.java.name).flattenToString()

    /** open the exact screen for a special permission */
    private fun openSpecial(name: String): Boolean = when (name) {
        "overlay" -> open(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, "package:${App.pkg}")
        "accessibility" -> open("android.settings.ACCESSIBILITY_DETAILS_SETTINGS", null, mapOf(Intent.EXTRA_COMPONENT_NAME to accessComp())) || open(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        "notification-listener" -> (Build.VERSION.SDK_INT >= 30 && open(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS, null,
            mapOf(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME to ComponentName(App.pkg, LokeyNotifs::class.java.name).flattenToString()))) || open(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        "battery-optimisation-exempt" -> open(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:${App.pkg}") || open(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        "usage-access" -> open(Settings.ACTION_USAGE_ACCESS_SETTINGS, "package:${App.pkg}") || open(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        "write-settings" -> open(Settings.ACTION_MANAGE_WRITE_SETTINGS, "package:${App.pkg}")
        "exact-alarm" -> Build.VERSION.SDK_INT >= 31 && open(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, "package:${App.pkg}")
        "full-screen-intent" -> Build.VERSION.SDK_INT >= 34 && open(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, "package:${App.pkg}")
        "assistant" -> open(Settings.ACTION_VOICE_INPUT_SETTINGS) || open(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
        // vivo / iQOO background-start manager; the component names are best guesses for OriginOS, falling back to the app info page
        "autostart" -> listOf("com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            "com.iqoo.secure" to "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager").any { (p, c) ->
            runCatching { ctx.startActivity(Intent().setComponent(ComponentName(p, c)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true }.getOrDefault(false)
        } || open(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${App.pkg}")
        // vivo / iQOO "background power consumption" screens; best-guess component names for OriginOS, falling back to the app info page
        "background-power" -> listOf("com.vivo.abe" to "com.vivo.applicationbehaviorengine.ui.ExcessivePowerManagerActivity", "com.iqoo.powersaving" to "com.iqoo.powersaving.PowerSavingManagerActivity",
            "com.vivo.abe" to "com.vivo.abe.unifiedpower.UnifiedPowerManagerActivity").any { (p, c) ->
            runCatching { ctx.startActivity(Intent().setComponent(ComponentName(p, c)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true }.getOrDefault(false)
        } || open(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${App.pkg}")
        "app-info" -> open(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${App.pkg}")
        "live_updates" -> open("android.settings.MANAGE_APP_PROMOTED_NOTIFICATIONS", "package:${App.pkg}") || open(Settings.ACTION_APP_NOTIFICATION_SETTINGS, null, mapOf(Settings.EXTRA_APP_PACKAGE to App.pkg))
        else -> false
    }

    /** system.openSettings / intent.settings pages */
    fun openPage(page: String): JSONObject {
        val opened = when (page) {
            "network", "wifi" -> open(Settings.ACTION_WIFI_SETTINGS)
            "bluetooth" -> open(Settings.ACTION_BLUETOOTH_SETTINGS)
            "sound" -> open(Settings.ACTION_SOUND_SETTINGS)
            "display" -> open(Settings.ACTION_DISPLAY_SETTINGS)
            "battery" -> open(Intent.ACTION_POWER_USAGE_SUMMARY)
            "apps" -> open(Settings.ACTION_APPLICATION_SETTINGS)
            "location" -> open(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            "nfc" -> open(Settings.ACTION_NFC_SETTINGS)
            "airplane" -> open(Settings.ACTION_AIRPLANE_MODE_SETTINGS)
            "date" -> open(Settings.ACTION_DATE_SETTINGS)
            "language" -> open(Settings.ACTION_LOCALE_SETTINGS)
            "storage" -> open(Settings.ACTION_INTERNAL_STORAGE_SETTINGS)
            "privacy" -> open(Settings.ACTION_PRIVACY_SETTINGS)
            "security" -> open(Settings.ACTION_SECURITY_SETTINGS)
            "data" -> open(Settings.ACTION_DATA_ROAMING_SETTINGS)
            "vpn" -> open(Settings.ACTION_VPN_SETTINGS)
            "developer" -> open(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
            "notifications" -> open(Settings.ACTION_APP_NOTIFICATION_SETTINGS, null, mapOf(Settings.EXTRA_APP_PACKAGE to App.pkg))
            "default-apps" -> open(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
            "main", "" -> open(Settings.ACTION_SETTINGS)
            else -> if (page in special) openSpecial(page) else open(Settings.ACTION_SETTINGS)
        }
        return if (opened) ok() else fail("could not open settings page: $page")
    }

    // ---- runtime request, waits for the answer ----------------------------------------------------------------------
    private var code = 4200
    private val waiting = HashMap<Int, CompletableFuture<Boolean>>()

    fun onResult(req: Int, perms: Array<out String>, res: IntArray) { waiting.remove(req)?.complete(res.isNotEmpty() && res.all { it == PackageManager.PERMISSION_GRANTED }) }

    private fun request(name: String): JSONObject {
        if (granted(name)) return ok("granted" to true)
        val list = runtime(name)
        val act = App.activity
        if (list.isEmpty() || act == null || !App.foreground) {
            openSpecial("app-info")
            return obj("ok" to false, "granted" to false, "reason" to "open Lokey and try again; opened the app settings page")
        }
        val f = CompletableFuture<Boolean>()
        val c = ++code
        waiting[c] = f
        val t0 = System.currentTimeMillis()
        main { act.requestPermissions(list.filter { !has(it) }.toTypedArray(), c) }
        val g = runCatching { f.get(120, TimeUnit.SECONDS) }.getOrDefault(false)
        waiting.remove(c)
        if (!g && System.currentTimeMillis() - t0 < 400) {
            openSpecial("app-info")
            return obj("ok" to false, "granted" to false, "reason" to "denied before; opened the app settings page, turn it on there")
        }
        Events.emit("perm.changed", obj("name" to name, "granted" to granted(name)))
        return obj("ok" to g, "granted" to g, "reason" to (if (g) null else "denied"))
    }

    fun methods(): Map<String, H> = mapOf(
        "perm.status" h {
            val n = canon(it.str("name"))
            when {
                n.isEmpty() || n == "all" -> obj("permissions" to JSONObject().also { o -> names.forEach { k -> o.put(k, granted(k)) } })
                n !in names -> fail("unknown permission: $n")
                else -> obj("name" to n, "granted" to granted(n), "kind" to (if (n in special) "special" else "runtime"))
            }
        },
        "perm.request" h {
            val n = canon(it.need("name"))
            when {
                n !in names -> fail("unknown permission: $n")
                n in special -> if (granted(n)) ok("granted" to true) else ok("granted" to false, "opened" to openSpecial(n),
                    "note" to "special access: turn it on in the screen that opened, then re-check with perm.status (event app.resume fires on return)")
                else -> request(n)
            }
        },
        "perm.names" h { arr(names) },
    )
}
