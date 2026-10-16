package app.lokey.link.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

/** Colour roles ported 1:1 from app/src/renderer/src/design/tokens.css (dark = :root, light = [data-theme=light]). */
@Immutable
class LkColors(
    val dark: Boolean,
    val bg: Color, val s1: Color, val s2: Color, val s3: Color,
    val line: Color, val text: Color, val muted: Color, val dim: Color, val soft: Color,
    val accent: Color, val accentInk: Color, val accentSoft: Color,
    val ok: Color, val warn: Color, val bad: Color,
    val panel: Color, val glassStroke: Color,
    val fill0: Color, val fill1: Color, val fill2: Color, val fill3: Color, val fill4: Color,
) {
    /** the overlay ink: white on dark, black on light (`--ov`) */
    val ov: Color get() = if (dark) Color.White else Color.Black
    /** the accent as text or an icon on the page: on light it is darkened, gold on cream is under 2:1 */
    val accentText: Color get() = if (dark) accent else androidx.compose.ui.graphics.lerp(accent, Color.Black, 0.5f)
}

object LkDefaults {
    val Accent = Color(0xFFD9B556)
    val AccentInk = Color(0xFF1B1405)
    /** island black, same in both themes */
    val Panel = Color(0xFF07090D)
}

/** accent-soft is the accent at 16 % (`rgba(217,181,86,.16)`) */
fun accentSoftOf(accent: Color): Color = accent.copy(alpha = 0.16f)

/** Dark ink on light accents, near-white ink on dark ones; the default gold keeps its hand-picked ink. */
fun readableInk(accent: Color): Color = when {
    accent == LkDefaults.Accent -> LkDefaults.AccentInk
    accent.luminance() > 0.34f -> Color(0xFF16130A)
    else -> Color(0xFFF7F5EE)
}

fun lkDarkColors(accent: Color = LkDefaults.Accent, ink: Color = readableInk(accent)) = LkColors(
    dark = true,
    bg = Color(0xFF0B0B0C), s1 = Color(0xFF141416), s2 = Color(0xFF1C1C1F), s3 = Color(0xFF26262A),
    line = Color(0x13FFFFFF), text = Color(0xFFF4F5F8), muted = Color(0xFF8A92A3), dim = Color(0xFF6C6C74), soft = Color(0xFFA3AAB8),
    accent = accent, accentInk = ink, accentSoft = accentSoftOf(accent),
    ok = Color(0xFF8FD16A), warn = Color(0xFFF4A46A), bad = Color(0xFFFF7373),
    panel = LkDefaults.Panel, glassStroke = Color(0x1AFFFFFF),
    fill0 = Color(0x0CFFFFFF), fill1 = Color(0x10FFFFFF), fill2 = Color(0x16FFFFFF), fill3 = Color(0x1AFFFFFF), fill4 = Color(0x1EFFFFFF),
)

fun lkLightColors(accent: Color = LkDefaults.Accent, ink: Color = readableInk(accent)) = LkColors(
    dark = false,
    bg = Color(0xFFFBFAF6), s1 = Color(0xFFF1EFE8), s2 = Color(0xFFE8E5DC), s3 = Color(0xFFDCD8CC),
    line = Color(0x17000000), text = Color(0xFF17171A), muted = Color(0xFF5B5B63), dim = Color(0xFF8B8B93), soft = Color(0xFF44444C),
    accent = accent, accentInk = ink, accentSoft = accentSoftOf(accent),
    ok = Color(0xFF2F8F3A), warn = Color(0xFFB5601C), bad = Color(0xFFC6322F),
    panel = LkDefaults.Panel, glassStroke = Color(0x17000000),
    fill0 = Color(0x09000000), fill1 = Color(0x0D000000), fill2 = Color(0x12000000), fill3 = Color(0x17000000), fill4 = Color(0x1C000000),
)
