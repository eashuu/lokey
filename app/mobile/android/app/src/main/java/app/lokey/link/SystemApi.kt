package app.lokey.link

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.UiModeManager
import android.app.WallpaperManager
import android.app.usage.UsageStatsManager
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.wifi.WifiManager
import android.net.TrafficStats
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.Process
import android.os.StatFs
import android.os.SystemClock
import android.provider.MediaStore
import android.provider.Settings
import android.view.WindowInsets
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Locale
import kotlin.math.roundToInt

private val ctx get() = App.ctx
private inline fun <reified T> svc(): T = ctx.getSystemService(T::class.java)

/** display, audio, system status, Wi-Fi, Bluetooth, stats, apps, wallpaper, power: the sidecar methods the island tabs use */
object SystemApi {
    fun methods(): Map<String, H> = mapOf(
        "sys.hello" h { obj("version" to 1, "host" to "android") },
        "sys.quit" h { obj() },
        "display.get" h { display() },
        "user.get" h { user() },
        "hotkey.register" h { fail("no global hotkeys on Android") },
        "hotkey.registerHold" h { fail("no global hotkeys on Android") },
        "hotkey.unregisterAll" h { obj() },

        "audio.get" h { audioState() },
        "audio.setVolume" h { val a = svc<AudioManager>(); a.setStreamVolume(AudioManager.STREAM_MUSIC, (it.num("level").coerceIn(0.0, 1.0) * a.getStreamMaxVolume(AudioManager.STREAM_MUSIC)).roundToInt(), 0); audioChanged(); obj() },
        "audio.setMuted" h { svc<AudioManager>().adjustStreamVolume(AudioManager.STREAM_MUSIC, if (it.bool("muted")) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE, 0); audioChanged(); obj() },
        "audio.setMicMuted" h { svc<AudioManager>().isMicrophoneMute = it.bool("muted"); audioChanged(); obj() },
        "audio.devices" h { audioDevices() },
        "audio.setDefault" h { openPanel(Settings.Panel.ACTION_VOLUME); fail("Android has no API to pick the output; opened the volume panel") },
        "audio.visualiser" h { Viz.set(it.bool("on")) },

        "stats.subscribe" h { Stats.start(it.long("intervalMs", 2000).coerceAtLeast(500)) },
        "stats.unsubscribe" h { Stats.stop(); obj() },

        "system.get" h { systemStatus() },
        "system.setBrightness" h { setBrightness(it.num("level").coerceIn(0.0, 1.0)) },
        "system.setKeepAwake" h { keepAwake(it.bool("on")) },
        "system.setDarkMode" h { setDark(it.bool("on")) },
        "system.setNightLight" h { Perms.open(Settings.ACTION_DISPLAY_SETTINGS); fail("Android has no API for night light; opened Display settings") },
        "system.setBluetooth" h { setBluetooth(it.bool("on")) },
        "system.openSettings" h { Perms.openPage(it.str("page", "main")) },
        "wifi.get" h { wifiState() },
        "wifi.scan" h { wifiScan() },
        "wifi.setOn" h { openPanel(Settings.Panel.ACTION_INTERNET_CONNECTIVITY); fail("Android 10+ does not let apps switch Wi-Fi; opened the Internet panel") },
        "wifi.connect" h { openPanel(Settings.Panel.ACTION_WIFI); fail("Android 10+ does not let apps join networks silently; opened the Wi-Fi panel") },
        "wifi.disconnect" h { openPanel(Settings.Panel.ACTION_WIFI); obj() },
        "bt.get" h { btState() },
        "bt.devices" h { btDevices() },
        "bt.discover" h { btDiscover(it.int("seconds", 8)) },
        "bt.pair" h { btBond(it.need("id"), true) },
        "bt.forget" h { btBond(it.need("id"), false); obj() },
        "bt.connect" h { Perms.open(Settings.ACTION_BLUETOOTH_SETTINGS); fail("Android has no public API to connect a paired device; opened Bluetooth settings") },
        "bt.disconnect" h { Perms.open(Settings.ACTION_BLUETOOTH_SETTINGS); fail("Android has no public API to disconnect a device; opened Bluetooth settings") },

        "apps.list" h { Apps.list() },
        "apps.search" h { Apps.search(it.str("query")) },
        "apps.icon" h { obj("icon" to Apps.icon(it.need("id"))) },
        "apps.launch" h { Apps.launch(it.need("id")) },
        "apps.star" h { Apps.star(it.need("id"), it.bool("on")); obj() },
        "apps.searchFiles" h { Apps.searchFiles(it.str("query"), it.int("limit", 20)) },
        "apps.openPath" h { PhoneApi.openUri(it.need("path")) },

        "clipboard.list" h { Clips.list(it.str("query"), it.str("kind"), it.int("limit", 100)) },
        "clipboard.get" h { Clips.get(it.need("id")) },
        "clipboard.pin" h { Clips.pin(it.need("id"), it.bool("on")); obj() },
        "clipboard.delete" h { Clips.delete(it.need("id")); obj() },
        "clipboard.clear" h { Clips.clear(it.bool("keepPinned", true)); obj() },
        "clipboard.paste" h { Clips.paste(it.need("id")) },
        "clipboard.settings" h { Clips.settings(it.int("retentionDays", 7), it.bool("autoPaste")); obj() },
        "clipboard.set" h { Clips.set(it.str("text")) },
        "clipboard.read" h { Clips.capture(); obj("text" to Clips.current()) },

        "wallpaper.get" h { obj("path" to null) },
        "wallpaper.set" h { Wallpaper.set(it.need("path")) },
        "wallpaper.recent" h { Wallpaper.images("", 12) },
        "wallpaper.folder" h { Wallpaper.images(it.str("folder"), it.int("limit", 40)) },
        "wallpaper.thumb" h { obj("thumb" to Wallpaper.thumb(it.need("path"), it.int("size", 160))) },

        "desktops.get" h { obj("count" to 1, "current" to 0, "occupied" to arr(listOf(true))) },
        "desktops.switch" h { obj() },
        "power.do" h { power(it.str("action")) },
        "process.list" h { JSONArray() },
        "process.close" h { fail("Android apps cannot close other apps") },
        "process.kill" h { fail("Android apps cannot kill other apps") },
    )

