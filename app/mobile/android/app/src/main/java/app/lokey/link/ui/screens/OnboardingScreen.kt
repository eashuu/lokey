package app.lokey.link.ui.screens

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.lokey.link.core.Core
import app.lokey.link.core.FakeCore
import app.lokey.link.core.Lang
import app.lokey.link.core.Perm
import app.lokey.link.core.SoulMode
import app.lokey.link.ui.home.SpiritView
import app.lokey.link.ui.kit.LkBoth
import app.lokey.link.ui.kit.LkButton
import app.lokey.link.ui.kit.LkButtonKind
import app.lokey.link.ui.kit.LkCard
import app.lokey.link.ui.kit.LkField
import app.lokey.link.ui.kit.LkIconButton
import app.lokey.link.ui.kit.LkIcons
import app.lokey.link.ui.kit.LkTextButton
import app.lokey.link.ui.kit.lkClickable
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkMotion
import app.lokey.link.ui.theme.LocalReducedMotion

internal enum class Step(val optional: Boolean) { Welcome(false), Key(true), Language(false), Perms(true), Outside(true), Island(true), Pair(true), Tips(false) }

/**
 * First run: meet the spirit, add the Gemini key, pick a language, then the real permission flow (microphone, notifications, overlay, notification access,
 * accessibility with the restricted-settings hint, battery, autostart), pairing and the OriginOS tips. Everything but the language is skippable;
 * only the microphone is needed to talk. Permissions open the exact Android screen and the list re-checks when you come back.
 */
