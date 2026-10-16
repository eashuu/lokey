package app.lokey.link.ui.screens

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.lokey.link.BuildConfig
import app.lokey.link.core.Accent
import app.lokey.link.core.Core
import app.lokey.link.core.FakeCore
import app.lokey.link.core.Lang
import app.lokey.link.core.Parse
import app.lokey.link.core.Wake
import app.lokey.link.core.objects
import app.lokey.link.core.str
import app.lokey.link.ui.home.SpiritView
import app.lokey.link.ui.kit.LkBoth
import app.lokey.link.ui.kit.LkButton
import app.lokey.link.ui.kit.LkButtonKind
import app.lokey.link.ui.kit.LkCard
import app.lokey.link.ui.kit.LkChip
import app.lokey.link.ui.kit.LkEmpty
import app.lokey.link.ui.kit.LkField
import app.lokey.link.ui.kit.LkIconButton
import app.lokey.link.ui.kit.LkIcons
import app.lokey.link.ui.kit.LkLabel
import app.lokey.link.ui.kit.LkRow
import app.lokey.link.ui.kit.LkSegmented
import app.lokey.link.core.SoulMode
import app.lokey.link.ui.theme.Lk
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun VoiceSettings(core: Core) {
    val s by core.settings.collectAsState()
    val info by poll(Unit) { core.call("bridge.voice.info") as? JSONObject }
    var hasKey by remember(info) { mutableStateOf(info?.optBoolean("hasKey")) }
    var key by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf("") }
    val launch = rememberLauncher()
    LkCard(title = "Gemini key") {
        if (hasKey == true) {
            Text("A key is saved on this phone. It is only sent to Google.", color = Lk.colors.soft, style = Lk.type.body)
            app.lokey.link.ui.kit.LkTextButton("Remove the key", { launch { core.call("bridge.voice.clearKey"); hasKey = false } }, tone = Lk.colors.bad)
        } else {
            Text("The voice runs on Google's Gemini. A free key from aistudio.google.com/apikey takes a minute.", color = Lk.colors.soft, style = Lk.type.body)
            LkField(key, { key = it.trim() }, label = "AI Studio key", placeholder = "AIza...", visualTransformation = PasswordVisualTransformation())
            LkButton("Save key", { launch { val ok = core.call("bridge.voice.setKey", key) == true; if (ok) { hasKey = true; key = ""; msg = "Saved on this phone." } else msg = "That does not look like an AI Studio key (it starts with AIza)." } }, Modifier.fillMaxWidth(), enabled = key.length >= 20)
            if (msg.isNotEmpty()) Text(msg, color = if (msg.startsWith("Saved")) Lk.colors.ok else Lk.colors.warn, style = Lk.type.caption)
        }
    }
    val lang = Lang.of(s.raw.text("voice", "language", default = "auto"), s.raw.text("voice", "dictationScript", default = "mixed"))
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LkLabel("How do you talk?", Modifier.padding(start = 4.dp))
        LkSegmented(Lang.entries.map { it.title }, lang.ordinal, { launch { core.patchSettings(Lang.entries[it].patch()) } })
        Note(lang.sub)
    }
    Group {
        SettingSwitch(core, "Speak replies", "Off: captions only.", "voice", "speakReplies", default = true)
        SettingSwitch(core, "Answer when I let go", "Waits for the end of your sentence.", "voice", "holdToAnswer", default = true)
        SettingSwitch(core, "Stop listening while I speak", "Needed with speakers; turn off with headphones to interrupt by voice.", "voice", "halfDuplex", default = true)
        SettingSwitch(core, "Dictation", "Hold the key to type with your voice.", "voice", "dictation", default = true)
    }
}

