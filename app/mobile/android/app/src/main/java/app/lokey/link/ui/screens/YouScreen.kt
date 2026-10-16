package app.lokey.link.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.lokey.link.core.Core
import app.lokey.link.core.FakeCore
import app.lokey.link.ui.kit.LkBoth
import app.lokey.link.ui.kit.LkButton
import app.lokey.link.ui.kit.LkCard
import app.lokey.link.ui.kit.LkDest
import app.lokey.link.ui.kit.LkIconDisc
import app.lokey.link.ui.kit.LkIcons
import app.lokey.link.ui.kit.LkRow
import app.lokey.link.ui.kit.LkSection
import app.lokey.link.ui.theme.Lk
import org.json.JSONObject

/** "Run setup again" from the OriginOS tips page */
val LocalSetupAgain = compositionLocalOf { {} }

private class Sec(val id: String, val title: String, val sub: String, val icon: ImageVector)
private val LIST: List<Pair<String, List<Sec>>> = listOf(
    "Your spirit" to listOf(
        Sec("spirit", "Spirit", "Skin and personality", LkIcons.Sparkle),
        Sec("bond", "Bond", "What I remember about you", LkIcons.Link),
    ),
    "How I listen and think" to listOf(
        Sec("voice", "Voice and language", "Gemini key, English, Tamil, Tanglish", LkIcons.Mic),
        Sec("wake", "Wake-up", "Claps and phrases", LkIcons.Wave),
        Sec("brain", "Brain and providers", "Models, keys, memory search", LkIcons.Chip),
    ),
    "On this phone" to listOf(
        Sec("island", "Island", "What it shows, haptics, background health", LkIcons.Island),
        Sec("appearance", "Appearance", "Theme, accent, text size, motion", LkIcons.Sliders),
        Sec("access", "Permissions and Android access", "Microphone, notifications, accessibility", LkIcons.Key),
        Sec("privacy", "Privacy", "Learning, screen access, approvals", LkIcons.Shield),
        Sec("shizuku", "Power tier (Shizuku)", "Optional: tasks on a hidden second screen", LkIcons.Bolt),
        Sec("tips", "OriginOS tips", "Keep Lokey alive in the background", LkIcons.Smartphone),
        Sec("about", "About", "Lokey for Android", LkIcons.Info),
    ),
)
private val TITLE = LIST.flatMap { it.second }.associate { it.id to it.title }

/** You: the profile and everything about how Lokey is set up, one sub page each (phone/You.tsx). */
@Composable
fun YouScreen(core: Core) {
    val nav = LocalNav.current
    val section = nav.section
    if (section != null && section in TITLE) {
        SubPage(TITLE.getValue(section), onBack = { nav.go(LkDest.You, null) }) { Sub(core, section) }
        return
    }
    val info by poll(section) { core.call("bridge.voice.info") as? JSONObject }
    val user by poll(Unit) { core.native("user.get") as? JSONObject }
    val hasKey = info?.optBoolean("hasKey")
    Page("You") {
        LkCard {
            Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(14.dp), Alignment.CenterVertically) {
                LkIconDisc(LkIcons.You)
                Column(Modifier.weight(1f)) {
                    Text(user?.optString("name")?.ifEmpty { null } ?: "Lokey", color = Lk.colors.text, style = Lk.type.title.copy(fontSize = androidx.compose.ui.unit.TextUnit(18f, androidx.compose.ui.unit.TextUnitType.Sp)))
                    Text(when (hasKey) { null -> " "; true -> "Gemini key saved. Hold to talk."; false -> "No Gemini key yet" }, color = if (hasKey == false) Lk.colors.warn else Lk.colors.muted, style = Lk.type.caption)
                }
                if (hasKey == false) LkButton("Add key", { nav.go(LkDest.You, "voice") })
            }
        }
        LIST.forEach { (head, items) ->
            LkSection(head) { items.forEach { LkRow(it.title, sub = it.sub, icon = it.icon, chevron = true, onClick = { nav.go(LkDest.You, it.id) }) } }
        }
    }
}

@Composable
private fun Sub(core: Core, id: String) {
    when (id) {
        "spirit" -> SpiritSettings(core)
        "bond" -> BondSettings(core)
        "voice" -> VoiceSettings(core)
        "wake" -> WakeSettings(core)
        "brain" -> BrainSettings(core)
        "appearance" -> AppearanceSettings(core)
        "island" -> IslandSettings(core)
        "access" -> AccessSettings(core)
        "privacy" -> PrivacySettings(core)
        "shizuku" -> ShizukuSettings(core)
        "tips" -> TipsPage(LocalSetupAgain.current)
        else -> AboutPage()
    }
}

@Preview(widthDp = 380, heightDp = 900) @Composable
private fun YouPreview() = LkBoth { Box(Modifier.heightIn(max = 880.dp)) { YouScreen(FakeCore()) } }
