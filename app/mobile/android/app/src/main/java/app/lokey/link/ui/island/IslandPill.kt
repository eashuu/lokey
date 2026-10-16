package app.lokey.link.ui.island

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.lokey.link.ui.kit.LkBoth
import app.lokey.link.ui.theme.Lk

/** Design-preview stand-in for the island capsule (the real one is Island.kt / IslandView.kt). Black panel, white content. */
@Composable
fun IslandPill(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier.heightIn(min = 36.dp).clip(CircleShape).background(Lk.colors.panel).border(1.dp, Lk.colors.glassStroke, CircleShape).padding(horizontal = 14.dp),
        Arrangement.spacedBy(8.dp), Alignment.CenterVertically, content,
    )
}

@Preview(widthDp = 360) @Composable
private fun IslandPillPreview() = LkBoth {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        IslandPill { Box(Modifier.size(8.dp).background(Color(0xFF8ED92F), CircleShape)); Text("Charging 84%", color = Color.White, style = Lk.type.island) }
        IslandPill { Text("12:48", color = Color.White, style = Lk.type.numSmall) }
    }
}