@Composable
fun WakeSettings(core: Core) {
    val s by core.settings.collectAsState()
    val set = rememberSet(core)
    val list = s.raw.at("wake")?.optJSONArray("list")?.objects().orEmpty()
    var phrase by remember { mutableStateOf("") }
    Group {
        SettingSwitch(core, "Wake-up", "Wake Lokey without touching the phone. Audio is analysed on this phone only and never stored.", "wake", "enabled")
        SettingSwitch(core, "Claps", "A sharp double clap.", "wake", "claps", default = true)
        SettingSwitch(core, "Phrases", "Say one of the phrases below.", "wake", "phrases", default = true)
    }
    Group {
        SettingSlider(core, "Clap sensitivity", Wake::sensToSlider, Wake::sliderToSens, { if (it < 0.8) "sharp" else if (it > 1.2) "soft" else "normal" }, "wake", "clapSensitivity", default = 1.0)
        SettingSlider(core, "How sure the recogniser must be", Wake::confToSlider, Wake::sliderToConf, { "${Math.round(it * 100)}%" }, "wake", "confidence", default = 0.82)
    }
    LkCard(title = "Phrases") {
        list.forEachIndexed { i, p ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("\"${p.str("text")}\"", Modifier.weight(1f), color = Lk.colors.text, style = Lk.type.rowTitle)
                    LkIconButton(LkIcons.Trash, "Remove ${p.str("text")}", { set(listOf("wake", "list"), JSONArray(list.filterIndexed { j, _ -> j != i })) })
                }
                Row(Modifier.horizontalScroll(rememberScrollState()), Arrangement.spacedBy(4.dp)) {
                    listOf("listen", "greet", "welcome").forEach { a -> LkChip(Wake.actionLabel(a), p.str("action") == a, { set(listOf("wake", "list"), JSONArray(list.mapIndexed { j, o -> if (j == i) JSONObject(o.toString()).put("action", a) else o })) }) }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp), Alignment.CenterVertically) {
            LkField(phrase, { phrase = it }, Modifier.weight(1f), placeholder = "Add a phrase")
            LkButton("Add", { set(listOf("wake", "list"), JSONArray(list + JSONObject().put("text", phrase.trim()).put("action", "listen"))); phrase = "" }, enabled = phrase.isNotBlank())
        }
    }
}

@Composable
fun BrainSettings(core: Core) {
    val s by core.settings.collectAsState()
    val set = rememberSet(core)
    val providers = s.raw.at("brain")?.optJSONArray("providers")?.objects().orEmpty()
    val launch = rememberLauncher()
    Group {
        SettingSwitch(core, "Learn from conversations", "Builds your memory (Bond). Passwords and codes are never kept.", "brain", "learn", default = true)
        SettingSwitch(core, "Search memory by meaning", "Uses Google's free embedding model; falls back to word matching.", "brain", "embed", default = true)
    }
    providers.forEachIndexed { i, p ->
        var key by remember(p.str("id")) { mutableStateOf("") }
        var has by remember(p.str("id")) { mutableStateOf<Boolean?>(null) }
        var test by remember(p.str("id")) { mutableStateOf("") }
        val ref = p.str("keyRef")
        androidx.compose.runtime.LaunchedEffect(ref) { has = try { core.call("bridge.brain.hasSecret", ref) == true } catch (_: Exception) { null } }
        LkCard(title = p.str("name")) {
            LkRow(p.str("model").ifEmpty { "No model set" }, sub = p.optJSONArray("roles")?.let { r -> (0 until r.length()).joinToString(", ") { r.optString(it) } }, checked = p.optBoolean("enabled"),
                onCheckedChange = { on -> set(listOf("brain", "providers"), JSONArray(providers.mapIndexed { j, o -> if (j == i) JSONObject(o.toString()).put("enabled", on) else o })) })
            Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp), Alignment.CenterVertically) {
                LkField(key, { key = it.trim() }, Modifier.weight(1f), placeholder = if (has == true) "Key saved (type to replace)" else "API key", visualTransformation = PasswordVisualTransformation())
                LkButton("Save", { launch { val ok = core.call("bridge.brain.setSecret", ref, key) == true; test = if (ok) "Key saved (encrypted)." else "Could not save the key."; if (ok) { has = true; key = "" } } }, enabled = key.length >= 8)
            }
            Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp), Alignment.CenterVertically) {
                LkButton("Test", { launch { test = "Testing..."; val r = core.call("bridge.brain.test", p.str("id")) as? JSONObject; test = if (r?.optBoolean("ok") == true) "Works (${r.optInt("ms")} ms)." else r?.optString("error")?.ifEmpty { null } ?: "No answer." } }, kind = LkButtonKind.Quiet)
                if (test.isNotEmpty()) Text(test, Modifier.weight(1f), color = Lk.colors.muted, style = Lk.type.caption, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AppearanceSettings(core: Core) {
    val s by core.settings.collectAsState()
    val set = rememberSet(core)
    val acc = s.raw.text("appearance", "accent", default = "wallpaper")
    var custom by remember { mutableStateOf("") }
    Group {
        SettingChoice(core, "Theme", listOf("dark" to "Dark", "light" to "Light", "auto" to "System"), "appearance", "theme", default = "auto")
    }
    LkCard(title = "Accent") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Accent.Presets.forEach { (name, hex) -> LkChip(name, acc.equals(Accent.value(hex), true), { set(listOf("appearance", "accent"), Accent.value(hex)) }) }
        }
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp), Alignment.CenterVertically) {
            LkField(custom, { custom = it.trim() }, Modifier.weight(1f), placeholder = "#rrggbb", error = if (custom.isNotEmpty() && !Accent.valid(custom)) "Six hex digits, like #d9b556" else null)
            LkButton("Use", { set(listOf("appearance", "accent"), custom) }, enabled = Accent.valid(custom))
        }
    }
    Group {
        SettingSlider(core, "Text size", { ((it - 0.75) / 0.75).toFloat() }, { Math.round((0.75 + it * 0.75) * 20) / 20.0 }, { "${Math.round(it * 100)}%" }, "appearance", "scale", default = 1.0)
        SettingSwitch(core, "Reduce motion", "Fewer animations.", "appearance", "reduceMotion")
    }
}