    // ---- display / user -------------------------------------------------------------------------------------------
    private fun display(): JSONObject {
        val wm = svc<WindowManager>()
        val dm = ctx.resources.displayMetrics
        var w = dm.widthPixels; var h = dm.heightPixels
        var work = obj("x" to 0, "y" to 0, "w" to w, "h" to h)
        if (Build.VERSION.SDK_INT >= 30) {
            val b = wm.maximumWindowMetrics.bounds; w = b.width(); h = b.height()
            val i = wm.currentWindowMetrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars())
            work = obj("x" to i.left, "y" to i.top, "w" to w - i.left - i.right, "h" to h - i.top - i.bottom)
        }
        return obj("bounds" to obj("x" to 0, "y" to 0, "w" to w, "h" to h), "work" to work, "dpi" to (dm.densityDpi * 96 / 160))
    }

    private fun user(): JSONObject {
        val name = runCatching { Settings.Global.getString(ctx.contentResolver, "device_name") }.getOrNull()?.takeIf { it.isNotBlank() } ?: Build.MODEL
        return obj("name" to name, "avatar" to null, "machine" to "${Build.MANUFACTURER} ${Build.MODEL}")
    }

    // ---- audio ----------------------------------------------------------------------------------------------------
    private fun outputs(): List<AudioDeviceInfo> = svc<AudioManager>().getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()

    private fun outRank(t: Int) = when (t) {
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, 26, 27 -> 0   // 26 = BLE headset, 27 = BLE speaker
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET -> 1
        AudioDeviceInfo.TYPE_USB_DEVICE -> 2
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> 3
        else -> 9
    }

    private fun devName(d: AudioDeviceInfo): String = d.productName?.toString()?.takeIf { it.isNotBlank() && it != Build.MODEL }
        ?: when (d.type) { AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Phone speaker"; AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "Earpiece"; AudioDeviceInfo.TYPE_BUILTIN_MIC -> "Phone microphone"; else -> "Audio device" }

    private fun audioState(): JSONObject {
        val a = svc<AudioManager>()
        val max = a.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val dev = outputs().filter { outRank(it.type) < 9 }.minByOrNull { outRank(it.type) }
        return obj("volume" to a.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max, "muted" to a.isStreamMute(AudioManager.STREAM_MUSIC),
            "device" to (dev?.let(::devName) ?: "Phone speaker"), "micMuted" to a.isMicrophoneMute)
    }

    private fun audioChanged() = Events.emit("audio.changed", audioState())

    private fun audioDevices(): JSONArray {
        val a = svc<AudioManager>()
        val out = outputs().filter { outRank(it.type) < 9 }.sortedBy { outRank(it.type) }
        val list = out.mapIndexed { i, d -> obj("id" to "o${d.id}", "name" to devName(d), "kind" to "output", "isDefault" to (i == 0)) }.toMutableList()
        a.getDevices(AudioManager.GET_DEVICES_INPUTS).filter { it.type != AudioDeviceInfo.TYPE_TELEPHONY }.forEachIndexed { i, d ->
            list += obj("id" to "i${d.id}", "name" to devName(d), "kind" to "input", "isDefault" to (i == 0))
        }
        return arr(list)
    }

    fun openPanel(action: String) {
        val i = Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { ctx.startActivity(i) }.onFailure { Perms.open(Settings.ACTION_SETTINGS) }
    }

    // ---- system status --------------------------------------------------------------------------------------------
    private fun rssiPct(rssi: Int) = ((rssi + 100).coerceIn(0, 60) * 100 / 60)

    @SuppressLint("MissingPermission")
    private fun wifiConn(): Pair<String, Int>? {
        val wm = ctx.applicationContext.getSystemService(WifiManager::class.java) ?: return null
        @Suppress("DEPRECATION") val ci = wm.connectionInfo ?: return null
        if (ci.networkId == -1 && ci.rssi <= -127) return null
        @Suppress("DEPRECATION") var ssid = ci.ssid?.trim('"') ?: ""
        if (ssid.isEmpty() || ssid == "<unknown ssid>") ssid = "Wi-Fi"
        return ssid to rssiPct(ci.rssi)
    }

    /** note: `network.kind` may also be 'cellular' on Android (the Windows protocol only knows wifi | ethernet | none) */
    private fun network(): JSONObject {
        val cm = svc<ConnectivityManager>()
        val caps = cm.getNetworkCapabilities(cm.activeNetwork ?: return obj("kind" to "none", "name" to "", "signal" to null)) ?: return obj("kind" to "none", "name" to "", "signal" to null)
        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> wifiConn().let { obj("kind" to "wifi", "name" to (it?.first ?: "Wi-Fi"), "signal" to it?.second) }
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> obj("kind" to "cellular", "name" to (svc<android.telephony.TelephonyManager>().networkOperatorName ?: ""), "signal" to null)
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> obj("kind" to "ethernet", "name" to "Ethernet", "signal" to null)
            else -> obj("kind" to "none", "name" to "", "signal" to null)
        }
    }

    private fun battery(): JSONObject {
        val i = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val bm = svc<BatteryManager>()
        val level = i?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = i?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val status = i?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        val left = if (Build.VERSION.SDK_INT >= 28 && charging) bm.computeChargeTimeRemaining().takeIf { it > 0 }?.let { (it / 60000).toInt() } else null
        return obj("present" to (level >= 0), "pct" to (if (level < 0) 0 else level * 100 / scale), "charging" to charging, "minutesLeft" to left)
    }

    private fun keyboard(): String {
        val tag = runCatching { svc<InputMethodManager>().currentInputMethodSubtype?.languageTag }.getOrNull().orEmpty()
        val loc = if (tag.isNotEmpty()) Locale.forLanguageTag(tag) else Locale.getDefault()
        return runCatching { loc.isO3Language.uppercase() }.getOrDefault("ENG")
    }

    fun brightness(): Double? {
        val v = runCatching { Settings.System.getInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS) }.getOrNull() ?: return null
        return (v / 255.0).coerceIn(0.0, 1.0)
    }

    @Volatile var keepAwakeOn = false

    fun systemStatus(): JSONObject = obj(
        "network" to network(), "bluetooth" to btState(), "battery" to battery(), "keyboard" to keyboard(), "keepAwake" to keepAwakeOn,
        "brightness" to brightness(), "darkMode" to ((ctx.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES),
        "nightLight" to null,
    )

    private fun setBrightness(level: Double): JSONObject {
        if (Settings.System.canWrite(ctx)) {
            Settings.System.putInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL)
            Settings.System.putInt(ctx.contentResolver, Settings.System.SCREEN_BRIGHTNESS, (level * 255).roundToInt())
            return ok("scope" to "system")
        }
        val act = App.activity ?: return fail("needs the 'Modify system settings' permission (perm.request write-settings)")
        main { act.window.attributes = act.window.attributes.also { it.screenBrightness = level.toFloat().coerceAtLeast(0.01f) } }
        return ok("scope" to "window", "note" to "only while Lokey is open; grant write-settings for system brightness")
    }

    private fun keepAwake(on: Boolean): JSONObject {
        val act = App.activity ?: return fail("app not in the foreground")
        main { if (on) act.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else act.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
        keepAwakeOn = on; Observers.systemChanged()
        return ok()
    }

    private fun setDark(on: Boolean): JSONObject {
        runCatching {
            val m = svc<UiModeManager>()
            if (Build.VERSION.SDK_INT >= 31) m.setApplicationNightMode(if (on) UiModeManager.MODE_NIGHT_YES else UiModeManager.MODE_NIGHT_NO)
            else m.nightMode = if (on) UiModeManager.MODE_NIGHT_YES else UiModeManager.MODE_NIGHT_NO
            return ok("scope" to "app")
        }
        Perms.open(Settings.ACTION_DISPLAY_SETTINGS)
        return fail("Android does not let apps switch the system theme; opened Display settings")
    }

    // ---- Wi-Fi ----------------------------------------------------------------------------------------------------
    private fun locationOn(): Boolean = runCatching { svc<android.location.LocationManager>().isLocationEnabled }.getOrDefault(true)
    private fun hasWifiPerm() = Perms.granted("location") || (Build.VERSION.SDK_INT >= 33 && Perms.has(android.Manifest.permission.NEARBY_WIFI_DEVICES))

    private fun wifiState(): JSONObject {
        val wm = ctx.applicationContext.getSystemService(WifiManager::class.java) ?: return obj("available" to false, "on" to false, "connected" to null, "accessDenied" to false)
        val c = wifiConn()?.takeIf { wm.isWifiEnabled }
        return obj("available" to true, "on" to wm.isWifiEnabled, "connected" to c?.let { obj("ssid" to it.first, "signal" to it.second) }, "accessDenied" to (!hasWifiPerm() || !locationOn()))
    }

    @SuppressLint("MissingPermission")
    private fun wifiScan(): JSONArray {
        val wm = ctx.applicationContext.getSystemService(WifiManager::class.java) ?: return JSONArray()
        if (!hasWifiPerm()) throw Fail("needs location permission (perm.request location)")
        @Suppress("DEPRECATION") runCatching { wm.startScan() } // throttled by the OS (4 per 2 min); the last results are returned either way
        Thread.sleep(1500)
        val cur = wifiConn()?.first
        val seen = HashMap<String, JSONObject>()
        for (r in wm.scanResults) {
            @Suppress("DEPRECATION") val ssid = r.SSID.orEmpty(); if (ssid.isEmpty()) continue
            val o = obj("ssid" to ssid, "signal" to rssiPct(r.level), "secured" to (!r.capabilities.contains("ESS") || r.capabilities.contains("WPA") || r.capabilities.contains("WEP") || r.capabilities.contains("SAE")), "connected" to (ssid == cur), "known" to (ssid == cur))
            if ((seen[ssid]?.optInt("signal", -1) ?: -1) < o.getInt("signal")) seen[ssid] = o
        }
        return arr(seen.values.sortedWith(compareByDescending<JSONObject> { it.getBoolean("connected") }.thenByDescending { it.getInt("signal") }))
    }

    // ---- Bluetooth ------------------------------------------------------------------------------------------------
    private fun adapter(): BluetoothAdapter? = svc<BluetoothManager>().adapter

    private fun btState(): JSONObject = adapter().let { obj("available" to (it != null), "on" to (it?.isEnabled == true)) }

    private fun btKind(d: BluetoothDevice): String = when (runCatching { d.bluetoothClass?.majorDeviceClass }.getOrNull()) {
        BluetoothClass.Device.Major.AUDIO_VIDEO -> "audio"; BluetoothClass.Device.Major.PERIPHERAL -> "input"
        BluetoothClass.Device.Major.PHONE -> "phone"; BluetoothClass.Device.Major.COMPUTER -> "computer"; else -> "other"
    }

    private fun btInfo(d: BluetoothDevice, paired: Boolean): JSONObject {
        // isConnected / getBatteryLevel are hidden-but-callable on current Android; if the OS blocks them the values degrade to false / null
        val connected = runCatching { BluetoothDevice::class.java.getMethod("isConnected").invoke(d) as Boolean }.getOrDefault(false)
        val bat = runCatching { (BluetoothDevice::class.java.getMethod("getBatteryLevel").invoke(d) as Int).takeIf { it in 0..100 } }.getOrNull()
        return obj("id" to d.address, "name" to (runCatching { d.alias ?: d.name }.getOrNull() ?: d.address), "kind" to btKind(d), "paired" to paired, "connected" to connected, "battery" to bat)
    }

    @SuppressLint("MissingPermission")
    private fun btDevices(): JSONArray {
        if (!Perms.has(android.Manifest.permission.BLUETOOTH_CONNECT) && Build.VERSION.SDK_INT >= 31) throw Fail("needs Nearby devices permission (perm.request nearby)")
        return arr(adapter()?.bondedDevices.orEmpty().map { btInfo(it, true) }.sortedByDescending { it.getBoolean("connected") })
    }

    @SuppressLint("MissingPermission")
    private fun btDiscover(seconds: Int): Any {
        val a = adapter() ?: return JSONArray()
        if (Build.VERSION.SDK_INT >= 31 && !Perms.has(android.Manifest.permission.BLUETOOTH_SCAN)) throw Fail("needs Nearby devices permission (perm.request nearby)")
        val found = LinkedHashMap<String, JSONObject>()
        val r = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                @Suppress("DEPRECATION") val d = i.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE) ?: return
                if (d.bondState != BluetoothDevice.BOND_BONDED) found[d.address] = btInfo(d, false)
            }
        }
        ContextCompat.registerReceiver(ctx, r, IntentFilter(BluetoothDevice.ACTION_FOUND), ContextCompat.RECEIVER_NOT_EXPORTED)
        try { a.startDiscovery(); Thread.sleep(seconds.coerceIn(2, 20) * 1000L) } finally { runCatching { a.cancelDiscovery() }; runCatching { ctx.unregisterReceiver(r) } }
        return arr(found.values)
    }

    @SuppressLint("MissingPermission")
    private fun btBond(id: String, pair: Boolean): JSONObject {
        val d = adapter()?.getRemoteDevice(id) ?: return fail("no Bluetooth")
        return if (pair) { if (d.createBond()) ok() else fail("pairing could not start") }
        else runCatching { BluetoothDevice::class.java.getMethod("removeBond").invoke(d); ok() }.getOrElse { Perms.open(Settings.ACTION_BLUETOOTH_SETTINGS); fail("opened Bluetooth settings to forget the device") }
    }

    @SuppressLint("MissingPermission")
    private fun setBluetooth(on: Boolean): JSONObject {
        if (on) { runCatching { ctx.startActivity(Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.onFailure { return fail("could not ask: ${it.message}") }; return ok("asked" to true) }
        Perms.open(Settings.ACTION_BLUETOOTH_SETTINGS)
        return fail("Android does not let apps switch Bluetooth off; opened Bluetooth settings")
    }

    // ---- power ----------------------------------------------------------------------------------------------------
    private fun power(action: String): JSONObject {
        val a = LokeyAccess.instance ?: return fail("needs the Lokey accessibility service (perm.request accessibility)")
        return when (action) {
            "lock", "sleep", "hibernate" -> if (Build.VERSION.SDK_INT >= 28) { a.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN); ok() } else fail("needs Android 9")
            else -> { a.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_POWER_DIALOG); ok("note" to "opened the power menu; shutdown and restart are the user's tap") }
        }
    }
}

