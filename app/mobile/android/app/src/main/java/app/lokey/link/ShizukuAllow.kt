package app.lokey.link

/**
 * What the Shizuku tier may run, in one pure-Kotlin place (no Android classes: unit tested on the JVM).
 *
 * `check` turns one command line into an argv (never a shell string: no `sh -c`, so no metacharacter can do anything) or an error.
 * It runs twice: in the plugin before the call and again inside the shell-privileged user service, which is the one that counts.
 * `denyPackage` is the hard "never operate this app" list for the second screen; src/mobile/secondScreenSafety.ts holds the same patterns
 * (keep the two in step; both have a test).
 */
object ShizukuAllow {
    class Verdict(val argv: List<String>?, val error: String?)

    private val TOKEN = Regex("^[A-Za-z0-9_.:=/@,+\\-]+$")
    private val PKG = Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")
    private val PERM = Regex("^android\\.permission\\.[A-Z][A-Z0-9_]+$")

    private val SETTINGS_PUT = mapOf(
        "system" to setOf("screen_brightness", "screen_brightness_mode", "screen_off_timeout", "accelerometer_rotation", "user_rotation", "haptic_feedback_enabled", "sound_effects_enabled"),
        "secure" to setOf("location_mode", "long_press_timeout", "show_ime_with_hard_keyboard"),
        "global" to setOf("mobile_data", "wifi_on", "bluetooth_on", "data_roaming", "stay_on_while_plugged_in", "animator_duration_scale", "transition_animation_scale", "window_animation_scale", "zen_mode"),
    )
    private val SETTINGS_KEY = Regex("^[a-z][a-z0-9_]{2,60}$")
    /** runtime permissions another app may be granted / refused here (the page asks the user first) */
    private val OTHER_PERMS = setOf("CAMERA", "RECORD_AUDIO", "READ_CONTACTS", "WRITE_CONTACTS", "READ_CALENDAR", "WRITE_CALENDAR", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "ACCESS_BACKGROUND_LOCATION",
        "POST_NOTIFICATIONS", "READ_MEDIA_IMAGES", "READ_MEDIA_VIDEO", "READ_MEDIA_AUDIO", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "READ_PHONE_STATE", "BLUETOOTH_CONNECT", "BLUETOOTH_SCAN", "NEARBY_WIFI_DEVICES")
    /** extra permissions Lokey's own package may be granted (the ones that replace a manual Settings trip) */
    private val OWN_PERMS = OTHER_PERMS + setOf("WRITE_SECURE_SETTINGS", "READ_LOGS", "DUMP", "PACKAGE_USAGE_STATS", "SYSTEM_ALERT_WINDOW", "WRITE_SETTINGS", "READ_SMS", "SEND_SMS", "READ_CALL_LOG")
    private val NEVER_STOP = setOf("android", "com.android.systemui", "com.android.phone", "com.android.shell", "com.android.settings", "moe.shizuku.privileged.api", "com.google.android.gms", "com.android.providers.settings")

    fun check(command: String, ownPkg: String): Verdict {
        val argv = command.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (argv.isEmpty()) return no("empty command")
        if (argv.size > 12) return no("too many words")
        argv.firstOrNull { !TOKEN.matches(it) }?.let { return no("not allowed in a command: $it") }
        val a = argv
        fun ok() = Verdict(a, null)
        return when (a[0]) {
            "settings" -> when {
                a.size == 4 && a[1] == "get" && a[2] in SETTINGS_PUT && SETTINGS_KEY.matches(a[3]) -> ok()
                a.size == 5 && a[1] == "put" && SETTINGS_PUT[a[2]]?.contains(a[3]) == true && Regex("^-?[0-9]{1,10}(\\.[0-9]+)?$").matches(a[4]) -> ok()
                else -> no("settings: only get <system|secure|global> <key>, or put one of the allowed keys with a number")
            }
            "svc" -> if (a.size == 3 && ((a[1] in setOf("data", "wifi", "bluetooth") && a[2] in setOf("enable", "disable")))) ok() else no("svc: data|wifi|bluetooth enable|disable only")
            "cmd" -> when {
                a.size == 4 && a[1] == "location" && a[2] == "set-location-enabled" && a[3] in setOf("true", "false") -> ok()
                a.size >= 3 && a[1] == "package" && a[2] in setOf("list", "resolve-activity", "path") -> if (a.drop(3).all { it.startsWith("-") || PKG.matches(it) || it == "packages" || it == "android.intent.category.LAUNCHER" }) ok() else no("cmd package: bad argument")
                else -> no("cmd: only package list|resolve-activity|path and location set-location-enabled")
            }
            "pm" -> when {
                a.size >= 3 && a[1] == "list" && a[2] == "packages" -> ok()
                a.size == 3 && a[1] == "path" && PKG.matches(a[2]) -> ok()
                a.size == 4 && (a[1] == "grant" || a[1] == "revoke") && PKG.matches(a[2]) && PERM.matches(a[3]) -> {
                    val p = a[3].removePrefix("android.permission.")
                    if (p in (if (a[2] == ownPkg) OWN_PERMS else OTHER_PERMS)) ok() else no("pm: that permission may not be changed for ${a[2]}")
                }
                else -> no("pm: only list packages, path, grant, revoke")
            }
            "am" -> if (a.size == 3 && a[1] == "force-stop" && PKG.matches(a[2])) {
                if (a[2] in NEVER_STOP || a[2] == ownPkg) no("am force-stop: not that package") else ok()
            } else no("am: only force-stop <package>")
            "wm" -> when {
                a.size == 2 && (a[1] == "size" || a[1] == "density") -> ok()
                a.size == 3 && a[1] in setOf("size", "density") && a[2] == "reset" -> ok()
                a.size == 3 && a[1] == "size" && Regex("^[0-9]{3,4}x[0-9]{3,4}$").matches(a[2]) -> ok()
                a.size == 3 && a[1] == "density" && a[2].toIntOrNull()?.let { it in 120..800 } == true -> ok()
                else -> no("wm: size|density [reset|value]")
            }
            else -> no("${a[0]} is not on the allow-list")
        }
    }

    private fun no(why: String) = Verdict(null, why)

    // ---- the second screen: apps that are never operated ------------------------------------------------------------------
    private val DENY = Regex(
        "bank|banking|wallet|payment|(^|[._])pay([._]|$)|paytm|phonepe|gpay|paisa|upi|bhim|razorpay|paypal|venmo|cashapp|revolut|stripe|zelle|spay|" +
            "coinbase|binance|wazirx|metamask|crypto|zerodha|groww|upstox|" +
            "password|passkey|bitwarden|lastpass|1password|onepassword|dashlane|keepass|keeper|nordpass|enpass|roboform|proton\\.android\\.pass|" +
            "authenticator|authy|twofas|aegis|andotp|duomobile|okta|totp|otp|2fa|" +
            "vivo\\.wallet|bbk\\.account|digilocker|credit|debit|insurance|loan|cred\\.club|" +
            "sbi|hdfc|icici|kotak|yono|idfc|pnb|canara|indusind|hsbc|amex|mastercard|chase|wellsfargo|barclays|monzo|n26|nubank",
        RegexOption.IGNORE_CASE,
    )

    fun denyPackage(pkg: String): Boolean = DENY.containsMatchIn(pkg)
}
