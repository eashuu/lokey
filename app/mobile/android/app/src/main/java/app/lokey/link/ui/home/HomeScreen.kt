package app.lokey.link.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.ui.graphics.compositeOver
import app.lokey.link.core.Activity
import app.lokey.link.core.ActivityKind
import app.lokey.link.core.ChatMsg
import app.lokey.link.core.Core
import app.lokey.link.core.DictPhase
import app.lokey.link.core.FakeCore
import app.lokey.link.core.Job
import app.lokey.link.core.JobStatus
import app.lokey.link.core.MsgKind
import app.lokey.link.core.VoiceState
import app.lokey.link.core.spiritMode
import app.lokey.link.ui.kit.LkApprovalCard
import app.lokey.link.ui.kit.LkBoth
import app.lokey.link.ui.kit.LkButton
import app.lokey.link.ui.kit.LkDest
import app.lokey.link.ui.kit.LkButtonKind
import app.lokey.link.ui.kit.LkCard
import app.lokey.link.ui.kit.LkIconButton
import app.lokey.link.ui.kit.LkIconDisc
import app.lokey.link.ui.kit.LkIcons
import app.lokey.link.ui.kit.LkSheet
import app.lokey.link.ui.kit.LkSlider
import app.lokey.link.ui.kit.lkClickable
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkShapes
import kotlinx.coroutines.launch
import org.json.JSONObject

private val STATUS = mapOf(
    VoiceState.Idle to "Hold the button and talk", VoiceState.Connecting to "Connecting...", VoiceState.Listening to "Listening...",
    VoiceState.Thinking to "Thinking...", VoiceState.Speaking to "Speaking...", VoiceState.Error to "Something went wrong",
)
private val SUGGEST = listOf("What can you do?", "Set a timer for 10 minutes", "Play some music", "Who messaged me?")

