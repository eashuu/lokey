package app.lokey.link.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.lokey.link.core.Core
import app.lokey.link.core.FocusTimer
import app.lokey.link.core.FakeCore
import app.lokey.link.core.Fmt
import app.lokey.link.core.NativeResult
import app.lokey.link.core.TimerStatus
import app.lokey.link.core.TodayKind
import app.lokey.link.core.objects
import app.lokey.link.core.str
import app.lokey.link.ui.home.Amber
import app.lokey.link.ui.home.Ring
import app.lokey.link.ui.home.rememberNow
import app.lokey.link.ui.kit.LkBoth
import app.lokey.link.ui.kit.LkButton
import app.lokey.link.ui.kit.LkButtonKind
import app.lokey.link.ui.kit.LkCard
import app.lokey.link.ui.kit.LkChip
import app.lokey.link.ui.kit.LkDest
import app.lokey.link.ui.kit.LkIconButton
import app.lokey.link.ui.kit.LkIcons
import app.lokey.link.ui.kit.lkClickable
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkShapes
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

private val PRESETS = listOf(5, 10, 15, 25, 45)
private fun hm(t: Long) = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(t))

/** Today: the next calendar events, reminders, things you said you would do, the focus timer and your wake phrases (phone/Today.tsx). */
@Composable
fun TodayScreen(core: Core) {
    val now by rememberNow(true, 30_000)
    Page("Today", line = java.text.SimpleDateFormat("EEEE, d MMMM", java.util.Locale.getDefault()).format(Date(now))) {
        Agenda(core, now)
        Reminders(core, now)
        Loops(core)
        Focus(core)
        Routines(core)
    }
}

@Composable
private fun Agenda(core: Core, now: Long) {
    var tick by remember { mutableIntStateOf(0) }
    val r by poll(tick) { core.native("calendar.list", JSONObject().put("fromMs", System.currentTimeMillis()).put("toMs", System.currentTimeMillis() + 3 * 86_400_000L).put("limit", 8)) }
    val launch = rememberLauncher()
    LkCard(title = "Up next") {
        val res = r
        when {
            res == null -> Text("Checking your calendar...", color = Lk.colors.muted, style = Lk.type.body)
            res !is JSONArray -> {
                val perm = NativeResult.needsPerm(res)
                Text(if (perm != null) "Allow calendar access to see your next events." else NativeResult.reason(res) ?: "Could not read the calendar.", color = Lk.colors.soft, style = Lk.type.body)
                if (perm != null) LkButton("Allow calendar", { launch { core.native("perm.request", JSONObject().put("name", perm)); tick++ } })
            }
            res.length() == 0 -> Text("Nothing in the next three days.", color = Lk.colors.muted, style = Lk.type.body)
            else -> res.objects().forEach { e ->
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), Arrangement.spacedBy(12.dp), Alignment.CenterVertically) {
                    Box(Modifier.width(4.dp).fillMaxHeight().heightIn(min = 36.dp).clip(RoundedCornerShape(2.dp)).background(Lk.colors.accent))
                    Column(Modifier.weight(1f)) {
                        Text(e.str("title"), color = Lk.colors.text, style = Lk.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val start = e.optLong("startMs"); val end = e.optLong("endMs", 0)
                        Text(Fmt.dayWord(start, now) + " - " + (if (e.optBoolean("allDay")) "all day" else hm(start) + if (end > 0) " - ${hm(end)}" else "") + (e.str("location").takeIf { it.isNotEmpty() }?.let { " - $it" } ?: ""), color = Lk.colors.muted, style = Lk.type.caption)
                    }
                }
            }
        }
    }
}

@Composable
private fun Reminders(core: Core, now: Long) {
    var tick by remember { mutableIntStateOf(0) }
    val r by poll(tick) { core.native("reminder.list") }
    val tasks by core.today.collectAsState()
    val rows = (r as? JSONArray ?: (r as? JSONObject)?.optJSONArray("reminders"))?.objects().orEmpty().filter { !it.str("id").startsWith("task-") }
    val pending = tasks.filter { it.kind == TodayKind.Task }
    val launch = rememberLauncher()
    LkCard(title = "Reminders and scheduled") {
        if (rows.isEmpty() && pending.isEmpty()) Text("None. Say \"remind me to call Amma at 6\", or \"open Netflix at 7pm\".", color = Lk.colors.muted, style = Lk.type.body)
        rows.sortedBy { it.optLong("at", it.optLong("time")) }.forEach { x ->
            val title = x.str("title").ifEmpty { x.str("text").ifEmpty { "Reminder" } }
            val at = x.optLong("at", x.optLong("time"))
            Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(10.dp), Alignment.CenterVertically) {
                app.lokey.link.ui.kit.LkIcon(LkIcons.Timer, null, tint = Lk.colors.accentText, size = 16)
                Column(Modifier.weight(1f)) {
                    Text(title, color = Lk.colors.text, style = Lk.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (at > 0) Text(Fmt.dayWord(at, now) + " - " + hm(at), color = Lk.colors.muted, style = Lk.type.caption)
                }
                LkIconButton(LkIcons.Close, "Cancel $title", { launch { core.native("reminder.cancel", JSONObject().put("id", x.str("id"))); tick++ } }, quiet = true)
            }
        }
        pending.forEach { t ->
            Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(10.dp), Alignment.CenterVertically) {
                app.lokey.link.ui.kit.LkIcon(LkIcons.Sparkle, null, tint = Lk.colors.accentText, size = 16)
                Column(Modifier.weight(1f)) {
                    Text(t.title, color = Lk.colors.text, style = Lk.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    t.atMs?.let { Text(Fmt.dayWord(it, now) + " - " + hm(it) + (t.repeat?.let { r -> " - $r" } ?: ""), color = Lk.colors.muted, style = Lk.type.caption) }
                }
                LkIconButton(LkIcons.Close, "Cancel ${t.title}", { launch { core.call("bridge.voice.cancelTask", t.id.removePrefix("task:")) } }, quiet = true)
            }
        }
    }
}

