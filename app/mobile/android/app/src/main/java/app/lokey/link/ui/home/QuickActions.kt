package app.lokey.link.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.lokey.link.core.Core
import app.lokey.link.core.NativeResult
import app.lokey.link.core.objects
import app.lokey.link.core.str
import app.lokey.link.ui.kit.LkButton
import app.lokey.link.ui.kit.LkButtonKind
import app.lokey.link.ui.kit.LkChip
import app.lokey.link.ui.kit.LkField
import app.lokey.link.ui.kit.LkIcon
import app.lokey.link.ui.kit.LkIcons
import app.lokey.link.ui.kit.LkSheet
import app.lokey.link.ui.kit.LkSlider
import app.lokey.link.ui.kit.lkClickable
import app.lokey.link.ui.screens.native
import app.lokey.link.ui.screens.rememberLauncher
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkShapes
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

private enum class Sheet { Volume, Timer, Call, Navigate, Remind }

/** The chips that run a phone action through the core's native plugin (phone/quick.tsx). Nothing is sent or dialled silently: the composer or dialler opens. */
@Composable
fun QuickActions(core: Core) {
    var sheet by remember { mutableStateOf<Sheet?>(null) }
    var torch by remember { mutableStateOf(false) }
    val launch = rememberLauncher()
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), Arrangement.spacedBy(8.dp)) {
        ActionChip(LkIcons.Torch, "Torch", torch) { torch = !torch; launch { core.native("flashlight.set", JSONObject().put("on", torch)) } }
        ActionChip(LkIcons.Volume, "Volume") { sheet = Sheet.Volume }
        ActionChip(LkIcons.Timer, "Timer") { sheet = Sheet.Timer }
        ActionChip(LkIcons.Eye, "What's on my screen?") { launch { whatsOnMyScreen(core) } }
        ActionChip(LkIcons.Phone, "Call or message") { sheet = Sheet.Call }
        ActionChip(LkIcons.Place, "Navigate") { sheet = Sheet.Navigate }
        ActionChip(LkIcons.Bell, "Remind me") { sheet = Sheet.Remind }
        ActionChip(LkIcons.Camera, "Camera") { launch { core.native("intent.camera") } }
    }
    val close = { sheet = null }
    when (sheet) {
        Sheet.Volume -> LkSheet("Volume", close) { VolumeSheet(core) }
        Sheet.Timer -> LkSheet("Timer", close) { TimerSheet(core, close) }
        Sheet.Call -> LkSheet("Call or message", close) { CallSheet(core) }
        Sheet.Navigate -> LkSheet("Navigate to", close) { NavigateSheet(core, close) }
        Sheet.Remind -> LkSheet("Remind me", close) { RemindSheet(core, close) }
        null -> Unit
    }
}

@Composable
private fun ActionChip(icon: ImageVector, text: String, on: Boolean = false, onClick: () -> Unit) {
    val c = Lk.colors
    Row(
        Modifier.heightIn(min = 48.dp).clip(CircleShape).background(if (on) c.accent else c.fill2).lkClickable(onClick, CircleShape).padding(horizontal = 14.dp).semantics { stateDescription = if (on) "On" else "Off" },
        Arrangement.spacedBy(8.dp), Alignment.CenterVertically,
    ) {
        LkIcon(icon, null, tint = if (on) c.accentInk else c.muted, size = 16)
        Text(text, color = if (on) c.accentInk else c.text, style = Lk.type.caption.copy(fontWeight = FontWeight.SemiBold), maxLines = 1)
    }
}

/** step aside, take one picture of what is behind Lokey, come back, and ask about it (the agent's screen tool reads the picture from the page) */
private suspend fun whatsOnMyScreen(core: Core) {
    core.notify("Looking at your screen...")
    core.native("ui.home"); delay(700)
    val shot = core.native("screenshot", JSONObject().put("maxWidth", 1080).put("quality", 70))
    core.native("app.openSelf")
    if (shot == null || NativeResult.failed(shot)) { core.notify("Could not capture the screen" + (NativeResult.reason(shot)?.let { ": $it" } ?: ""), true); return }
    try { core.call("page.setScreenshot", shot) } catch (_: Exception) { }
    core.say("What's on my screen right now? (I just took a screenshot of it.)")
}

@Composable
private fun VolumeSheet(core: Core) {
    var v by remember { mutableStateOf(0.5f) }
    val launch = rememberLauncher()
    LaunchedEffect(Unit) { (core.native("audio.get") as? JSONObject)?.let { v = it.optDouble("volume", 0.5).toFloat() } }
    LkSlider(v, { v = it; launch { core.native("audio.setVolume", JSONObject().put("level", it.toDouble())) } }, "Volume", valueText = "${(v * 100).toInt()}%")
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TimerSheet(core: Core, done: () -> Unit) {
    var other by remember { mutableStateOf("") }
    val go = { m: Int -> core.timerStart(m); core.notify("Timer set for $m min"); done() }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(1, 5, 10, 15, 25, 45).forEach { m -> LkButton("$m min", { go(m) }, kind = LkButtonKind.Quiet) } }
    Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp), Alignment.CenterVertically) {
        LkField(other, { other = it.filter(Char::isDigit).take(3) }, Modifier.weight(1f), placeholder = "Other, in minutes", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        LkButton("Start", { other.toIntOrNull()?.takeIf { it > 0 }?.let(go) }, enabled = (other.toIntOrNull() ?: 0) > 0)
    }
}