/** Home: the spirit, what the assistant is doing, the transcript, quick actions and the talk controls (phone/Home.tsx). */
@Composable
fun HomeScreen(core: Core, booting: Boolean = false) {
    val assistant by core.assistant.collectAsState()
    val msgs by core.messages.collectAsState()
    val approvals by core.approvals.collectAsState()
    val dictation by core.dictation.collectAsState()
    val jobs by core.jobs.collectAsState()
    val activities by core.activities.collectAsState()
    val settings by core.settings.collectAsState()
    val haptic = LocalHapticFeedback.current
    val nav = app.lokey.link.ui.screens.LocalNav.current
    fun tick(heavy: Boolean = false) { if (settings.haptics) haptic.performHapticFeedback(if (heavy) HapticFeedbackType.LongPress else HapticFeedbackType.TextHandleMove) }
    var text by remember { mutableStateOf("") }
    val list = rememberLazyListState()
    LaunchedEffect(msgs.size, approvals.size) { val n = msgs.size + approvals.size; if (n > 0) list.animateScrollToItem(n - 1) }
    val talking = assistant.state == VoiceState.Listening
    val submit = { if (text.isNotBlank()) { tick(); core.say(text); text = "" } }

    Column(Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val s = minOf(maxHeight.value * 0.2f, 190f).coerceAtLeast(110f).let { if (maxHeight.value.isFinite()) it else 200f }
            Box(Modifier.fillMaxWidth(), Alignment.Center) {
                SpiritView(spiritMode(assistant.state, dictation?.phase), settings.skin, settings.calmSpirit, s.dp, { on -> tick(true); core.hold(on) })
            }
        }
        val statusText = when {
            booting -> "Starting..."
            assistant.convo && assistant.state == VoiceState.Idle -> "Conversation mode: just talk"
            else -> STATUS[assistant.state].orEmpty()
        }
        Text(statusText, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).semantics { liveRegion = LiveRegionMode.Polite },
            color = if (assistant.state == VoiceState.Error) Lk.colors.warn else Lk.colors.muted, style = Lk.type.body.copy(fontSize = 13.sp), textAlign = TextAlign.Center)
        val cards = activities.map { it.kind }.filter { it in CardKinds }
        var pick by remember { mutableStateOf<ActivityKind?>(null) }
        val shown = pick?.takeIf { it in cards } ?: cards.firstOrNull()
        if (shown != null) {
            CompactFace(core, shown, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), onOpenPc = { nav.go(LkDest.Pc, null) },
                more = if (cards.size > 1) "${cards.indexOf(shown) + 1}/${cards.size}" else null, onMore = { pick = cards[(cards.indexOf(shown) + 1) % cards.size] })
        }
        JobChips(jobs.filter { it.status == JobStatus.Running }, core::stopJob)

        LazyColumn(Modifier.weight(1f).heightIn(min = 160.dp).fillMaxWidth(), list, contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (msgs.isEmpty() && approvals.isEmpty()) item { Box(Modifier.fillParentMaxHeight(), Alignment.Center) { Empty(core::say) } }
            items(msgs, key = { it.id }) { Bubble(it) }
            items(approvals, key = { it.id }) { a ->
                LkApprovalCard(a.title, a.detail, { tick(); core.answerApproval(a, false) }, { tick(true); core.answerApproval(a, true) }, source = if (a.source == app.lokey.link.core.ApprovalSource.Pc) "PC" else "Lokey")
            }
            dictation?.let { d -> item { DictationCard(d.phase, d.raw, d.text, core::dismissDictation) } }
        }

        Column(Modifier.fillMaxWidth().padding(top = 6.dp, bottom = 6.dp), Arrangement.spacedBy(10.dp)) {
            QuickActions(core)
            Column(Modifier.padding(horizontal = 12.dp), Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(CircleShape).background(Lk.colors.fill2).padding(start = 18.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    BasicTextField(text, { text = it }, Modifier.weight(1f).heightIn(min = 48.dp).padding(vertical = 14.dp).semantics { contentDescription = "Ask or tell Lokey something" },
                        textStyle = Lk.type.body.copy(color = Lk.colors.text, fontSize = 16.sp), cursorBrush = SolidColor(Lk.colors.accent), singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send), keyboardActions = KeyboardActions(onSend = { submit() }),
                        decorationBox = { inner -> Box(contentAlignment = Alignment.CenterStart) { if (text.isEmpty()) Text("Ask or tell me something...", color = Lk.colors.dim, style = Lk.type.body); inner() } })
                    LkIconButton(LkIcons.Send, "Send", { submit() }, active = text.isNotBlank(), enabled = text.isNotBlank())
                }
                Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(10.dp), Alignment.CenterVertically) {
                    RoundButton(LkIcons.Chat, "Conversation mode", assistant.convo) { tick(true); core.toggleConversation() }
                    HoldToTalk(talking, Modifier.weight(1f), onHold = { on -> if (on) tick(true); core.hold(on) }, onToggleConvo = { core.toggleConversation() })
                    RoundButton(LkIcons.Stop, "Stop everything", false) { tick(); core.stopAll() }
                }
            }
        }
    }
}

@Composable
private fun RoundButton(icon: androidx.compose.ui.graphics.vector.ImageVector, desc: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(56.dp).clip(CircleShape).background(if (on) Lk.colors.accentSoft else Lk.colors.fill2).lkClickable(onClick, CircleShape, press = 0.92f).semantics { contentDescription = desc; stateDescription = if (on) "On" else "Off" },
        Alignment.Center,
    ) { app.lokey.link.ui.kit.LkIcon(icon, null, tint = if (on) Lk.colors.accent else Lk.colors.text, size = 22) }
}

/** press and hold = talk. TalkBack users double-tap to start or stop hands-free conversation instead. */
@Composable
private fun HoldToTalk(talking: Boolean, modifier: Modifier, onHold: (Boolean) -> Unit, onToggleConvo: () -> Unit) {
    val c = Lk.colors
    Row(
        modifier.heightIn(min = 64.dp).clip(CircleShape).background(if (talking) c.accent else c.accentSoft.compositeOver(c.fill2))
            .pointerInput(Unit) { detectTapGestures(onPress = { onHold(true); try { tryAwaitRelease() } finally { onHold(false) } }) }
            .semantics { role = Role.Button; contentDescription = "Hold to talk"; onClick("Start or stop conversation mode") { onToggleConvo(); true } },
        Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally), Alignment.CenterVertically,
    ) {
        app.lokey.link.ui.kit.LkIcon(LkIcons.Mic, null, tint = if (talking) c.accentInk else c.text, size = 22)
        Text(if (talking) "Listening..." else "Hold to talk", color = if (talking) c.accentInk else c.text, style = Lk.type.button.copy(fontSize = 16.sp))
    }
}

