package app.lokey.link.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicText
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkShapes
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip

/** `.card`: fill-1 on the page, 20 dp, no border, no shadow. */
@Composable
fun LkCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    right: (@Composable () -> Unit)? = null,
    padding: Dp = 16.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth().clip(LkShapes.Card).background(Lk.colors.fill1).padding(padding), Arrangement.spacedBy(12.dp)) {
        if (title != null || right != null) Row(Modifier.fillMaxWidth().heightIn(min = 24.dp), verticalAlignment = Alignment.CenterVertically) {
            if (title != null) Text(title, Modifier.weight(1f), color = Lk.colors.muted, style = Lk.type.caption.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold))
            right?.invoke()
        }
        content()
    }
}

/** A small label over a card that holds rows. */
@Composable
fun LkSection(label: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth()) {
        LkLabel(label, Modifier.padding(start = 4.dp, bottom = 8.dp))
        LkCard(padding = 4.dp) { Column { content() } }
    }
}

/** The 36 dp accent-soft icon disc used by rows and list items. */
@Composable
fun LkIconDisc(icon: ImageVector, modifier: Modifier = Modifier) {
    Box(modifier.size(36.dp).clip(CircleShape).background(Lk.colors.accentSoft), Alignment.Center) {
        LkIcon(icon, null, tint = Lk.colors.accentText, size = 20)
    }
}

/** Settings-style row. Trailing is one of: chevron, value text, switch. */
@Composable
fun LkRow(
    title: String,
    modifier: Modifier = Modifier,
    sub: String? = null,
    icon: ImageVector? = null,
    value: String? = null,
    chevron: Boolean = false,
    checked: Boolean? = null,
    onCheckedChange: ((Boolean) -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    val shape = LkShapes.Row
    val base = modifier.fillMaxWidth().heightIn(min = 60.dp)
    val tap = when {
        checked != null && onCheckedChange != null ->
            base.clip(shape).toggleable(checked, role = Role.Switch, onValueChange = onCheckedChange)
        onClick != null -> base.lkClickable(onClick, shape)
        else -> base
    }
    Row(tap.padding(start = 12.dp, end = 12.dp), Arrangement.spacedBy(14.dp), Alignment.CenterVertically) {
        if (icon != null) LkIconDisc(icon)
        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
            Text(title, color = Lk.colors.text, style = Lk.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub != null) Text(sub, color = Lk.colors.muted, style = Lk.type.caption, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (value != null) Text(value, color = Lk.colors.muted, style = Lk.type.body, maxLines = 1)
        if (checked != null) LkSwitchTrack(checked)
        if (chevron) LkIcon(LkIcons.Chevron, null, tint = Lk.colors.muted, size = 18)
    }
}

/** Inbox-style item: leading slot, title, preview, time, unread dot. */
@Composable
fun LkListItem(
    title: String,
    modifier: Modifier = Modifier,
    sub: String? = null,
    meta: String? = null,
    unread: Boolean = false,
    leading: (@Composable () -> Unit)? = null,
    onClick: () -> Unit = {},
) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 64.dp).lkClickable(onClick, LkShapes.Row).padding(horizontal = 12.dp),
        Arrangement.spacedBy(14.dp), Alignment.CenterVertically,
    ) {
        leading?.invoke()
        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
            Text(title, color = Lk.colors.text, style = Lk.type.rowTitle.copy(fontWeight = if (unread) androidx.compose.ui.text.font.FontWeight.SemiBold else androidx.compose.ui.text.font.FontWeight.Medium), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub != null) Text(sub, color = Lk.colors.muted, style = Lk.type.caption, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (meta != null) Text(meta, color = Lk.colors.dim, style = Lk.type.numSmall)
            if (unread) Box(Modifier.size(8.dp).background(Lk.colors.accent, CircleShape))
        }
    }
}

@Preview(widthDp = 360, heightDp = 700) @Composable
private fun CardPreview() = LkBoth {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        LkCard(title = "Battery") { Text("84 %", color = Lk.colors.text, style = Lk.type.num) }
        LkSection("Island") {
            LkRow("Show island", sub = "Over other apps", icon = LkIcons.Bell, checked = true, onCheckedChange = {})
            LkRow("Position", value = "Top centre", onClick = {})
            LkRow("Background health", sub = "All checks passed", icon = LkIcons.Check, chevron = true, onClick = {})
        }
    }
}

@Preview(widthDp = 360) @Composable
private fun ListItemPreview() = LkBoth {
    Column {
        LkListItem("PC finished the build", sub = "lokey-app: 0 errors, 3 warnings", meta = "09:41", unread = true, leading = { LkIconDisc(LkIcons.Pc) })
        LkListItem("Reminder: call mum", sub = "Today, 18:00", meta = "08:05", leading = { LkIconDisc(LkIcons.Bell) })
    }
}
