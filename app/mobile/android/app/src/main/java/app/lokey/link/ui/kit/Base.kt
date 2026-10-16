package app.lokey.link.ui.kit

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.ripple
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkMotion
import app.lokey.link.ui.theme.LkShapes
import app.lokey.link.ui.theme.LocalReducedMotion
import app.lokey.link.ui.theme.LokeyTheme

/** Scale down while pressed (icon buttons .92). No-op under reduced motion. */
@Composable
fun Modifier.lkPress(source: MutableInteractionSource, scale: Float): Modifier {
    val reduced = LocalReducedMotion.current
    val pressed by source.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed && !reduced) scale else 1f, LkMotion.spring(reduced), label = "press")
    return graphicsLayer { scaleX = s; scaleY = s }
}

/** Clip + ripple click with a role; the ripple is the only touch feedback besides [press]. */
@Composable
fun Modifier.lkClickable(
    onClick: () -> Unit,
    shape: Shape = LkShapes.Row,
    enabled: Boolean = true,
    role: Role = Role.Button,
    press: Float = 1f,
    onClickLabel: String? = null,
): Modifier {
    val src = remember { MutableInteractionSource() }
    return this.lkPress(src, press).clip(shape)
        .clickable(src, ripple(color = Lk.colors.text), enabled, onClickLabel, role, onClick)
}

/** The 10 px uppercase tracked label (`.label`). */
@Composable
fun LkLabel(text: String, modifier: Modifier = Modifier, color: Color = Lk.colors.dim) {
    Text(text.uppercase(), modifier, color = color, style = Lk.type.label)
}

@Composable
fun LkDivider(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().height(1.dp).background(Lk.colors.line))
}

@Composable
fun LkIcon(icon: ImageVector, contentDescription: String?, modifier: Modifier = Modifier, tint: Color = Lk.colors.text, size: Int = 22) {
    Icon(icon, contentDescription, modifier.size(size.dp), tint)
}

/** Own 24 dp stroke icons (Lucide-style geometry, the desktop uses lucide); no icon library. */
object LkIcons {
    private fun stroke(name: String, vararg paths: String): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            for (p in paths) addPath(
                addPathNodes(p), fill = null, stroke = SolidColor(Color.Black), strokeLineWidth = 1.75f,
                strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
            )
        }.build()

    val Home = stroke("Home", "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z")
    val Inbox = stroke("Inbox", "M22 12h-6l-2 3h-4l-2-3H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z")
    val Today = stroke("Today", "M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z")
    val Pc = stroke("Pc", "M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", "M8 21h8", "M12 17v4")
    val You = stroke("You", "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21a8 8 0 0 1 16 0")
    val Chevron = stroke("Chevron", "m9 6 6 6-6 6")
    val Check = stroke("Check", "m5 12 5 5L20 7")
    val Close = stroke("Close", "M6 6l12 12", "M18 6 6 18")
    val Mic = stroke("Mic", "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z", "M5 11a7 7 0 0 0 14 0", "M12 18v3")
    val Bell = stroke("Bell", "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0")
    val Back = stroke("Back", "m15 18-6-6 6-6")
    val Down = stroke("Down", "m6 9 6 6 6-6")
    val Plus = stroke("Plus", "M12 5v14", "M5 12h14")
    val Search = stroke("Search", "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "m21 21-4.3-4.3")
    val Send = stroke("Send", "m22 2-7 20-4-9-9-4z", "M22 2 11 13")
    val Phone = stroke("Phone", "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z")
    val Chat = stroke("Chat", "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z")
    val Pin = stroke("Pin", "M12 17v5", "M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z")
    val Trash = stroke("Trash", "M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2")
    val Play = stroke("Play", "M6 4v16l14-8z")
    val Pause = stroke("Pause", "M6 4h4v16H6z", "M14 4h4v16h-4z")
    val Next = stroke("Next", "M5 4l10 8-10 8z", "M19 5v14")
    val Prev = stroke("Prev", "M19 20 9 12l10-8z", "M5 19V5")
    val Stop = stroke("Stop", "M6 6h12v12H6z")
    val Torch = stroke("Torch", "M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z", "M6 6h12", "M12 12v2")
    val Volume = stroke("Volume", "M11 5 6 9H2v6h4l5 4z", "M15.5 8.5a5 5 0 0 1 0 7", "M19 5a10 10 0 0 1 0 14")
    val Timer = stroke("Timer", "M10 2h4", "M12 14l3-3", "M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z")
    val Place = stroke("Place", "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z", "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z")
    val Camera = stroke("Camera", "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z", "M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z")
    val Eye = stroke("Eye", "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z")
    val Refresh = stroke("Refresh", "M3 12a9 9 0 0 1 15-6.7L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-15 6.7L3 16", "M3 21v-5h5")
    val Sparkle = stroke("Sparkle", "m12 3-1.9 5.8L4 10l6.1 1.2L12 17l1.9-5.8L20 10l-6.1-1.2z")
    val Link = stroke("Link", "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7")
    val Shield = stroke("Shield", "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z")
    val Key = stroke("Key", "M7.5 20a4.5 4.5 0 1 1 3.8-6.9L21 3.5", "m17 7 3 3")
    val Bolt = stroke("Bolt", "M13 2 3 14h9l-1 8 10-12h-9z")
    val Info = stroke("Info", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M12 16v-4", "M12 8h.01")
    val Smartphone = stroke("Smartphone", "M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M12 18h.01")
    val Chip = stroke("Chip", "M6 6h12v12H6z", "M9 9h6v6H9z", "M9 2v4", "M15 2v4", "M9 18v4", "M15 18v4", "M2 9h4", "M2 15h4", "M18 9h4", "M18 15h4")
    val Wave = stroke("Wave", "M2 12h3l3-8 4 16 4-12 2 4h4")
    val Island = stroke("Island", "M4 5h16a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M6 15h12", "M9 19h6")
    val Reply = stroke("Reply", "m9 17-5-5 5-5", "M20 18v-2a4 4 0 0 0-4-4H4")
    val Sliders = stroke("Sliders", "M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M1 14h6", "M9 8h6", "M17 16h6")
    val Calendar = Today
}

/** Dark and light stacked, for @Preview. */
@Composable
fun LkBoth(content: @Composable () -> Unit) {
    Column {
        for (dark in listOf(true, false)) LokeyTheme(dark = dark) {
            Box(Modifier.background(Lk.colors.bg).padding(16.dp)) { content() }
        }
    }
}