/** Observers: OS notifications -> events, registered once when the plugin loads. No polling. */
object Observers {
    private var started = false
    private var pending = false

    fun systemChanged() {
        if (pending) return
        pending = true
        App.ui.postDelayed({ pending = false; runCatching { Events.emit("system.changed", SystemApi.systemStatus()) } }, 600)
    }

    fun start() {
        if (started) return
        started = true
        val c = App.ctx
        fun reg(action: String, f: () -> Unit) = runCatching { ContextCompat.registerReceiver(c, object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) = f() }, IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED) }
        reg(Intent.ACTION_BATTERY_CHANGED) { systemChanged() }
        reg(BluetoothAdapter.ACTION_STATE_CHANGED) { Events.emit("bt.changed", obj()); systemChanged() }
        reg(BluetoothDevice.ACTION_ACL_CONNECTED) { Events.emit("bt.changed", obj()); Events.emit("audio.devices.changed", obj()) }
        reg(BluetoothDevice.ACTION_ACL_DISCONNECTED) { Events.emit("bt.changed", obj()); Events.emit("audio.devices.changed", obj()) }
        reg(WifiManager.WIFI_STATE_CHANGED_ACTION) { Events.emit("wifi.changed", runCatching { Router.call("wifi.get", obj()) }.getOrNull()); systemChanged() }
        reg("android.media.VOLUME_CHANGED_ACTION") { runCatching { Events.emit("audio.changed", Router.call("audio.get", obj())) } }
        reg(Intent.ACTION_CONFIGURATION_CHANGED) { systemChanged() }
        runCatching { ContextCompat.registerReceiver(c, object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) { Apps.invalidate(); Events.emit("apps.changed", obj()) } },
            IntentFilter().apply { addAction(Intent.ACTION_PACKAGE_ADDED); addAction(Intent.ACTION_PACKAGE_REMOVED); addDataScheme("package") }, ContextCompat.RECEIVER_NOT_EXPORTED) }
        runCatching { c.getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(n: Network) = systemChanged()
            override fun onLost(n: Network) = systemChanged()
            override fun onCapabilitiesChanged(n: Network, nc: NetworkCapabilities) = systemChanged()
        }) }
        runCatching { c.getSystemService(AudioManager::class.java).registerAudioDeviceCallback(object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(d: Array<out AudioDeviceInfo>) { Events.emit("audio.devices.changed", obj()); runCatching { Events.emit("audio.changed", Router.call("audio.get", obj())) } }
            override fun onAudioDevicesRemoved(d: Array<out AudioDeviceInfo>) { Events.emit("audio.devices.changed", obj()); runCatching { Events.emit("audio.changed", Router.call("audio.get", obj())) } }
        }, App.ui) }
        runCatching { Clips.listen() }
    }
}

