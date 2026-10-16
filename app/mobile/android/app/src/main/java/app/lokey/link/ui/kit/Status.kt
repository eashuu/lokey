package app.lokey.link.ui.kit

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkMotion
import app.lokey.link.ui.theme.LkShapes
import app.lokey.link.ui.theme.LocalReducedMotion

enum class LkDest(val title: String, val icon: ImageVector) {
    Home("Home", LkIcons.Home), Inbox("Inbox", LkIcons.Inbox), Today("Today", LkIcons.Today), Pc("PC", LkIcons.Pc), You("You", LkIcons.You),
}

/** Floating pill bar; the selected destination is filled with the accent. */
@Composable
fun LkBottomNav(selected: LkDest, onSelect: (LkDest) -> Unit, modifier: Modifier = Modifier, badges: Map<LkDest, Int> = emptyMap()) {
    val c = Lk.colors
    val reduced = LocalReducedMotion.current
    Row(
        modifier.fillMaxWidth().clip(CircleShape).background(c.s1).border(1.dp, c.line, CircleShape).padding(6.dp).selectableGroup(),
        Arrangement.spacedBy(4.dp),
    ) {
        for (d in LkDest.entries) {
            val on = d == selected
            val bg by animateColorAsState(if (on) c.accent else Color.Transparent, LkMotion.enter(reduced), label = "nav")
            val fg = if (on) c.accentInk else c.muted
            val n = badges[d] ?: 0
            Column(
                Modifier.weight(1f).heightIn(min = 56.dp).clip(CircleShape).background(bg)
                    .selectable(on, role = Role.Tab, onClick = { onSelect(d) })
                    .semantics { contentDescription = if (n > 0) "${d.title}, $n new" else d.title },
                Arrangement.spacedBy(2.dp, Alignment.CenterVertically), Alignment.CenterHorizontally,
            ) {
                Box {
                    LkIcon(d.icon, null, tint = fg, size = 22)
                    if (n > 0) Box(Modifier.align(Alignment.TopEnd).size(8.dp).background(if (on) c.accentInk else c.accent, CircleShape))
                }
                Text(d.title, color = fg, style = Lk.type.label.copy(fontSize = 10.sp), maxLines = 1)
            }
        }
    }
}

@Composable
fun LkEmpty(title: String, body: String, modifier: Modifier = Modifier, icon: ImageVector = LkIcons.Inbox, action: String? = null, onAction: () -> Unit = {}) {
    Column(modifier.fillMaxWidth().padding(32.dp), Arrangement.spacedBy(8.dp), Alignment.CenterHorizontally) {
        Box(Modifier.size(56.dp).clip(CircleShape).background(Lk.colors.fill1), Alignment.Center) { LkIcon(icon, null, tint = Lk.colors.dim, size = 26) }
        Text(title, Modifier.padding(top = 8.dp), color = Lk.colors.text, style = Lk.type.rowTitle, textAlign = TextAlign.Center)
        Text(body, color = Lk.colors.muted, style = Lk.type.body, textAlign = TextAlign.Center)
        if (action != null) LkButton(action, onAction, Modifier.padding(top = 8.dp), kind = LkButtonKind.Quiet)
    }
}

enum class LkTone { Accent, Ok, Warn, Bad, Neutral }

@Composable
fun LkBadge(text: String, modifier: Modifier = Modifier, tone: LkTone = LkTone.Neutral, mono: Boolean = false) {
    val c = Lk.colors
    val fg = when (tone) { LkTone.Accent -> c.accentText; LkTone.Ok -> c.ok; LkTone.Warn -> c.warn; LkTone.Bad -> c.bad; LkTone.Neutral -> c.muted }
    val bg = if (tone == LkTone.Neutral) c.fill2 else fg.copy(alpha = 0.16f)
    Box(modifier.heightIn(min = 20.dp).clip(CircleShape).background(bg).padding(horizontal = 8.dp), Alignment.Center) {
        Text(if (mono) text else text.uppercase(), color = fg, style = if (mono) Lk.type.numSmall.copy(fontSize = 11.sp) else Lk.type.label, maxLines = 1)
    }
}