@Composable
fun OnboardingScreen(core: Core, onDone: () -> Unit, initialStep: Int = 0) {
    var i by remember { mutableIntStateOf(initialStep) }
    val step = Step.entries[i]
    val s by core.settings.collectAsState()
    val reduced = LocalReducedMotion.current
    var key by remember { mutableStateOf("") }
    var hasKey by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val launch = rememberLauncher()
    androidx.compose.runtime.LaunchedEffect(Unit) { hasKey = (try { core.call("bridge.voice.info") as? org.json.JSONObject } catch (_: Exception) { null })?.optBoolean("hasKey") == true }
    val vivo = remember { app.lokey.link.VivoIsland.isVivoDevice() }
    val next = { if (i < Step.entries.size - 1) { i++; if (Step.entries[i] == Step.Island && !vivo) i++ } else onDone() }   // the island check is for vivo / iQOO only

    Column(Modifier.fillMaxSize().background(Lk.colors.bg).windowInsetsPadding(WindowInsets.safeDrawing)) {
        Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(72.dp)) { if (i > 0) LkIconButton(LkIcons.Back, "Back", { i-- }) }
            Row(Modifier.weight(1f), Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), Alignment.CenterVertically) {
                Step.entries.forEachIndexed { n, _ -> Box(Modifier.width(if (n == i) 22.dp else 7.dp).height(7.dp).clip(CircleShape).background(if (n <= i) Lk.colors.accent else Lk.colors.fill4)) }
            }
            Box(Modifier.width(72.dp), Alignment.CenterEnd) { if (step.optional) LkTextButton("Skip", { next() }, tone = Lk.colors.muted) }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            AnimatedContent(step, transitionSpec = {
                if (reduced) fadeIn(snap0()) togetherWith fadeOut(snap0())
                else (fadeIn(LkMotion.enter(false)) + slideInHorizontally(LkMotion.enter(false)) { it / 12 }) togetherWith (fadeOut(LkMotion.enter(false)) + slideOutHorizontally(LkMotion.enter(false)) { -it / 12 })
            }, label = "step") { st ->
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp), Arrangement.spacedBy(14.dp)) {
                    when (st) {
                        Step.Welcome -> {
                            Heading("Meet your spirit", "Lokey lives at the top of your screen. Talk to it, ask it for things, and it gets better the more you use it.")
                            Box(Modifier.fillMaxWidth().height(230.dp), Alignment.Center) { SpiritView(SoulMode.LISTENING, s.skin, s.calmSpirit, 220.dp, {}) }
                            Text("Tap the island to open it. Long-press the spirit to talk, double-tap the island for conversation mode.", color = Lk.colors.muted, style = Lk.type.body)
                        }
                        Step.Key -> {
                            Heading("Add your Gemini key", "The voice runs on Google's Gemini. A free key from aistudio.google.com/apikey takes a minute, and it never leaves this phone except to talk to Google.")
                            if (hasKey) Text("A key is already saved.", color = Lk.colors.ok, style = Lk.type.rowTitle)
                            else {
                                LkField(key, { key = it.trim() }, label = "AI Studio key", placeholder = "AIza...", visualTransformation = PasswordVisualTransformation())
                                if (msg.isNotEmpty()) Text(msg, color = if (msg.startsWith("Saved")) Lk.colors.ok else Lk.colors.warn, style = Lk.type.caption)
                            }
                        }
                        Step.Language -> {
                            Heading("How do you talk?", "Pick how I answer and how dictation writes. You can change it any time in You, Voice.")
                            val cur = Lang.of(s.raw.text("voice", "language", default = "auto"), s.raw.text("voice", "dictationScript", default = "mixed"))
                            Lang.entries.forEach { l -> LangCard(l, l == cur) { launch { core.patchSettings(l.patch()) } } }
                        }
                        Step.Perms -> {
                            Heading("Let me work", "Each one opens an Android screen; come back here when you are done. Only the microphone is needed to talk.")
                            PermissionList(core, Perm.Core)
                        }
                        Step.Outside -> {
                            Heading("Works outside the app", "The island, wake-up and your PC link keep running when Lokey is closed, if Android lets them. These switches decide that.")
                            PermissionList(core, Perm.Extra)
                        }
                        Step.Island -> {
                            Heading("Island check", "On vivo, OriginOS can show Lokey in its own island around the camera. Let's see whether it does on this phone.")
                            IslandCheckBody(core, next)
                        }
                        Step.Pair -> {
                            Heading("Pair with my PC", "Optional. On the PC open Lokey, Settings, Devices, Pair a phone, then type what it shows. Needs the same Wi-Fi.")
                            PairForm(core)
                        }
                        Step.Tips -> {
                            Heading("One last thing", "Phones stop background apps aggressively. These switches keep Lokey listening.")
                            OriginTips()
                        }
                    }
                }
            }
        }
        val primary = when (step) { Step.Welcome -> "Get started"; Step.Key -> if (hasKey) "Continue" else "Save key"; Step.Tips -> "Finish"; else -> "Continue" }
        LkButton(primary, {
            if (step == Step.Key && !hasKey) launch { busy = true; val ok = core.call("bridge.voice.setKey", key) == true; busy = false; if (ok) { hasKey = true; key = ""; msg = "Saved on this phone."; next() } else msg = "That does not look like an AI Studio key (it starts with AIza)." }
            else next()
        }, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), enabled = !busy && !(step == Step.Key && !hasKey && key.length < 20))
    }
}

private fun snap0() = androidx.compose.animation.core.snap<Float>()

@Composable
private fun Heading(title: String, sub: String) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, Modifier.semantics { heading() }, color = Lk.colors.text, style = Lk.type.pageTitle)
        Text(sub, color = Lk.colors.muted, style = Lk.type.body.copy(lineHeight = androidx.compose.ui.unit.TextUnit(22f, androidx.compose.ui.unit.TextUnitType.Sp)))
    }
}

@Composable
private fun LangCard(l: Lang, on: Boolean, pick: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().heightIn(min = 72.dp).clip(app.lokey.link.ui.theme.LkShapes.Card).background(if (on) Lk.colors.accentSoft else Lk.colors.fill1)
            .lkClickable(pick, app.lokey.link.ui.theme.LkShapes.Card).padding(horizontal = 16.dp, vertical = 12.dp),
        Arrangement.Center,
    ) {
        Text(l.title, color = if (on) Lk.colors.accent else Lk.colors.text, style = Lk.type.rowTitle)
        Text(l.sub, color = Lk.colors.muted, style = Lk.type.caption)
    }
}

@Preview(widthDp = 380, heightDp = 800) @Composable
private fun OnboardingPreview() = LkBoth { Box(Modifier.heightIn(max = 780.dp)) { OnboardingScreen(FakeCore(FakeCore.Scenario.Empty), onDone = {}) } }