@Composable
fun PrivacySettings(core: Core) {
    val s by core.settings.collectAsState()
    val set = rememberSet(core)
    var excl by remember(s.raw) { mutableStateOf(s.raw.at("brain")?.optJSONArray("excludeApps")?.let { a -> (0 until a.length()).joinToString(", ") { a.optString(it) } }.orEmpty()) }
    val launch = rememberLauncher()
    Group {
        SettingSwitch(core, "Learn from our conversations", "Builds your memory (Bond). Passwords and codes are never kept.", "brain", "learn", default = true)
        SettingSwitch(core, "Look at the app in front", "Lets me use what is on screen when you say this.", "agent", "context", default = true)
    }
    Group {
        SettingChoice(core, "Ask before acting", listOf("risky" to "Risky", "always" to "Every action", "full" to "Never ask"), "agent", "confirmMode", default = "risky")
    }
    LkCard(title = "Never learn from these apps") {
        LkField(excl, { excl = it }, placeholder = "Comma separated, part of the app name")
        LkButton("Save", { set(listOf("brain", "excludeApps"), JSONArray(excl.split(',').map { it.trim() }.filter { it.isNotEmpty() })) }, Modifier.fillMaxWidth(), kind = LkButtonKind.Quiet)
    }
    Group { LkRow("Forget the recent conversation", sub = "The saved memory stays.", onClick = { launch { core.call("bridge.voice.clearConversation"); core.notify("Conversation cleared") } }) }
    Note("Everything stays on this phone, except what you say to Gemini and what you send to a paired PC. Keys live in the Android Keystore.")
}

@Composable
fun TipsPage(onSetupAgain: () -> Unit) {
    OriginTips()
    LkButton("Run setup again", onSetupAgain, Modifier.fillMaxWidth(), kind = LkButtonKind.Quiet)
}

