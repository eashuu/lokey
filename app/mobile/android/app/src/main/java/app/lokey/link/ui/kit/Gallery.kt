package app.lokey.link.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.lokey.link.ui.island.IslandPill
import app.lokey.link.ui.theme.Lk

/** Every component once, with live state. Used by the debug DesignShowcaseActivity (twice: dark, light). */
@Composable
fun LkGallery(modifier: Modifier = Modifier) {
    var sw by remember { mutableStateOf(true) }
    var sw2 by remember { mutableStateOf(false) }
    var vol by remember { mutableFloatStateOf(0.62f) }
    var seg by remember { mutableIntStateOf(0) }
    var chip by remember { mutableIntStateOf(0) }
    var text by remember { mutableStateOf("") }
    var dest by remember { mutableStateOf(LkDest.Home) }
    var sheet by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf(false) }

    Column(modifier.background(Lk.colors.bg).padding(16.dp), Arrangement.spacedBy(20.dp)) {
        Column {
            Text(if (Lk.colors.dark) "Dark" else "Light", color = Lk.colors.text, style = Lk.type.pageTitle)
            Text("Lokey design system", color = Lk.colors.muted, style = Lk.type.caption)
        }
        IslandPill { Text("Island preview", color = androidx.compose.ui.graphics.Color.White, style = Lk.type.island) }

        LkSection("Rows") {
            LkRow("Show island", sub = "Over other apps", icon = LkIcons.Bell, checked = sw, onCheckedChange = { sw = it })
            LkRow("Wake word", checked = sw2, onCheckedChange = { sw2 = it })
            LkRow("Position", value = "Top centre", onClick = {})
            LkRow("Background health", sub = "All checks passed", icon = LkIcons.Check, chevron = true, onClick = {})
        }
        LkCard(title = "Card") {
            Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
                LkStatTile("Battery", "84", Modifier.weight(1f), unit = "%", progress = 0.84f)
                LkStatTile("Steps", "6,420", Modifier.weight(1f), sub = "Goal 8,000")
            }
            LkProgress(0.4f)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LkBadge("Online", tone = LkTone.Ok); LkBadge("Beta", tone = LkTone.Accent); LkBadge("Risky", tone = LkTone.Warn)
                LkBadge("Offline", tone = LkTone.Bad); LkBadge("Muted"); LkBadge("3", mono = true)
            }
        }
        LkSection("Inbox") {
            LkListItem("PC finished the build", sub = "lokey-app: 0 errors, 3 warnings", meta = "09:41", unread = true, leading = { LkIconDisc(LkIcons.Pc) })
            LkListItem("Reminder: call mum", sub = "Today, 18:00", meta = "08:05", leading = { LkIconDisc(LkIcons.Bell) })
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LkLabel("Buttons")
            Row(Modifier.horizontalScroll(rememberScrollState()), Arrangement.spacedBy(8.dp)) {
                LkButton("Allow", {}); LkButton("Later", {}, kind = LkButtonKind.Quiet); LkButton("Delete", {}, kind = LkButtonKind.Destructive)
                LkButton("Disabled", {}, enabled = false)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                LkIconButton(LkIcons.Mic, "Talk", {}, active = true); LkIconButton(LkIcons.Bell, "Notifications", {}); LkIconButton(LkIcons.Close, "Close", {})
                LkSwitch(sw, { sw = it }, "Island switch")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf("All", "PC", "Phone").forEachIndexed { i, s -> LkChip(s, chip == i, { chip = i }) }
            }
            LkSegmented(listOf("Dark", "Light", "Auto"), seg, { seg = it })
            LkSlider(vol, { vol = it }, "Volume", valueText = "${(vol * 100).toInt()}")
        }
        LkField(text, { text = it }, label = "Server address", placeholder = "192.168.0.10")
        LkField("nope", {}, label = "Pairing code", error = "Code not recognised")
        LkApprovalCard("Run a command on PC", "git push origin main", {}, {}, risk = "Writes")
        LkEmpty("Nothing new", "Messages from your PC and phone land here.", action = "Refresh")
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            LkLabel("Overlays")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LkButton("Sheet", { sheet = true }, kind = LkButtonKind.Quiet); LkButton("Dialog", { dialog = true }, kind = LkButtonKind.Quiet)
                LkButton("Toast", { toast = !toast }, kind = LkButtonKind.Quiet)
            }
            if (toast) LkToast("Copied to PC", action = "Undo", onAction = { toast = false })
            LkDialogSurface("Forget this PC?", "Lokey will stop syncing until you pair again.", "Forget", {}, "Cancel", {}, destructive = true)
        }
        LkBottomNav(dest, { dest = it }, badges = mapOf(LkDest.Inbox to 3))
    }
    if (sheet) LkSheet("Quick settings", { sheet = false }) {
        LkRow("Island", checked = sw, onCheckedChange = { sw = it })
        LkRow("Wake word", checked = sw2, onCheckedChange = { sw2 = it })
    }
    if (dialog) LkDialog("Forget this PC?", "Lokey will stop syncing until you pair again.", "Forget", { dialog = false }, { dialog = false }, destructive = true)
}

@Preview(widthDp = 360, heightDp = 2400) @Composable
private fun GalleryPreview() = LkBoth { LkGallery() }
