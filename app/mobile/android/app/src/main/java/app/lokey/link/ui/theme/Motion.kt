package app.lokey.link.ui.theme

import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalContext

/** True when the user turned system animations off; every spec below collapses to a snap. */
val LocalReducedMotion = staticCompositionLocalOf { false }

@Composable
fun rememberReducedMotion(): Boolean {
    val cr = LocalContext.current.contentResolver
    return try { Settings.Global.getFloat(cr, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f } catch (_: Exception) { false }
}

object LkMotion {
    const val EnterMs = 280
    const val PressScale = 0.92f
    /** `cubic-bezier(.34,.8,.34,1)`, the lk-in curve */
    val EaseOut = CubicBezierEasing(0.34f, 0.8f, 0.34f, 1f)

    fun <T> enter(reduced: Boolean): FiniteAnimationSpec<T> = if (reduced) snap() else tween(EnterMs, easing = EaseOut)
    fun <T> spring(reduced: Boolean): FiniteAnimationSpec<T> =
        if (reduced) snap() else spring(dampingRatio = 0.78f, stiffness = Spring.StiffnessMediumLow)
}
