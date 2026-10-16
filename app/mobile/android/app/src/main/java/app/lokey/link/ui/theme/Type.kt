package app.lokey.link.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.lokey.link.R

@OptIn(ExperimentalTextApi::class)
private fun variable(res: Int, vararg weights: Int) =
    FontFamily(weights.map { Font(res, FontWeight(it), variationSettings = FontVariation.Settings(FontVariation.weight(it))) })

val Inter = variable(R.font.inter, 400, 500, 600, 650, 700)
val Rubik = variable(R.font.rubik, 400, 500, 600)
val JetBrainsMono = variable(R.font.jetbrains_mono, 400, 500)

private const val UI_FEATURES = "cv11, ss03"

/** Text styles. Colour is left unset: components pick it from [LkColors]. */
@Immutable
class LkType(
    val pageTitle: TextStyle, val title: TextStyle, val rowTitle: TextStyle, val body: TextStyle, val caption: TextStyle,
    val button: TextStyle, val label: TextStyle, val num: TextStyle, val numSmall: TextStyle, val island: TextStyle,
)

val lkType = LkType(
    pageTitle = TextStyle(fontFamily = Inter, fontSize = 28.sp, fontWeight = FontWeight(650), letterSpacing = (-0.01).em, fontFeatureSettings = UI_FEATURES),
    title = TextStyle(fontFamily = Inter, fontSize = 22.sp, fontWeight = FontWeight(650), fontFeatureSettings = UI_FEATURES),
    rowTitle = TextStyle(fontFamily = Inter, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, lineHeight = 20.sp, fontFeatureSettings = UI_FEATURES),
    body = TextStyle(fontFamily = Inter, fontSize = 14.sp, fontWeight = FontWeight.Normal, lineHeight = 20.sp, fontFeatureSettings = UI_FEATURES),
    caption = TextStyle(fontFamily = Inter, fontSize = 12.sp, fontWeight = FontWeight.Normal, lineHeight = 16.sp, fontFeatureSettings = UI_FEATURES),
    button = TextStyle(fontFamily = Inter, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, fontFeatureSettings = UI_FEATURES),
    // .label: 10 px, 0.08em, uppercase (apply .uppercase() at the call site), 600
    label = TextStyle(fontFamily = Inter, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.08.em, fontFeatureSettings = UI_FEATURES),
    // .num: mono, tabular, -0.02em
    num = TextStyle(fontFamily = JetBrainsMono, fontSize = 28.sp, fontWeight = FontWeight.Medium, letterSpacing = (-0.02).em, fontFeatureSettings = "tnum"),
    numSmall = TextStyle(fontFamily = JetBrainsMono, fontSize = 12.sp, fontWeight = FontWeight.Normal, letterSpacing = (-0.02).em, fontFeatureSettings = "tnum"),
    island = TextStyle(fontFamily = Rubik, fontSize = 13.sp, fontWeight = FontWeight.Medium),
)