private data class Num(val name: String, val number: String, val type: String)

@Composable
private fun CallSheet(core: Core) {
    var q by remember { mutableStateOf("") }
    var res by remember { mutableStateOf<List<Num>>(emptyList()) }
    var msg by remember { mutableStateOf("") }
    var pick by remember { mutableStateOf<Num?>(null) }
    val launch = rememberLauncher()
    LaunchedEffect(q) {
        if (q.trim().length < 2) { res = emptyList(); msg = ""; return@LaunchedEffect }
        delay(250)
        val r = core.native("contacts.search", JSONObject().put("query", q.trim()).put("limit", 6))
        if (r is JSONArray) {
            res = r.objects().flatMap { c -> c.optJSONArray("numbers")?.objects().orEmpty().map { Num(c.str("name"), it.str("number"), it.str("type")) } }
            msg = if (res.isEmpty()) "No contact found" else ""
        } else {
            res = emptyList()
            val p = NativeResult.needsPerm(r)
            msg = if (p != null) "Lokey needs the Contacts permission." else NativeResult.reason(r) ?: "Could not search contacts"
            if (p != null) core.native("perm.request", JSONObject().put("name", p))
        }
    }
    val p = pick
    if (p != null) {
        Text("${p.name}  ${p.number}", color = Lk.colors.text, style = Lk.type.rowTitle)
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
            LkButton("Call", { launch { core.native("intent.dial", JSONObject().put("number", p.number)) } }, Modifier.weight(1f), icon = LkIcons.Phone)
            LkButton("Message", { launch { core.native("intent.sms", JSONObject().put("number", p.number).put("text", "")) } }, Modifier.weight(1f), kind = LkButtonKind.Quiet, icon = LkIcons.Chat)
        }
        LkButton("Back", { pick = null }, Modifier.fillMaxWidth(), kind = LkButtonKind.Quiet)
    } else {
        LkField(q, { q = it }, label = "Name", placeholder = "Who?")
        if (msg.isNotEmpty()) Text(msg, color = Lk.colors.muted, style = Lk.type.body)
        res.forEach { n ->
            Column(Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(LkShapes.Row).lkClickable({ pick = n }).padding(horizontal = 12.dp, vertical = 8.dp), Arrangement.Center) {
                Text(n.name, color = Lk.colors.text, style = Lk.type.rowTitle)
                Text(n.number + if (n.type.isNotEmpty()) "  ${n.type}" else "", color = Lk.colors.muted, style = Lk.type.caption)
            }
        }
    }
}

@Composable
private fun NavigateSheet(core: Core, done: () -> Unit) {
    var q by remember { mutableStateOf("") }
    val launch = rememberLauncher()
    LkField(q, { q = it }, label = "Where to", placeholder = "Place or address")
    LkButton("Start", { launch { core.native("intent.maps", JSONObject().put("query", q.trim()).put("navigate", true)) }; done() }, Modifier.fillMaxWidth(), enabled = q.isNotBlank(), icon = LkIcons.Place)
}

/** the delays the Remind sheet offers; "tomorrow 9:00" is relative to [now] */
internal fun reminderOptions(now: Long): List<Pair<String, Long>> {
    val t = Calendar.getInstance().apply { timeInMillis = now; add(Calendar.DAY_OF_YEAR, 1); set(Calendar.HOUR_OF_DAY, 9); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }
    return listOf("10 min" to 600_000L, "30 min" to 1_800_000L, "1 hour" to 3_600_000L, "Tomorrow 9:00" to (t.timeInMillis - now))
}

@Composable
private fun RemindSheet(core: Core, done: () -> Unit) {
    var text by remember { mutableStateOf("") }
    val opts = remember { reminderOptions(System.currentTimeMillis()) }
    var ms by remember { mutableStateOf(opts[1].second) }
    val launch = rememberLauncher()
    LkField(text, { text = it }, label = "Remind me to", placeholder = "What?")
    Row(Modifier.horizontalScroll(rememberScrollState()), Arrangement.spacedBy(4.dp)) { opts.forEach { (l, v) -> LkChip(l, ms == v, { ms = v }) } }
    LkButton("Set reminder", {
        launch {
            val r = core.native("reminder.set", JSONObject().put("inMs", ms).put("title", text.trim()).put("text", text.trim()))
            if (NativeResult.failed(r)) core.notify("Could not set the reminder: ${NativeResult.reason(r)}", true) else core.notify("Reminder set: ${text.trim()}")
        }
        done()
    }, Modifier.fillMaxWidth(), enabled = text.isNotBlank(), icon = LkIcons.Check)
}
