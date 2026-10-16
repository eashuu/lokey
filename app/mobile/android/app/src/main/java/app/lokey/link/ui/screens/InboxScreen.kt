package app.lokey.link.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.lokey.link.core.Core
import app.lokey.link.core.FakeCore
import app.lokey.link.core.Fmt
import app.lokey.link.core.Notif
import app.lokey.link.core.NativeResult
import app.lokey.link.core.Notifs
import app.lokey.link.ui.home.rememberNow
import app.lokey.link.ui.kit.LkBoth
import app.lokey.link.ui.kit.LkButton
import app.lokey.link.ui.kit.LkButtonKind
import app.lokey.link.ui.kit.LkCard
import app.lokey.link.ui.kit.LkDest
import app.lokey.link.ui.kit.LkEmpty
import app.lokey.link.ui.kit.LkField
import app.lokey.link.ui.kit.LkIconButton
import app.lokey.link.ui.kit.LkIcons
import app.lokey.link.ui.kit.LkSheet
import app.lokey.link.ui.kit.LkTextButton
import app.lokey.link.ui.kit.LkDivider
import androidx.compose.foundation.layout.offset
import app.lokey.link.ui.kit.lkClickable
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkShapes
import org.json.JSONArray
import org.json.JSONObject

/** Inbox: what the notification listener sees, grouped by app. Summarise and "reply as me" go through the assistant; only Send sends. */
@Composable
fun InboxScreen(core: Core) {
    var removed by remember { mutableStateOf(setOf<String>()) }
    var tick by remember { mutableStateOf(0) }
    val raw by poll(tick, 8000) { core.native("notifications.list", JSONObject().put("limit", 80)) }
    val list = (raw as? JSONArray)?.let { Notifs.parse(it) }.orEmpty().filter { it.key !in removed }
    val blocked = raw?.let { Notifs.blocked(it) }
    val groups = Notifs.group(list)
    var open by remember { mutableStateOf(mapOf<String, Boolean>()) }
    var reply by remember { mutableStateOf<Notif?>(null) }
    val nav = LocalNav.current
    val launch = rememberLauncher()
    val now by rememberNow(true, 30_000)

    Page("Inbox", line = "Your notifications, grouped by app. I can summarise them or answer for you.") {
        if (blocked != null) {
            LkCard {
                Text(if (blocked.startsWith("other:")) blocked.removePrefix("other:") else "Lokey needs notification access to show your notifications.", color = Lk.colors.text, style = Lk.type.body)
                if (!blocked.startsWith("other:")) LkButton("Allow notification access", { launch { core.native("perm.request", JSONObject().put("name", "notification-listener")); tick++ } })
            }
        } else if (raw != null && groups.isEmpty()) LkEmpty("No notifications right now", "New ones show up here.", icon = LkIcons.Inbox)
        groups.forEach { g ->
            val isOpen = open[g.app] ?: (g.items.size <= 3)
            LkCard(padding = 0.dp) {
                Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(start = 4.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.weight(1f).heightIn(min = 60.dp).clip(LkShapes.Row).lkClickable({ open = open + (g.app to !isOpen) }, LkShapes.Row).padding(horizontal = 8.dp).semantics { stateDescription = if (isOpen) "Expanded" else "Collapsed" },
                        Arrangement.spacedBy(12.dp), Alignment.CenterVertically) {
                        Box(Modifier.size(36.dp).clip(CircleShape).background(Lk.colors.accentSoft), Alignment.Center) { Text(g.app.take(1).uppercase(), color = Lk.colors.accentText, style = Lk.type.rowTitle) }
                        Column(Modifier.weight(1f)) {
                            Text(g.app, color = Lk.colors.text, style = Lk.type.rowTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${g.items.size} new", color = Lk.colors.muted, style = Lk.type.caption)
                        }
                        app.lokey.link.ui.kit.LkIcon(if (isOpen) LkIcons.Down else LkIcons.Chevron, null, tint = Lk.colors.muted, size = 16)
                    }
                    LkTextButton("Summarise", { core.say(Notifs.summaryPrompt(g.app, g.items)); nav.go(LkDest.Home, null) }, Modifier.semantics { contentDescription = "Summarise ${g.app}" }, icon = LkIcons.Sparkle)
                }
                if (isOpen) g.items.forEach { n ->
                    LkDivider(Modifier.padding(horizontal = 14.dp))
                    Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 4.dp, bottom = if (n.canReply) 2.dp else 12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(n.title, Modifier.weight(1f), color = Lk.colors.text, style = Lk.type.rowTitle.copy(fontSize = androidx.compose.ui.unit.TextUnit(14f, androidx.compose.ui.unit.TextUnitType.Sp)), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(Fmt.ago(now, n.time), color = Lk.colors.muted, style = Lk.type.caption)
                            LkIconButton(LkIcons.Close, "Dismiss ${n.title}", { removed = removed + n.key; launch { core.native("notifications.dismiss", JSONObject().put("key", n.key)) } }, quiet = true)
                        }
                        Text(n.text, color = Lk.colors.soft, style = Lk.type.body, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        if (n.canReply) LkTextButton("Reply as me", { reply = n }, Modifier.offset(x = (-12).dp), icon = LkIcons.Reply)
                    }
                }
            }
        }
    }
    reply?.let { n -> ReplySheet(core, n, { reply = null }) { removed = removed + n.key; reply = null } }
}

@Composable
private fun ReplySheet(core: Core, n: Notif, close: () -> Unit, sent: () -> Unit) {
    var text by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(true) }
    var msg by remember { mutableStateOf("") }
    var round by remember { mutableStateOf(0) }
    val launch = rememberLauncher()
    LaunchedEffect(round) {
        busy = true; msg = ""
        val t = core.ask(Notifs.replyPrompt(n))
        busy = false
        if (t.isNotEmpty()) text = t else msg = "No draft came back. Write it yourself, or try again."
    }
    LkSheet("Reply as me", close) {
        Text("${n.app}  ${n.title}", color = Lk.colors.muted, style = Lk.type.caption)
        Text("\"${n.text}\"", color = Lk.colors.soft, style = Lk.type.body, maxLines = 3, overflow = TextOverflow.Ellipsis)
        LkField(text, { text = it }, label = "Your reply", placeholder = if (busy) "Drafting in your style..." else "Your reply", singleLine = false)
        if (msg.isNotEmpty()) Text(msg, color = Lk.colors.warn, style = Lk.type.caption)
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
            LkButton("Redraft", { round++ }, Modifier.weight(1f), kind = LkButtonKind.Quiet, enabled = !busy)
            LkButton("Send", {
                launch {
                    busy = true
                    val r = core.native("notifications.reply", JSONObject().put("key", n.key).put("text", text.trim()))
                    busy = false
                    if (NativeResult.failed(r)) msg = NativeResult.reason(r) ?: "Could not send the reply" else sent()
                }
            }, Modifier.weight(1f), enabled = !busy && text.isNotBlank(), icon = LkIcons.Check)
        }
    }
}

@Preview(widthDp = 380, heightDp = 800) @Composable
private fun InboxPreview() = LkBoth { Box(Modifier.heightIn(max = 780.dp)) { InboxScreen(FakeCore()) } }