/** 4 dp bar, [progress] 0..1. */
@Composable
fun LkProgress(progress: Float, modifier: Modifier = Modifier, label: String = "Progress", color: Color = Lk.colors.accent) {
    val reduced = LocalReducedMotion.current
    val p by animateFloatAsState(progress.coerceIn(0f, 1f), LkMotion.enter(reduced), label = "progress")
    Box(
        modifier.fillMaxWidth().height(4.dp).clip(CircleShape).background(Lk.colors.s3)
            .semantics { contentDescription = label; progressBarRangeInfo = ProgressBarRangeInfo(progress.coerceIn(0f, 1f), 0f..1f) },
    ) { Box(Modifier.fillMaxHeight().fillMaxWidth(p).background(color)) }
}

@Composable
fun LkStatTile(label: String, value: String, modifier: Modifier = Modifier, unit: String? = null, sub: String? = null, progress: Float? = null) {
    LkCard(modifier.semantics(mergeDescendants = true) {}, padding = 14.dp) {
        LkLabel(label)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(value, color = Lk.colors.text, style = Lk.type.num)
            if (unit != null) Text(unit, Modifier.padding(bottom = 4.dp), color = Lk.colors.muted, style = Lk.type.body)
        }
        if (progress != null) LkProgress(progress, label = label)
        if (sub != null) Text(sub, color = Lk.colors.muted, style = Lk.type.caption)
    }
}

/** Expanded island card for an approval: black panel, white small type, deny / approve. */
@Composable
fun LkApprovalCard(
    title: String,
    detail: String,
    onDeny: () -> Unit,
    onApprove: () -> Unit,
    modifier: Modifier = Modifier,
    source: String = "PC",
    risk: String? = null,
) {
    val soft = Color.White.copy(alpha = 0.62f)
    Column(
        modifier.fillMaxWidth().clip(LkShapes.Panel).background(Lk.colors.panel).border(1.dp, Lk.colors.glassStroke, LkShapes.Panel).padding(16.dp),
        Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(8.dp).background(Color(0xFFF5A524), CircleShape))
            Text("APPROVAL FROM ${source.uppercase()}", Modifier.weight(1f), color = soft, style = Lk.type.label)
            if (risk != null) LkBadge(risk, tone = LkTone.Warn)
        }
        Text(title, color = Color.White, style = Lk.type.rowTitle.copy(fontSize = 17.sp))
        Text(detail, Modifier.fillMaxWidth().clip(LkShapes.Field).background(Color(0x1AFFFFFF)).padding(12.dp), color = Color.White.copy(alpha = 0.86f), style = Lk.type.numSmall)
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
            LkButton("Deny", onDeny, Modifier.weight(1f), kind = LkButtonKind.OnPanel)
            LkButton("Approve", onApprove, Modifier.weight(1f))
        }
    }
}

@Preview(widthDp = 360) @Composable
private fun NavPreview() = LkBoth { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { LkBottomNav(LkDest.Home, {}, badges = mapOf(LkDest.Inbox to 3)); LkBottomNav(LkDest.Pc, {}) } }

@Preview(widthDp = 360) @Composable
private fun StatusPreview() = LkBoth {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { LkBadge("Online", tone = LkTone.Ok); LkBadge("Beta", tone = LkTone.Accent); LkBadge("Risky", tone = LkTone.Warn); LkBadge("Offline", tone = LkTone.Bad); LkBadge("3", mono = true) }
        LkProgress(0.4f)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LkStatTile("Battery", "84", Modifier.weight(1f), unit = "%", progress = 0.84f)
            LkStatTile("Steps", "6,420", Modifier.weight(1f), sub = "Goal 8,000")
        }
        LkEmpty("Nothing new", "Messages from your PC and phone land here.", action = "Refresh")
    }
}

@Preview(widthDp = 360) @Composable
private fun ApprovalPreview() = LkBoth { LkApprovalCard("Run a command on PC", "git push origin main", {}, {}, risk = "Writes") }
