package app.lokey.link.ui.home

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.lokey.link.core.ActivityKind
import app.lokey.link.core.Core
import app.lokey.link.core.FakeCore
import app.lokey.link.core.FocusTimer
import app.lokey.link.core.Media
import app.lokey.link.core.TimerStatus
import app.lokey.link.ui.kit.LkBoth
import app.lokey.link.ui.kit.LkButton
import app.lokey.link.ui.kit.LkButtonKind
import app.lokey.link.ui.kit.LkCard
import app.lokey.link.ui.kit.LkIconButton
import app.lokey.link.ui.kit.LkIconDisc
import app.lokey.link.ui.kit.LkIcons
import app.lokey.link.ui.kit.LkLabel
import app.lokey.link.ui.kit.LkSlider
import app.lokey.link.ui.kit.lkClickable
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LocalReducedMotion
import kotlinx.coroutines.delay

/** the amber of the timer ring and warnings on cards (phone/Today.tsx, cards.tsx) */
val Amber = Color(0xFFF5A524)

/** wall clock that ticks every [everyMs] while [active] (a screen that shows a countdown or a playing position) */
@Composable
fun rememberNow(active: Boolean, everyMs: Long = 1000): State<Long> =
    produceState(System.currentTimeMillis(), active) { while (true) { value = System.currentTimeMillis(); if (!active) break; delay(everyMs) } }

/** the activities that have a card of their own on Home (voice, job and approval already show in the transcript and the job chips) */
val CardKinds = listOf(ActivityKind.Charging, ActivityKind.Timer, ActivityKind.Music, ActivityKind.Reminder, ActivityKind.Pc)

@Composable
fun FaceCard(core: Core, kind: ActivityKind, modifier: Modifier = Modifier, onOpenPc: () -> Unit = {}) {
    when (kind) {
        ActivityKind.Timer -> TimerCard(core, modifier)
        ActivityKind.Music -> MusicCard(core, modifier)
        ActivityKind.Charging -> ChargingCard(core, modifier)
        ActivityKind.Reminder -> ReminderCard(core, modifier)
        ActivityKind.Pc -> PcCard(core, modifier, onOpenPc)
        else -> Unit
    }
}