/** Stats: the first tick is returned, then `stats.tick` events while subscribed. Android hides /proc/stat, so cpu.pct is Lokey's own load when the real one is unreadable. */
object Stats {
    private var run = false
    private var thread: Thread? = null
    private var lastIdle = 0L; private var lastTotal = 0L; private var lastCpu = 0L; private var lastWall = 0L
    private var lastRx = 0L; private var lastTx = 0L; private var lastNet = 0L

    private fun readProcStat(): Pair<Long, Long>? = runCatching {
        File("/proc/stat").bufferedReader().use { it.readLine() }.split(Regex("\\s+")).drop(1).map { v -> v.toLong() }.let { v -> (v[3] + v[4]) to v.sum() }
    }.getOrNull()

    private fun cpuPct(): Pair<Double, Boolean> {
        readProcStat()?.let { (idle, total) ->
            val di = idle - lastIdle; val dt = total - lastTotal; lastIdle = idle; lastTotal = total
            if (dt > 0) return (100.0 * (dt - di) / dt).coerceIn(0.0, 100.0) to true
        }
        val cpu = Process.getElapsedCpuTime(); val wall = SystemClock.elapsedRealtime()
        val pct = if (lastWall > 0 && wall > lastWall) 100.0 * (cpu - lastCpu) / ((wall - lastWall) * Runtime.getRuntime().availableProcessors()) else 0.0
        lastCpu = cpu; lastWall = wall
        return pct.coerceIn(0.0, 100.0) to false
    }

