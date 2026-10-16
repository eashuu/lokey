package app.lokey.link.ui.theme

import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

object LkShapes {
    val Card = RoundedCornerShape(20.dp)
    val Row = RoundedCornerShape(10.dp)
    val Field = RoundedCornerShape(12.dp)
    /** expanded island cards */
    val Panel = RoundedCornerShape(28.dp)
    val Sheet = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
    val Pill = CircleShape
}