/** The strip under the spirit on Home: one live activity as a single row with its main controls. Tap the text for the full card. */
@Composable
fun CompactFace(core: Core, kind: ActivityKind, modifier: Modifier = Modifier, onOpenPc: () -> Unit = {}, more: String? = null, onMore: () -> Unit = {}) {
    var full by remember { mutableStateOf(false) }
    val c = Lk.colors
    val row = app.lokey.link.ui.theme.LkShapes.Row
    Row(modifier.fillMaxWidth().clip(app.lokey.link.ui.theme.LkShapes.Card).background(c.fill1).padding(start = 12.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), Arrangement.spacedBy(12.dp), Alignment.CenterVertically) {
        when (kind) {
            ActivityKind.Timer -> {
                val t by core.timer.collectAsState()
                val now by rememberNow(t.status == TimerStatus.Running)
                val done = t.status == TimerStatus.Done
                Ring(FocusTimer.ring(t, now), 44, 5f, if (done) c.ok else Amber)
                Column(Modifier.weight(1f).clip(row).lkClickable({ full = true }, row)) {
                    Text(if (done) "Timer done" else FocusTimer.clock(FocusTimer.remaining(t, now)), color = c.text, style = Lk.type.num.copy(fontSize = 20.sp))
                    Text(if (t.status == TimerStatus.Paused) "Paused" else "Focus", color = c.muted, style = Lk.type.caption)
                }
                if (!done) LkIconButton(if (t.status == TimerStatus.Running) LkIcons.Pause else LkIcons.Play, if (t.status == TimerStatus.Running) "Pause the timer" else "Resume the timer", { if (t.status == TimerStatus.Running) core.timerPause() else core.timerStart(1) })
                LkIconButton(LkIcons.Stop, "Stop the timer", core::timerReset)
                if (full) app.lokey.link.ui.kit.LkSheet("Timer", { full = false }) { TimerCard(core) }
            }
            ActivityKind.Music -> {
                val m by core.media.collectAsState()
                val media = m ?: Media()
                val art = remember(media.art) { decodeArt(media.art) }
                Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(c.fill2)) { if (art != null) Image(art, null, Modifier.size(44.dp), contentScale = ContentScale.Crop) }
                Column(Modifier.weight(1f).clip(row).lkClickable({ full = true }, row)) {
                    Text(media.title.ifEmpty { "Unknown title" }, color = c.text, style = Lk.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(media.artist.ifEmpty { media.app }, color = c.muted, style = Lk.type.caption, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                LkIconButton(if (media.playing) LkIcons.Pause else LkIcons.Play, if (media.playing) "Pause" else "Play", { core.mediaControl("toggle") }, active = true)
                LkIconButton(LkIcons.Next, "Next", { core.mediaControl("next") }, enabled = media.canNext)
                if (full) app.lokey.link.ui.kit.LkSheet("Now playing", { full = false }) { MusicCard(core) }
            }
            ActivityKind.Reminder -> {
                val due by core.due.collectAsState()
                val d = due.firstOrNull()
                LkIconDisc(LkIcons.Bell)
                Column(Modifier.weight(1f)) {
                    Text(d?.title ?: "Reminder", color = c.text, style = Lk.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text((if (d?.kind == app.lokey.link.core.TodayKind.Loop) "You said you would" else "Reminder") + if (due.size > 1) "  1 of ${due.size}" else "", color = c.muted, style = Lk.type.caption)
                }
                if (d != null) { LkIconButton(LkIcons.Timer, "Snooze 10 minutes", { core.snoozeDue(d.id) }); LkIconButton(LkIcons.Check, "Done", { core.dismissDue(d.id) }, active = true) }
            }
            ActivityKind.Pc -> {
                val pc by core.pc.collectAsState()
                LkIconDisc(LkIcons.Pc)
                Column(Modifier.weight(1f)) {
                    Text(pc.name.ifEmpty { "Your PC" }, color = c.text, style = Lk.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(if (pc.connected) "Connected" + (pc.playing?.let { " - $it" } ?: "") else "Not reachable (same Wi-Fi?)", color = if (pc.connected) c.ok else c.muted, style = Lk.type.caption, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                LkIconButton(LkIcons.Chevron, "Open the PC page", onOpenPc)
            }
            ActivityKind.Charging -> {
                val f by core.flash.collectAsState()
                LkIconDisc(LkIcons.Bolt)
                Column(Modifier.weight(1f)) {
                    Text(f?.text.orEmpty(), color = if (f?.low == true) c.bad else c.ok, style = Lk.type.num.copy(fontSize = 20.sp))
                    Text(if (f?.low == true) "Low battery" else "Charging", color = c.muted, style = Lk.type.caption)
                }
            }
            else -> Unit
        }
        if (more != null) Box(Modifier.size(width = 48.dp, height = 48.dp).clip(CircleShape).lkClickable(onMore, CircleShape).semantics { contentDescription = "Next activity, $more" }, Alignment.Center) {
            Text(more, color = c.muted, style = Lk.type.numSmall)
        }
    }
}

@Composable
fun Ring(fraction: Float, size: Int, stroke: Float, color: Color, modifier: Modifier = Modifier, content: @Composable () -> Unit = {}) {
    val track = Lk.colors.fill3
    Box(modifier.size(size.dp), Alignment.Center) {
        Canvas(Modifier.size(size.dp)) {
            val w = stroke.dp.toPx()
            val s = Size(this.size.width - w, this.size.height - w)
            val tl = androidx.compose.ui.geometry.Offset(w / 2, w / 2)
            drawArc(track, -90f, 360f, false, tl, s, style = Stroke(w, cap = StrokeCap.Round))
            if (fraction > 0f) drawArc(color, -90f, 360f * fraction.coerceIn(0f, 1f), false, tl, s, style = Stroke(w, cap = StrokeCap.Round))
        }
        content()
    }
}

@Composable
fun TimerCard(core: Core, modifier: Modifier = Modifier) {
    val t by core.timer.collectAsState()
    val now by rememberNow(t.status == TimerStatus.Running)
    val done = t.status == TimerStatus.Done
    val label = if (done) "Timer done" else "Timer, ${FocusTimer.clock(FocusTimer.remaining(t, now))} left"
    LkCard(modifier, title = "Timer", padding = 14.dp) {
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(16.dp), Alignment.CenterVertically) {
            Ring(FocusTimer.ring(t, now), 96, 7f, if (done) Lk.colors.ok else Amber, Modifier.semantics { contentDescription = label }) {
                Text(if (done) "Done" else FocusTimer.clock(FocusTimer.remaining(t, now)), color = Lk.colors.text, style = Lk.type.num.copy(fontSize = if (done) 15.sp else 20.sp))
            }
            Column(Modifier.weight(1f), Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (!done) LkButton(if (t.status == TimerStatus.Running) "Pause" else "Resume", { if (t.status == TimerStatus.Running) core.timerPause() else core.timerStart(1) }, Modifier.weight(1f), icon = if (t.status == TimerStatus.Running) LkIcons.Pause else LkIcons.Play)
                    LkIconButton(LkIcons.Stop, "Stop the timer", core::timerReset)
                }
                LkButton("+1 min", core::timerPlusMinute, Modifier.fillMaxWidth(), kind = LkButtonKind.Quiet)
            }
        }
    }
}

private fun decodeArt(url: String?) = url?.takeIf { it.startsWith("data:") && "," in it }?.let {
    try { val b = Base64.decode(it.substringAfter(','), Base64.DEFAULT); BitmapFactory.decodeByteArray(b, 0, b.size)?.asImageBitmap() } catch (_: Exception) { null }
}

@Composable
fun MusicCard(core: Core, modifier: Modifier = Modifier) {
    val m by core.media.collectAsState()
    val media = m ?: Media()
    val now by rememberNow(media.playing, 500)
    var drag by remember { mutableStateOf<Float?>(null) }
    val art = remember(media.art) { decodeArt(media.art) }
    val frac = drag ?: if (media.durationMs > 0) (media.positionAt(now).toFloat() / media.durationMs).coerceIn(0f, 1f) else 0f
    LkCard(modifier, title = "Now playing", padding = 14.dp) {
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(12.dp), Alignment.CenterVertically) {
            Box(Modifier.size(56.dp).clip(RoundedCornerShape(14.dp)).background(Lk.colors.fill2)) { if (art != null) Image(art, null, Modifier.size(56.dp), contentScale = ContentScale.Crop) }
            Column(Modifier.weight(1f)) {
                Text(media.title.ifEmpty { "Unknown title" }, color = Lk.colors.text, style = Lk.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(media.artist.ifEmpty { media.app }, color = Lk.colors.muted, style = Lk.type.caption, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (media.durationMs > 0) {
            Column {
                LkSlider(frac, { drag = it }, "Seek", onValueChangeFinished = { drag?.let { f -> core.mediaSeek((f * media.durationMs).toLong()) }; drag = null })
                Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), Arrangement.SpaceBetween) {
                    Text(FocusTimer.clock(((drag ?: frac) * media.durationMs).toLong()), color = Lk.colors.muted, style = Lk.type.numSmall)
                    Text(FocusTimer.clock(media.durationMs), color = Lk.colors.muted, style = Lk.type.numSmall)
                }
            }
        }
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(20.dp, Alignment.CenterHorizontally), Alignment.CenterVertically) {
            LkIconButton(LkIcons.Prev, "Previous", { core.mediaControl("prev") }, enabled = media.canPrev)
            LkIconButton(if (media.playing) LkIcons.Pause else LkIcons.Play, if (media.playing) "Pause" else "Play", { core.mediaControl("toggle") }, active = true)
            LkIconButton(LkIcons.Next, "Next", { core.mediaControl("next") }, enabled = media.canNext)
        }
    }
}

@Composable
fun ChargingCard(core: Core, modifier: Modifier = Modifier) {
    val f by core.flash.collectAsState()
    val flash = f ?: return
    LkCard(modifier.semantics(mergeDescendants = true) {}, padding = 12.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            LkIconDisc(LkIcons.Bolt)
            Column(Modifier.weight(1f)) {
                LkLabel(if (flash.low) "Low battery" else "Charging")
                Text(flash.text, color = if (flash.low) Lk.colors.bad else Lk.colors.ok, style = Lk.type.num.copy(fontSize = 20.sp))
            }
        }
    }
}

@Composable
fun ReminderCard(core: Core, modifier: Modifier = Modifier) {
    val due by core.due.collectAsState()
    val d = due.firstOrNull() ?: return
    LkCard(modifier, padding = 14.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            LkIconDisc(LkIcons.Bell)
            Column(Modifier.weight(1f)) {
                LkLabel((if (d.kind == app.lokey.link.core.TodayKind.Loop) "You said you would" else "Reminder") + if (due.size > 1) "  1 of ${due.size}" else "")
                Text(d.title, color = Lk.colors.text, style = Lk.type.rowTitle)
                if (d.sub.isNotEmpty()) Text(d.sub, color = Lk.colors.muted, style = Lk.type.caption)
            }
        }
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
            LkButton("Snooze 10 min", { core.snoozeDue(d.id) }, Modifier.weight(1f), kind = LkButtonKind.Quiet)
            LkButton("Done", { core.dismissDue(d.id) }, Modifier.weight(1f), icon = LkIcons.Check)
        }
    }
}

@Composable
fun PcCard(core: Core, modifier: Modifier = Modifier, onOpen: () -> Unit) {
    val pc by core.pc.collectAsState()
    LkCard(modifier, padding = 12.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            LkIconDisc(LkIcons.Pc)
            Column(Modifier.weight(1f)) {
                Text(pc.name.ifEmpty { "Your PC" }, color = Lk.colors.text, style = Lk.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (pc.connected) "Connected" + (pc.playing?.let { " - $it" } ?: "") else "Not reachable (same Wi-Fi?)", color = if (pc.connected) Lk.colors.ok else Lk.colors.muted, style = Lk.type.caption, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            LkButton("Open", onOpen, kind = LkButtonKind.Quiet)
        }
    }
}

@Preview(widthDp = 380) @Composable
private fun FaceCardsPreview() = LkBoth {
    val core = remember { FakeCore() }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { TimerCard(core); MusicCard(core); ReminderCard(core); PcCard(core, onOpen = {}) }
}
