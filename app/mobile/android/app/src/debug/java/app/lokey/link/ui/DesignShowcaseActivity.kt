package app.lokey.link.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import app.lokey.link.core.FakeCore
import app.lokey.link.ui.app.LokeyApp
import app.lokey.link.ui.kit.LkChip
import app.lokey.link.ui.kit.LkGallery
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkDefaults
import app.lokey.link.ui.theme.LokeyTheme

/** Debug-only design review screen: the whole kit in dark then light, with an accent switcher. Not the launcher. */
class DesignShowcaseActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val accents = listOf("Gold" to LkDefaults.Accent, "Violet" to Color(0xFFD3A6ED), "Green" to Color(0xFFA3C97D), "Blue" to Color(0xFF6CA8FF))
        setContent {
            var pick by remember { mutableIntStateOf(0) }
            var screens by remember { mutableStateOf(false) }
            val accent = accents[pick].second
            if (screens) { // the app shell on sample data (FakeCore): Home, Today, PC...
                LokeyTheme(dark = true, accent = accent) { Column { Row(Modifier.background(Lk.colors.bg).safeDrawingPadding()) { LkChip("Kit", false, { screens = false }) }; LokeyApp(remember { FakeCore() }) } }
                return@setContent
            }
            Column(Modifier.verticalScroll(rememberScrollState())) {
                LokeyTheme(dark = true, accent = accent) {
                    Row(Modifier.background(Lk.colors.bg).safeDrawingPadding().padding(horizontal = 12.dp)) {
                        accents.forEachIndexed { i, (n, _) -> LkChip(n, pick == i, { pick = i }) }
                        LkChip("Screens", false, { screens = true })
                    }
                    LkGallery()
                }
                LokeyTheme(dark = false, accent = accent) { LkGallery() }
            }
        }
    }
}
