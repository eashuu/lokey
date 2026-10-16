package app.lokey.link.ui.kit

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntOffset
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkMotion
import app.lokey.link.ui.theme.LkShapes
import app.lokey.link.ui.theme.LocalReducedMotion
import androidx.compose.foundation.layout.RowScope

enum class LkButtonKind { Primary, Quiet, Destructive, OnPanel }

@Composable
fun LkButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    kind: LkButtonKind = LkButtonKind.Primary,
    enabled: Boolean = true,
    icon: ImageVector? = null,
) {
    val c = Lk.colors
    val (bg, fg) = when (kind) {
        LkButtonKind.Primary -> c.accent to c.accentInk
        LkButtonKind.Quiet -> c.fill2 to c.text
        LkButtonKind.Destructive -> c.bad.copy(alpha = 0.16f) to c.bad
        LkButtonKind.OnPanel -> Color(0x1AFFFFFF) to Color.White
    }
    Row(
        modifier.heightIn(min = 48.dp).clip(LkShapes.Pill).background(bg).alpha(if (enabled) 1f else 0.45f)
            .lkClickable(onClick, LkShapes.Pill, enabled, press = 0.97f).padding(horizontal = 20.dp),
        Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), Alignment.CenterVertically,
    ) {
        if (icon != null) LkIcon(icon, null, tint = fg, size = 18)
        Text(text, color = fg, style = Lk.type.button, maxLines = 1)
    }
}

/** A quiet action: accent text, no fill, 48 dp high. For the second action in a row, so the page keeps one loud button. */
@Composable
fun LkTextButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, icon: ImageVector? = null, enabled: Boolean = true, tone: Color = Lk.colors.accentText) {
    Row(
        modifier.heightIn(min = 48.dp).alpha(if (enabled) 1f else 0.45f).lkClickable(onClick, LkShapes.Pill, enabled, press = 0.97f).padding(horizontal = 12.dp),
        Arrangement.spacedBy(6.dp), Alignment.CenterVertically,
    ) {
        if (icon != null) LkIcon(icon, null, tint = tone, size = 18)
        Text(text, color = tone, style = Lk.type.button, maxLines = 1)
    }
}

/** 48 dp target, 40 dp disc; accent fill when [active]. Press scale .92. */
@Composable
fun LkIconButton(icon: ImageVector, contentDescription: String, onClick: () -> Unit, modifier: Modifier = Modifier, active: Boolean = false, enabled: Boolean = true, quiet: Boolean = false) {
    val c = Lk.colors
    Box(modifier.size(48.dp).lkClickable(onClick, CircleShape, enabled, press = 0.92f), Alignment.Center) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(if (active) c.accent else if (quiet) Color.Transparent else c.fill2).alpha(if (enabled) 1f else 0.45f), Alignment.Center) {
            LkIcon(icon, contentDescription, tint = if (active) c.accentInk else if (quiet) c.muted else c.text, size = 20)
        }
    }
}

/** The track and thumb only; the parent supplies toggle semantics (rows). */
@Composable
fun LkSwitchTrack(checked: Boolean, modifier: Modifier = Modifier) {
    val c = Lk.colors
    val reduced = LocalReducedMotion.current
    val x by animateDpAsState(if (checked) 20.dp else 0.dp, LkMotion.spring(reduced), label = "thumb")
    val track by animateColorAsState(if (checked) c.accent else c.s3, LkMotion.enter(reduced), label = "track")
    val thumb by animateColorAsState(if (checked) c.accentInk else c.muted, LkMotion.enter(reduced), label = "thumbc")
    Box(modifier.size(width = 44.dp, height = 26.dp).clip(CircleShape).background(track)) {
        Box(Modifier.offset(x + 3.dp, 3.dp).size(20.dp).clip(CircleShape).background(thumb))
    }
}

@Composable
fun LkSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, contentDescription: String, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Box(
        modifier.minimumInteractiveComponentSize().clip(CircleShape)
            .toggleable(checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
            .semantics { this.contentDescription = contentDescription }
            .alpha(if (enabled) 1f else 0.45f),
        Alignment.Center,
    ) { LkSwitchTrack(checked) }
}