    private fun ghz(): Double = runCatching {
        File("/sys/devices/system/cpu").listFiles { f -> f.name.matches(Regex("cpu\\d+")) }!!.maxOf { File(it, "cpufreq/scaling_cur_freq").readText().trim().toDouble() } / 1e6
    }.getOrDefault(0.0)

    fun tick(): JSONObject {
        val am = ctx.getSystemService(ActivityManager::class.java)
        val mi = ActivityManager.MemoryInfo(); am.getMemoryInfo(mi)
        val fs = StatFs(Environment.getDataDirectory().path)
        val now = SystemClock.elapsedRealtime(); val rx = TrafficStats.getTotalRxBytes(); val tx = TrafficStats.getTotalTxBytes()
        val dt = if (lastNet > 0) (now - lastNet) / 1000.0 else 0.0
        val down = if (dt > 0) ((rx - lastRx) / dt).toLong().coerceAtLeast(0) else 0L
        val up = if (dt > 0) ((tx - lastTx) / dt).toLong().coerceAtLeast(0) else 0L
        lastRx = rx; lastTx = tx; lastNet = now
        val temp = ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Int.MIN_VALUE)?.takeIf { it != Int.MIN_VALUE }?.let { it / 10.0 }
        val (pct, real) = cpuPct()
        return obj(
            "cpu" to obj("pct" to pct, "name" to (if (Build.VERSION.SDK_INT >= 31) Build.SOC_MODEL else Build.HARDWARE), "ghz" to ghz(), "processes" to 0, "tempC" to temp, "ownLoadOnly" to !real),
            "gpu" to null,
            "ram" to obj("used" to (mi.totalMem - mi.availMem), "total" to mi.totalMem),
            "disk" to obj("letter" to "Phone", "used" to (fs.totalBytes - fs.availableBytes), "total" to fs.totalBytes),
            "net" to obj("down" to down, "up" to up),
            "uptimeSec" to SystemClock.elapsedRealtime() / 1000,
            "top" to JSONArray(),   // Android does not let apps list other processes
        )
    }

    @Synchronized fun start(intervalMs: Long): JSONObject {
        stop(); run = true
        val first = tick()
        thread = Thread({ while (run) { try { Thread.sleep(intervalMs) } catch (_: InterruptedException) { break }; if (run) runCatching { Events.emit("stats.tick", tick()) } } }, "lokey-stats").also { it.isDaemon = true; it.start() }
        return first
    }

    @Synchronized fun stop() { run = false; thread?.interrupt(); thread = null }
}

