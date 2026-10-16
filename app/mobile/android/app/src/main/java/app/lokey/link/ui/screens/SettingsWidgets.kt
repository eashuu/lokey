package app.lokey.link.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.lokey.link.core.Core
import app.lokey.link.core.Patch
import app.lokey.link.ui.kit.LkCard
import app.lokey.link.ui.kit.LkLabel
import app.lokey.link.ui.kit.LkRow
import app.lokey.link.ui.kit.LkSegmented
import app.lokey.link.ui.kit.LkSlider
import app.lokey.link.ui.theme.Lk
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch

/** a card of rows with no label above it */
@Composable
fun Group(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    LkCard(modifier, padding = 4.dp) { Column { content() } }
}

@Composable
fun Note(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.padding(horizontal = 4.dp), color = Lk.colors.muted, style = Lk.type.caption)
}

@Composable
fun rememberSet(core: Core): (List<String>, Any?) -> Unit {
    val scope = rememberCoroutineScope()
    return remember(core) { { path: List<String>, v: Any? -> scope.launch { try { core.patchSettings(Patch.of(path, v)) } catch (_: Exception) { } }; Unit } }
}

@Composable
fun SettingSwitch(core: Core, title: String, sub: String? = null, vararg path: String, default: Boolean = false) {
    val s by core.settings.collectAsState()
    val set = rememberSet(core)
    LkRow(title, sub = sub, checked = s.raw.flag(*path, default = default), onCheckedChange = { set(path.toList(), it) })
}

/** a labelled segmented control bound to a string setting */
@Composable
fun SettingChoice(core: Core, label: String, options: List<Pair<String, String>>, vararg path: String, default: String) {
    val s by core.settings.collectAsState()
    val set = rememberSet(core)
    val cur = s.raw.text(*path, default = default)
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), Arrangement.spacedBy(8.dp)) {
        LkLabel(label)
        LkSegmented(options.map { it.second }, options.indexOfFirst { it.first == cur }.coerceAtLeast(0), { set(path.toList(), options[it].first) })
    }
}

/** a labelled slider for a numeric setting; [toSlider] / [fromSlider] map between the setting and 0..1 */
@Composable
fun SettingSlider(core: Core, label: String, toSlider: (Double) -> Float, fromSlider: (Float) -> Double, show: (Double) -> String, vararg path: String, default: Double) {
    val s by core.settings.collectAsState()
    val set = rememberSet(core)
    val value = s.raw.number(*path, default = default)
    var drag by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<Float?>(null) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), Arrangement.spacedBy(4.dp)) {
        LkLabel(label)
        LkSlider(drag ?: toSlider(value), { drag = it }, label, valueText = show(fromSlider(drag ?: toSlider(value))), onValueChangeFinished = { drag?.let { set(path.toList(), fromSlider(it)) }; drag = null })
    }
}