@Composable
fun OriginTips() {
    LkCard(title = "Keep me alive on OriginOS") {
        listOf(
            "Battery: no restrictions" to "Settings, Battery, Background power consumption, Lokey, No restrictions.",
            "Allow autostart" to "Settings, Apps, Autostart, turn Lokey on.",
            "Lock me in Recents" to "Open Recents, pull the Lokey card down (or tap its lock) so the cleaner leaves it alone.",
            "Notifications and floating windows" to "Settings, Notifications and status bar, Lokey: allow. Apps, Lokey, Permissions, Display over other apps: allow.",
        ).forEachIndexed { i, (t, b) ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("${i + 1}", color = Lk.colors.accent, style = Lk.type.num.copy(fontSize = androidx.compose.ui.unit.TextUnit(16f, androidx.compose.ui.unit.TextUnitType.Sp)))
                Column { Text(t, color = Lk.colors.text, style = Lk.type.rowTitle); Text(b, color = Lk.colors.muted, style = Lk.type.body) }
            }
        }
        Note("Menu names move a little between OriginOS versions; search Settings for \"autostart\" or \"background power\".")
    }
}

@Composable
fun AboutPage() {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 4.dp)) {
        Text("Lokey for Android  ${BuildConfig.VERSION_NAME}", color = Lk.colors.text, style = Lk.type.rowTitle)
        Text("A voice-first spirit for your phone. Open source (GPL-3.0). The same assistant, memory and spirit as on the PC; pair them to share memory and work.", color = Lk.colors.muted, style = Lk.type.body)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SpiritSettings(core: Core) {
    val s by core.settings.collectAsState()
    val set = rememberSet(core)
    val personalities = s.raw.at("loadout")?.optJSONArray("personalities")?.objects().orEmpty()
    val cur = s.raw.text("loadout", "personality", default = "chad")
    Box(Modifier.fillMaxWidth(), Alignment.Center) { SpiritView(SoulMode.LISTENING, s.skin, s.calmSpirit, 160.dp, {}) }
    LkCard(title = "Skin") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) { Parse.SKIN_NAME.forEach { (id, name) -> LkChip(name, s.skin == id, { set(listOf("loadout", "soul"), id) }) } }
    }
    if (personalities.isNotEmpty()) LkCard(title = "Personality") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) { personalities.forEach { p -> LkChip(p.str("name"), cur == p.str("id"), { set(listOf("loadout", "personality"), p.str("id")) }) } }
    }
}

/** Bond: what Lokey remembers about you */
@Composable
fun BondSettings(core: Core) {
    var tick by remember { mutableIntStateOf(0) }
    val facts by poll(tick) { core.call("bridge.memory.list") as? JSONArray }
    var add by remember { mutableStateOf("") }
    val launch = rememberLauncher()
    val list = facts?.objects().orEmpty().sortedWith(compareByDescending<JSONObject> { it.optBoolean("pinned") }.thenByDescending { it.optLong("updated") })
    LkCard(title = "Tell me something to remember") {
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp), Alignment.CenterVertically) {
            LkField(add, { add = it }, Modifier.weight(1f), placeholder = "I prefer short answers")
            LkButton("Add", { launch { core.call("bridge.memory.add", add.trim()); add = ""; tick++ } }, enabled = add.isNotBlank())
        }
    }
    if (facts != null && list.isEmpty()) LkEmpty("Nothing remembered yet", "Facts you tell me and things I learn show up here.", icon = LkIcons.Link)
    list.forEach { f ->
        val id = f.str("id")
        LkCard(padding = 12.dp) {
            Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(4.dp), Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    LkLabel(f.str("kind"))
                    Text(f.str("text"), color = Lk.colors.text, style = Lk.type.body)
                }
                LkIconButton(LkIcons.Pin, if (f.optBoolean("pinned")) "Unpin" else "Pin", { launch { core.call("bridge.memory.pin", id, !f.optBoolean("pinned")); tick++ } }, active = f.optBoolean("pinned"))
                LkIconButton(LkIcons.Trash, "Forget this", { launch { core.call("bridge.memory.remove", id); tick++ } })
            }
        }
    }
}

@Preview(widthDp = 380, heightDp = 900) @Composable
private fun SettingsPreview() = LkBoth {
    val core = remember { FakeCore() }
    Column(Modifier.heightIn(max = 880.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { VoiceSettings(core); AppearanceSettings(core) }
}