object Apps {
    private var cache: JSONArray? = null
    fun invalidate() { cache = null }

    private fun stars(): Set<String> = App.prefs.getStringSet("starred", emptySet()) ?: emptySet()
    fun star(id: String, on: Boolean) { App.prefs.edit().putStringSet("starred", stars().toMutableSet().also { if (on) it += id else it -= id }).apply() }

    private fun lastUsed(): Map<String, Long> = runCatching {
        val now = System.currentTimeMillis()
        ctx.getSystemService(UsageStatsManager::class.java).queryAndAggregateUsageStats(now - 30L * 86400_000, now).mapValues { it.value.lastTimeUsed }
    }.getOrDefault(emptyMap())

    fun list(): JSONArray {
        val pm = ctx.packageManager
        val used = lastUsed(); val st = stars()
        val store = setOf("com.android.vending", "com.vivo.appstore", "com.heytap.market", "com.xiaomi.market")
        val items = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .filter { it.activityInfo.packageName != App.pkg }
            .distinctBy { it.activityInfo.packageName }
            .map {
                val p = it.activityInfo.packageName
                val kind = when { p in store -> "store"; it.activityInfo.applicationInfo.category == ApplicationInfo.CATEGORY_GAME -> "game"; else -> "app" }
                obj("id" to p, "name" to it.loadLabel(pm).toString(), "kind" to kind, "starred" to (p in st), "lastUsed" to used[p]?.takeIf { t -> t > 0 })
            }.sortedBy { it.getString("name").lowercase() }
        return arr(items).also { cache = it }
    }

