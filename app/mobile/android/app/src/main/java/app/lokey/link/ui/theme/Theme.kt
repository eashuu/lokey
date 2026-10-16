package app.lokey.link.ui.theme

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

private val LocalColors = staticCompositionLocalOf { lkDarkColors() }
private val LocalType = staticCompositionLocalOf { lkType }

/** Read the design tokens: `Lk.colors.accent`, `Lk.type.body`. */
object Lk {
    val colors: LkColors @Composable @ReadOnlyComposable get() = LocalColors.current
    val type: LkType @Composable @ReadOnlyComposable get() = LocalType.current
}

@Composable
fun LokeyTheme(dark: Boolean = isSystemInDarkTheme(), accent: Color = LkDefaults.Accent, reduceMotion: Boolean = false, content: @Composable () -> Unit) {
    val reduced = rememberReducedMotion() || reduceMotion
    val spec = LkMotion.enter<Color>(reduced)
    val a by animateColorAsState(accent, spec, label = "accent")
    val ink by animateColorAsState(readableInk(accent), spec, label = "accentInk")
    val c = if (dark) lkDarkColors(a, ink) else lkLightColors(a, ink)

    // Material3 is only the base for ripple/semantics; every slot is overridden with Lokey values.
    val base = lkType.body
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = c.accent, onPrimary = c.accentInk, primaryContainer = c.accentSoft, onPrimaryContainer = c.accent,
        secondary = c.accent, onSecondary = c.accentInk, secondaryContainer = c.s3, onSecondaryContainer = c.text,
        tertiary = c.accent, onTertiary = c.accentInk, tertiaryContainer = c.s3, onTertiaryContainer = c.text,
        background = c.bg, onBackground = c.text, surface = c.s1, onSurface = c.text,
        surfaceVariant = c.s2, onSurfaceVariant = c.muted, surfaceTint = Color.Transparent,
        inverseSurface = c.text, inverseOnSurface = c.bg, inversePrimary = c.accent,
        outline = c.dim, outlineVariant = c.line, scrim = Color.Black,
        surfaceBright = c.s2, surfaceDim = c.bg, surfaceContainerLowest = c.bg, surfaceContainerLow = c.s1,
        surfaceContainer = c.s1, surfaceContainerHigh = c.s2, surfaceContainerHighest = c.s3,
        error = c.bad, onError = c.bg, errorContainer = c.s2, onErrorContainer = c.bad,
    )
    val typography = Typography(
        displayLarge = base, displayMedium = base, displaySmall = base,
        headlineLarge = lkType.pageTitle, headlineMedium = lkType.title, headlineSmall = lkType.title,
        titleLarge = lkType.title, titleMedium = lkType.rowTitle, titleSmall = lkType.rowTitle,
        bodyLarge = base, bodyMedium = base, bodySmall = lkType.caption,
        labelLarge = lkType.button, labelMedium = lkType.caption, labelSmall = lkType.label,
    )
    val shapes = Shapes(extraSmall = LkShapes.Row, small = LkShapes.Row, medium = LkShapes.Field, large = LkShapes.Card, extraLarge = LkShapes.Panel)

    CompositionLocalProvider(LocalColors provides c, LocalType provides lkType, LocalReducedMotion provides reduced) {
        MaterialTheme(colorScheme = scheme, typography = typography, shapes = shapes, content = content)
    }
}