@Composable
private fun JobChips(jobs: List<Job>, stop: (String) -> Unit) {
    if (jobs.isEmpty()) return
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), Arrangement.spacedBy(8.dp)) {
        jobs.forEach { j ->
            Row(Modifier.widthIn(max = 280.dp).heightIn(min = 48.dp).clip(CircleShape).background(Lk.colors.accentSoft).padding(start = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f, fill = false)) {
                    Text(j.title, color = Lk.colors.text, style = Lk.type.button, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (j.line.isNotEmpty()) Text(j.line, color = Lk.colors.muted, style = Lk.type.caption, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                LkIconButton(LkIcons.Close, "Stop ${j.title}", { stop(j.id) })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Empty(send: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), Arrangement.spacedBy(10.dp), Alignment.CenterHorizontally) {
        Text("Hold the mic and talk, or type. Poke the spirit, long-press it to talk. The island at the top works from any app.", Modifier.widthIn(max = 300.dp), color = Lk.colors.muted, style = Lk.type.body, textAlign = TextAlign.Center)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally)) {
            SUGGEST.forEach { s ->
                Box(Modifier.heightIn(min = 48.dp).clip(CircleShape).background(Lk.colors.fill2).lkClickable({ send(s) }, CircleShape).padding(horizontal = 14.dp), Alignment.Center) {
                    Text(s, color = Lk.colors.soft, style = Lk.type.caption)
                }
            }
        }
    }
}

@Composable
private fun Bubble(m: ChatMsg) {
    val c = Lk.colors
    when (m.kind) {
        MsgKind.Notice, MsgKind.Error -> Text(m.text, Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp), color = if (m.kind == MsgKind.Error) c.warn else c.muted, style = Lk.type.caption, textAlign = TextAlign.Center)
        else -> {
            val said = m.kind == MsgKind.Said
            Row(Modifier.fillMaxWidth(), if (said) Arrangement.End else Arrangement.Start) {
                Text(
                    m.text,
                    Modifier.widthIn(max = 300.dp).clip(RoundedCornerShape(22.dp, 22.dp, if (said) 6.dp else 22.dp, if (said) 22.dp else 6.dp))
                        .background(if (said) c.accent else c.fill2).padding(horizontal = 14.dp, vertical = 10.dp),
                    color = (if (said) c.accentInk else c.text).copy(alpha = if (m.final) 1f else 0.8f), style = Lk.type.body.copy(fontSize = 15.sp, lineHeight = 21.sp),
                )
            }
        }
    }
}

@Composable
private fun DictationCard(phase: DictPhase, raw: String, text: String, dismiss: () -> Unit) {
    LkCard(title = "Dictation", right = { LkIconButton(LkIcons.Close, "Dismiss dictation", dismiss) }, padding = 14.dp) {
        Text(when (phase) { DictPhase.Listening -> raw.ifEmpty { "Listening..." }; DictPhase.Working -> "Cleaning it up..."; else -> text },
            color = if (phase == DictPhase.Error) Lk.colors.warn else Lk.colors.text, style = Lk.type.body)
    }
}

@Preview(widthDp = 380, heightDp = 800) @Composable
private fun HomePreview() = LkBoth { Box(Modifier.heightIn(max = 780.dp)) { HomeScreen(FakeCore()) } }

@Preview(widthDp = 380, heightDp = 800) @Composable
private fun HomeEmptyPreview() = LkBoth { Box(Modifier.heightIn(max = 780.dp)) { HomeScreen(FakeCore(FakeCore.Scenario.Empty)) } }