    fun search(q: String): JSONArray {
        val all = cache ?: list(); val n = q.trim().lowercase()
        return arr((0 until all.length()).map { all.getJSONObject(it) }.filter { it.getString("name").lowercase().contains(n) || it.getString("id").contains(n) })
    }

    fun icon(id: String): String? {
        val f = File(ctx.cacheDir, "icons/$id.png")
        if (f.exists()) return "data:image/png;base64," + android.util.Base64.encodeToString(f.readBytes(), android.util.Base64.NO_WRAP)
        return runCatching {
            val bmp = ctx.packageManager.getApplicationIcon(id).bitmap(64)
            f.parentFile?.mkdirs(); f.outputStream().use { bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            bmp.dataUrl(android.graphics.Bitmap.CompressFormat.PNG)
        }.getOrNull()
    }

    fun launch(id: String): JSONObject {
        val i = ctx.packageManager.getLaunchIntentForPackage(id) ?: return fail("no launchable app: $id")
        ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return ok()
    }

    /** files by name through MediaStore (needs media access); an empty list when it is not granted */
    fun searchFiles(q: String, limit: Int): JSONArray {
        if (q.isBlank() || !(Perms.granted("media") || Build.VERSION.SDK_INT >= 33 && Perms.has(android.Manifest.permission.READ_MEDIA_IMAGES))) return JSONArray()
        val out = ArrayList<JSONObject>()
        val col = MediaStore.Files.getContentUri("external")
        ctx.contentResolver.query(col, arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.DISPLAY_NAME), "${MediaStore.Files.FileColumns.DISPLAY_NAME} LIKE ?", arrayOf("%$q%"), "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC")?.use { c ->
            while (c.moveToNext() && out.size < limit) out += obj("name" to c.getString(1), "path" to ContentUris.withAppendedId(col, c.getLong(0)).toString())
        }
        return arr(out)
    }
}