/** Pill slider (volume, brightness): accent fill, optional value text. [value] is 0..1. */
@Composable
fun LkSlider(
    value: Float,
    onValueChange: (Float) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    valueText: String? = null,
    onValueChangeFinished: () -> Unit = {},
) {
    var w by remember { mutableIntStateOf(1) }
    val change by rememberUpdatedState(onValueChange)
    val done by rememberUpdatedState(onValueChangeFinished)
    fun at(x: Float) = (x / w).coerceIn(0f, 1f)
    Box(
        modifier.fillMaxWidth().height(48.dp).onSizeChanged { w = it.width.coerceAtLeast(1) }
            .pointerInput(Unit) { detectTapGestures { change(at(it.x)); done() } }
            .pointerInput(Unit) {
                detectHorizontalDragGestures(onDragEnd = { done() }, onDragCancel = { done() }) { ch, _ -> ch.consume(); change(at(ch.position.x)) }
            }
            .semantics {
                contentDescription = label
                progressBarRangeInfo = ProgressBarRangeInfo(value, 0f..1f)
                setProgress { change(it.coerceIn(0f, 1f)); true }
            },
        Alignment.CenterStart,
    ) {
        Box(Modifier.fillMaxWidth().height(38.dp).clip(CircleShape).background(Lk.colors.fill2)) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(value.coerceIn(0f, 1f)).clip(CircleShape).background(Lk.colors.accent))
            if (valueText != null) Text(
                valueText, Modifier.align(Alignment.CenterEnd).padding(end = 16.dp),
                color = Lk.colors.text, style = Lk.type.body.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium),
            )
        }
    }
}

@Composable
fun LkChip(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = Lk.colors
    Box(
        modifier.minimumInteractiveComponentSize().height(32.dp).clip(CircleShape)
            .background(if (selected) c.accent else c.fill2)
            .selectable(selected, role = Role.RadioButton, onClick = onClick).padding(horizontal = 12.dp),
        Alignment.Center,
    ) { Text(text, color = if (selected) c.accentInk else c.muted, style = Lk.type.caption.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), maxLines = 1) }
}

@Composable
fun LkSegmented(options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val c = Lk.colors
    val reduced = LocalReducedMotion.current
    Row(modifier.fillMaxWidth().clip(CircleShape).background(c.fill1).padding(4.dp).selectableGroup(), Arrangement.spacedBy(4.dp)) {
        options.forEachIndexed { i, o ->
            val on = i == selected
            val bg by animateColorAsState(if (on) c.accent else Color.Transparent, LkMotion.enter(reduced), label = "seg")
            Box(
                Modifier.weight(1f).height(48.dp).clip(CircleShape).background(bg)
                    .selectable(on, role = Role.RadioButton, onClick = { onSelect(i) }),
                Alignment.Center,
            ) { Text(o, color = if (on) c.accentInk else c.muted, style = Lk.type.button, maxLines = 1) }
        }
    }
}

@Composable
fun LkField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String = "",
    error: String? = null,
    singleLine: Boolean = true,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    val c = Lk.colors
    val src = remember { MutableInteractionSource() }
    val focused by src.collectIsFocusedAsState()
    val edge = when { error != null -> c.bad; focused -> c.accent; else -> Color.Transparent }
    Column(modifier.fillMaxWidth(), Arrangement.spacedBy(6.dp)) {
        if (label != null) LkLabel(label, Modifier.padding(start = 4.dp))
        BasicTextField(
            value, onValueChange,
            Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(LkShapes.Field).background(c.fill1)
                .border(1.5.dp, edge, LkShapes.Field).semantics { if (label != null) contentDescription = label },
            textStyle = Lk.type.body.copy(color = c.text), cursorBrush = SolidColor(c.accent), singleLine = singleLine,
            interactionSource = src, visualTransformation = visualTransformation,
            keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
            decorationBox = { inner ->
                Box(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), Alignment.CenterStart) {
                    if (value.isEmpty()) Text(placeholder, color = c.dim, style = Lk.type.body)
                    inner()
                }
            },
        )
        if (error != null) Text(error, Modifier.padding(start = 4.dp), color = c.bad, style = Lk.type.caption)
    }
}

@Preview(widthDp = 360) @Composable
private fun ButtonsPreview() = LkBoth {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LkButton("Allow", {}); LkButton("Later", {}, kind = LkButtonKind.Quiet); LkButton("Delete", {}, kind = LkButtonKind.Destructive)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            LkIconButton(LkIcons.Mic, "Talk", {}, active = true); LkIconButton(LkIcons.Bell, "Notifications", {})
            LkSwitch(true, {}, "Island"); LkSwitch(false, {}, "Wake word")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { LkChip("All", true, {}); LkChip("PC", false, {}); LkChip("Phone", false, {}) }
        LkSegmented(listOf("Dark", "Light", "Auto"), 0, {})
        LkSlider(0.62f, {}, "Volume", valueText = "62")
        LkField("", {}, label = "Server address", placeholder = "192.168.0.10")
        LkField("nope", {}, label = "Pairing code", error = "Code not recognised")
    }
}
