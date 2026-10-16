package app.lokey.link.ui.kit

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkShapes

/** The sheet body, shared by [LkSheet] and previews. */
@Composable
fun LkSheetSurface(title: String, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 20.dp), Arrangement.spacedBy(12.dp)) {
        Text(title, color = Lk.colors.text, style = Lk.type.title)
        content()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LkSheet(title: String, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(),
        containerColor = Lk.colors.s1, contentColor = Lk.colors.text, shape = LkShapes.Sheet, tonalElevation = 0.dp,
        scrimColor = Color.Black.copy(alpha = 0.5f),
        dragHandle = { Box(Modifier.padding(vertical = 12.dp).width(36.dp).heightIn(min = 4.dp).clip(CircleShape).background(Lk.colors.s3)) },
    ) { LkSheetSurface(title, Modifier.navigationBarsPadding(), content) }
}

@Composable
fun LkDialogSurface(
    title: String,
    text: String,
    confirm: String,
    onConfirm: () -> Unit,
    dismiss: String?,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    destructive: Boolean = false,
) {
    Column(modifier.fillMaxWidth().clip(LkShapes.Card).background(Lk.colors.s2).padding(20.dp), Arrangement.spacedBy(8.dp)) {
        Text(title, color = Lk.colors.text, style = Lk.type.title)
        Text(text, color = Lk.colors.muted, style = Lk.type.body)
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), Arrangement.spacedBy(8.dp, Alignment.End)) {
            if (dismiss != null) LkButton(dismiss, onDismiss, kind = LkButtonKind.Quiet)
            LkButton(confirm, onConfirm, kind = if (destructive) LkButtonKind.Destructive else LkButtonKind.Primary)
        }
    }
}

@Composable
fun LkDialog(
    title: String,
    text: String,
    confirm: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    dismiss: String? = "Cancel",
    destructive: Boolean = false,
) {
    Dialog(onDismissRequest = onDismiss) { LkDialogSurface(title, text, confirm, onConfirm, dismiss, onDismiss, destructive = destructive) }
}

/** Snackbar-like message. s3, not the island black: that is the only high-contrast object. */
@Composable
fun LkToast(message: String, modifier: Modifier = Modifier, action: String? = null, onAction: () -> Unit = {}) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp).clip(LkShapes.Field).background(Lk.colors.s3)
            .semantics { liveRegion = LiveRegionMode.Polite }.padding(start = 16.dp, end = if (action != null) 4.dp else 16.dp),
        Arrangement.spacedBy(8.dp), Alignment.CenterVertically,
    ) {
        Text(message, Modifier.weight(1f).padding(vertical = 10.dp), color = Lk.colors.text, style = Lk.type.body)
        if (action != null) Box(Modifier.heightIn(min = 48.dp).lkClickable(onAction, LkShapes.Pill).padding(horizontal = 12.dp), Alignment.Center) {
            Text(action, color = Lk.colors.accentText, style = Lk.type.button)
        }
    }
}

@Preview(widthDp = 360) @Composable
private fun OverlaysPreview() = LkBoth {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Box(Modifier.clip(LkShapes.Sheet).background(Lk.colors.s1)) {
            LkSheetSurface("Quick settings", Modifier.padding(top = 20.dp)) {
                LkRow("Island", checked = true, onCheckedChange = {})
                LkRow("Wake word", checked = false, onCheckedChange = {})
            }
        }
        LkDialogSurface("Forget this PC?", "Lokey will stop syncing with Studio-PC until you pair again.", "Forget", {}, "Cancel", {}, destructive = true)
        LkToast("Copied to PC", action = "Undo")
    }
}