object Wallpaper {
    fun images(folder: String, limit: Int): JSONArray {
        if (!Perms.granted("media")) return JSONArray()
        val out = ArrayList<JSONObject>()
        val col = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val sel = if (folder.isBlank()) null else "${MediaStore.Images.Media.RELATIVE_PATH} LIKE ?"
        val args = if (folder.isBlank()) null else arrayOf("%${folder.trim('/')}%")
        ctx.contentResolver.query(col, arrayOf(MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME), sel, args, "${MediaStore.Images.Media.DATE_ADDED} DESC")?.use { c ->
            while (c.moveToNext() && out.size < limit) { val u = ContentUris.withAppendedId(col, c.getLong(0)).toString(); out += obj("path" to u, "name" to c.getString(1), "thumb" to null) }
        }
        return arr(out)
    }

    private fun decode(path: String, max: Int): android.graphics.Bitmap? {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        fun open() = if (path.startsWith("content:")) ctx.contentResolver.openInputStream(Uri.parse(path)) else File(path).inputStream()
        open()?.use { BitmapFactory.decodeStream(it, null, opts) }
        var s = 1; while (opts.outWidth / (s * 2) >= max && opts.outHeight / (s * 2) >= max) s *= 2
        return open()?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = s }) }
    }

    fun thumb(path: String, size: Int): String? = runCatching { decode(path, size)?.fit(size)?.dataUrl(q = 70) }.getOrNull()

    fun set(path: String): JSONObject {
        val b = decode(path, 2400) ?: return fail("cannot read that image")
        WallpaperManager.getInstance(ctx).setBitmap(b)
        Events.emit("wallpaper.changed", obj("path" to path))
        return ok()
    }
}

/** 32 log-spaced bands from Visualizer (output mix). Falls back to a synthetic animation tied to media playback, and says which one is in use. */
object Viz {
    private var viz: android.media.audiofx.Visualizer? = null
    private var thread: Thread? = null
    @Volatile private var run = false

    @Synchronized fun set(on: Boolean): JSONObject {
        run = false; thread?.interrupt(); thread = null
        runCatching { viz?.enabled = false; viz?.release() }; viz = null
        if (!on) return ok()
        var mode = "synthetic"
        if (Perms.granted("mic")) runCatching {
            viz = android.media.audiofx.Visualizer(0).also { it.captureSize = android.media.audiofx.Visualizer.getCaptureSizeRange()[1].coerceAtMost(1024); it.enabled = true }
            mode = "fft"
        }
        run = true
        val v = viz
        thread = Thread({ loop(v) }, "lokey-viz").also { it.isDaemon = true; it.start() }
        return ok("mode" to mode)
    }

    private fun loop(v: android.media.audiofx.Visualizer?) {
        val bands = DoubleArray(32); var t = 0.0
        val fft = ByteArray(v?.captureSize ?: 0)
        while (run) {
            try { Thread.sleep(33) } catch (_: InterruptedException) { return }
            t += 0.033
            var real = false
            if (v != null && v.getFft(fft) == android.media.audiofx.Visualizer.SUCCESS) {
                val n = fft.size / 2
                for (b in 0 until 32) {
                    val lo = Math.pow(n.toDouble(), b / 32.0).toInt().coerceIn(1, n - 1); val hi = Math.pow(n.toDouble(), (b + 1) / 32.0).toInt().coerceIn(lo + 1, n)
                    var m = 0.0
                    for (k in lo until hi) { val re = fft[2 * k].toDouble(); val im = fft[2 * k + 1].toDouble(); m = maxOf(m, Math.hypot(re, im)) }
                    val x = (Math.log10(1 + m) / Math.log10(182.0)).coerceIn(0.0, 1.0)
                    if (x > 0.0) real = true
                    bands[b] = maxOf(x, bands[b] * 0.8)
                }
            }
            if (!real) {
                val playing = MediaApi.playing()
                for (b in 0 until 32) {
                    val target = if (playing) 0.25 + 0.45 * Math.abs(Math.sin(t * (1.5 + b * 0.13) + b)) * (1.0 - b / 48.0) else 0.0
                    bands[b] += (target - bands[b]) * 0.25
                }
            }
            Events.emit("audio.bands", obj("bands" to arr(bands.map { Math.round(it * 1000) / 1000.0 })))
        }
    }
}
