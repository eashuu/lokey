package app.lokey.link

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The shell allow-list and the second-screen deny-list (src/mobile/secondScreenSafety.ts keeps the same package patterns). */
class ShizukuAllowTest {
    private val me = "app.lokey.link"
    private fun ok(c: String) = assertNotNull("should pass: $c", ShizukuAllow.check(c, me).argv)
    private fun no(c: String) = assertNull("should be refused: $c", ShizukuAllow.check(c, me).argv)

    @Test fun allowed() {
        ok("settings get global mobile_data"); ok("settings put system screen_brightness 120"); ok("settings put global mobile_data 1")
        ok("svc data disable"); ok("svc wifi enable"); ok("cmd location set-location-enabled true"); ok("cmd package list packages -3")
        ok("cmd package resolve-activity --brief -c android.intent.category.LAUNCHER com.android.settings"); ok("pm grant app.lokey.link android.permission.WRITE_SECURE_SETTINGS")
        ok("pm grant com.example.app android.permission.CAMERA"); ok("am force-stop com.example.app"); ok("wm size 1080x2400"); ok("wm size reset"); ok("wm density 420")
    }

    @Test fun refused() {
        no(""); no("rm -rf /sdcard"); no("sh -c id"); no("settings put global mobile_data 1; reboot"); no("settings put secure enabled_accessibility_services x"); no("settings put global airplane_mode_on 1")
        no("pm install /sdcard/a.apk"); no("pm uninstall com.example.app"); no("pm grant com.example.app android.permission.WRITE_SECURE_SETTINGS"); no("pm grant app.lokey.link android.permission.INSTALL_PACKAGES")
        no("am force-stop com.android.systemui"); no("am force-stop app.lokey.link"); no("am start -n a/b"); no("am broadcast -a x"); no("cmd package install x"); no("wm size 10x10"); no("wm density 5")
        no("svc power shutdown"); no("input tap 1 1"); no("settings get global \$(id)"); no("settings put system screen_brightness 1|2")
    }

    @Test fun verdictCarriesAnArgvNotAString() {
        assertEquals(listOf("svc", "data", "enable"), ShizukuAllow.check("  svc   data enable ", me).argv)
        assertTrue(ShizukuAllow.check("reboot", me).error!!.contains("allow-list"))
    }

    @Test fun denyList() {
        for (p in listOf("com.sbi.SBIFreedomPlus", "net.one97.paytm", "com.phonepe.app", "com.google.android.apps.nbu.paisa.user", "com.google.android.apps.walletnfcrel", "com.bitwarden.mobile", "com.x8bit.bitwarden",
            "com.google.android.apps.authenticator2", "com.microsoft.authenticator", "com.agilebits.onepassword", "com.coinbase.android", "com.vivo.wallet", "com.authy.authy", "com.paypal.android.p2pmobile", "org.keepassdroid"))
            assertTrue("deny $p", ShizukuAllow.denyPackage(p))
        for (p in listOf("com.android.settings", "com.google.android.youtube", "com.whatsapp", "com.android.chrome", "com.google.android.apps.maps", "com.google.android.calendar", "org.telegram.messenger", "com.spotify.music"))
            assertFalse("allow $p", ShizukuAllow.denyPackage(p))
    }
}
