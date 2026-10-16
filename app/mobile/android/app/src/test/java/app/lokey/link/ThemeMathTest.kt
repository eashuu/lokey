package app.lokey.link

import androidx.compose.ui.graphics.Color
import app.lokey.link.ui.theme.LkDefaults
import app.lokey.link.ui.theme.accentSoftOf
import app.lokey.link.ui.theme.lkDarkColors
import app.lokey.link.ui.theme.lkLightColors
import app.lokey.link.ui.theme.readableInk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ThemeMathTest {
    @Test fun inkFollowsAccentBrightness() {
        assertEquals(LkDefaults.AccentInk, readableInk(LkDefaults.Accent))
        assertEquals(Color(0xFF16130A), readableInk(Color(0xFFA3C97D)))
        assertEquals(Color(0xFFF7F5EE), readableInk(Color(0xFF1E3A8A)))
    }

    @Test fun accentSoftIsSixteenPercent() {
        assertEquals(0.16f, accentSoftOf(LkDefaults.Accent).alpha, 0.001f)
        assertEquals(LkDefaults.Accent.red, accentSoftOf(LkDefaults.Accent).red, 0.001f)
    }

    @Test fun themesCarryTokensAndAccent() {
        val violet = Color(0xFFD3A6ED)
        val d = lkDarkColors(violet); val l = lkLightColors(violet)
        assertEquals(violet, d.accent); assertEquals(violet, l.accent)
        assertEquals(accentSoftOf(violet), d.accentSoft)
        assertEquals(Color(0xFF0B0B0C), d.bg); assertEquals(Color(0xFFFBFAF6), l.bg)
        assertEquals(d.panel, l.panel)
        assertNotEquals(d.fill1, l.fill1)
    }
}