@Composable
private fun Loops(core: Core) {
    var tick by remember { mutableIntStateOf(0) }
    val r by poll(tick, 6000) { core.call("bridge.voice.loops") }
    val rows = (r as? JSONArray)?.objects().orEmpty()
    val launch = rememberLauncher()
    if (rows.isEmpty()) return
    LkCard(title = "You said you would - ${rows.size}") {
        rows.forEach { l ->
            val act = { a: String -> launch { core.call("bridge.voice.loopSet", l.str("id"), a); tick++ } }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(l.str("what") + (l.str("who").takeIf { it.isNotEmpty() }?.let { " ($it)" } ?: ""), color = Lk.colors.text, style = Lk.type.body)
                Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
                    LkButton("Done", { act("done") }, Modifier.weight(1.2f))
                    LkButton("Snooze", { act("snooze") }, Modifier.weight(1f), kind = LkButtonKind.Quiet)
                    LkButton("Drop", { act("drop") }, Modifier.weight(1f), kind = LkButtonKind.Quiet)
                }
            }
        }
    }
}

@Composable
private fun Focus(core: Core) {
    val t by core.timer.collectAsState()
    val settings by core.settings.collectAsState()
    var sel by remember { mutableIntStateOf(settings.raw.optInt("focusTimerMinutes", 25)) }
    val now by rememberNow(t.status == TimerStatus.Running)
    val idle = t.status == TimerStatus.Idle; val done = t.status == TimerStatus.Done
    LkCard(title = "Focus") {
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(16.dp), Alignment.CenterVertically) {
            Ring(FocusTimer.ring(t, now), 104, 7f, if (done) Lk.colors.ok else Amber) {
                Text(if (done) "Done" else FocusTimer.clock(if (idle) sel * 60_000L else FocusTimer.remaining(t, now)), color = Lk.colors.text, style = Lk.type.num.copy(fontSize = if (done) androidx.compose.ui.unit.TextUnit(15f, androidx.compose.ui.unit.TextUnitType.Sp) else androidx.compose.ui.unit.TextUnit(20f, androidx.compose.ui.unit.TextUnitType.Sp)))
            }
            Column(Modifier.weight(1f), Arrangement.spacedBy(8.dp)) {
                if (idle || done) Row(verticalAlignment = Alignment.CenterVertically) {
                    LkIconButton(LkIcons.Back, "Shorter", { sel = maxOf(1, sel - 5) })
                    Text("$sel min", Modifier.weight(1f), color = Lk.colors.text, style = Lk.type.rowTitle, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    LkIconButton(LkIcons.Plus, "Longer", { sel = minOf(180, sel + 5) })
                } else Text(if (t.status == TimerStatus.Running) "Stay with it." else "Paused", color = Lk.colors.muted, style = Lk.type.body)
                LkButton(if (t.status == TimerStatus.Running) "Pause" else if (t.status == TimerStatus.Paused) "Resume" else "Start", { if (t.status == TimerStatus.Running) core.timerPause() else core.timerStart(sel) }, Modifier.fillMaxWidth(), icon = if (t.status == TimerStatus.Running) LkIcons.Pause else LkIcons.Play)
            }
        }
        if (idle || done) Row(Modifier.horizontalScroll(rememberScrollState()), Arrangement.spacedBy(4.dp)) { PRESETS.forEach { m -> LkChip("$m min", sel == m, { sel = m }) } }
        else Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
            LkButton("+1 min", core::timerPlusMinute, Modifier.weight(1f), kind = LkButtonKind.Quiet)
            LkButton("Stop", core::timerReset, Modifier.weight(1f), kind = LkButtonKind.Quiet, icon = LkIcons.Stop)
        }
    }
}

@Composable
private fun Routines(core: Core) {
    val s by core.settings.collectAsState()
    val nav = LocalNav.current
    LkCard(title = "Routines", right = { LkButton("Edit", { nav.go(LkDest.You, "wake") }, kind = LkButtonKind.Quiet) }) {
        Text("Say the phrase, or tap it.", color = Lk.colors.muted, style = Lk.type.caption)
        s.wakeList.forEach { (text, action) ->
            Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(LkShapes.Field).background(Lk.colors.fill1).lkClickable({ core.say(text); nav.go(LkDest.Home, null) }, LkShapes.Field).padding(horizontal = 14.dp), Arrangement.spacedBy(12.dp), Alignment.CenterVertically) {
                Text("\"$text\"", Modifier.weight(1f), color = Lk.colors.text, style = Lk.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(when (action) { "listen" -> "starts listening"; "greet" -> "greets you"; else -> "welcome + catch-up" }, color = Lk.colors.muted, style = Lk.type.caption)
            }
        }
    }
}

@Preview(widthDp = 380, heightDp = 1000) @Composable
private fun TodayPreview() = LkBoth { Box(Modifier.heightIn(max = 780.dp)) { TodayScreen(FakeCore()) } }
