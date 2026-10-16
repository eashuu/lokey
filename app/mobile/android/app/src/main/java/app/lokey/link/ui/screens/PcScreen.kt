package app.lokey.link.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.lokey.link.core.ApprovalSource
import app.lokey.link.core.Core
import app.lokey.link.core.FakeCore
import app.lokey.link.core.Fmt
import app.lokey.link.core.NativeResult
import app.lokey.link.ui.kit.LkApprovalCard
import app.lokey.link.ui.kit.LkBoth
import app.lokey.link.ui.kit.LkButton
import app.lokey.link.ui.kit.LkButtonKind
import app.lokey.link.ui.kit.LkCard
import app.lokey.link.ui.kit.LkDialog
import app.lokey.link.ui.kit.LkField
import app.lokey.link.ui.kit.LkIconDisc
import app.lokey.link.ui.kit.LkIcons
import app.lokey.link.ui.theme.Lk
import org.json.JSONObject

/** PC: the paired Lokey on your computer over your own Wi-Fi (phone/PcPage.tsx). */
@Composable
fun PcScreen(core: Core) {
    val pc by core.pc.collectAsState()
    val approvals by core.approvals.collectAsState()
    val asks = approvals.filter { it.source == ApprovalSource.Pc }
    val st by poll(pc.paired, 5000) { if (pc.paired) core.call("bridge.link.pcStatus") as? JSONObject else null }
    var sync by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var confirmUnpair by remember { mutableStateOf(false) }
    val launch = rememberLauncher()

    Page("PC", line = if (pc.paired) "Your computer, over your own Wi-Fi." else "Pair Lokey on your PC with this phone.") {
        if (!pc.paired) {
            LkCard(title = "Pair with my PC") {
                Text("On the PC open Lokey, Settings, Devices, Pair a phone. It shows an address and a 6-digit code. Same Wi-Fi.", color = Lk.colors.soft, style = Lk.type.body)
                PairForm(core)
            }
        } else {
            LkCard {
                Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(14.dp), Alignment.CenterVertically) {
                    LkIconDisc(LkIcons.Pc)
                    Column(Modifier.weight(1f)) {
                        Text(st?.optString("pc")?.ifEmpty { null } ?: pc.name.ifEmpty { "Your PC" }, color = Lk.colors.text, style = Lk.type.title.copy(fontSize = androidx.compose.ui.unit.TextUnit(18f, androidx.compose.ui.unit.TextUnitType.Sp)))
                        Text(if (pc.connected) "Connected" + (pc.agent.takeIf { it.isNotEmpty() }?.let { " - $it" } ?: "") else "Not reachable. Is it on, on the same Wi-Fi?", color = if (pc.connected) Lk.colors.ok else Lk.colors.muted, style = Lk.type.caption)
                    }
                }
                st?.let { s ->
                    Fmt.battery(s.opt("battery"))?.let { Text("Battery  $it", color = Lk.colors.soft, style = Lk.type.body) }
                    pc.playing?.let { Text("Playing  $it", color = Lk.colors.soft, style = Lk.type.body) }
                    if (pc.jobs.isNotEmpty()) Text("Working on  ${pc.jobs.joinToString(", ")}", color = Lk.colors.soft, style = Lk.type.body)
                }
            }
            if (asks.isNotEmpty()) {
                LkCard(title = "Waiting for your approval - ${asks.size}") {
                    asks.forEach { a -> LkApprovalCard(a.title, a.detail, { core.answerApproval(a, false) }, { core.answerApproval(a, true) }, source = "PC") }
                }
            }
            LkCard(title = "Ask or send") { AskPc(core) }
            LkCard(title = "Memory") {
                Text("What each Lokey learns is merged into the other, both ways.", color = Lk.colors.muted, style = Lk.type.body)
                LkButton("Sync memory now", {
                    launch {
                        busy = true; sync = "Syncing memory..."
                        sync = try { (core.call("bridge.link.sync") as? JSONObject)?.let { "Memory synced: ${it.optInt("pulled")} from the PC, ${it.optInt("pushed")} sent" } ?: "Sync is not available in this build" } catch (e: Exception) { e.message ?: "Could not sync" }
                        busy = false
                    }
                }, Modifier.fillMaxWidth(), kind = LkButtonKind.Quiet, enabled = !busy, icon = LkIcons.Refresh)
                if (sync.isNotEmpty()) Text(sync, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = Lk.colors.muted, style = Lk.type.caption)
            }
            Box(Modifier.fillMaxWidth(), Alignment.Center) { app.lokey.link.ui.kit.LkTextButton("Unpair this phone", { confirmUnpair = true }, tone = Lk.colors.bad) }
        }
    }
    if (confirmUnpair) LkDialog("Unpair from the PC?", "This phone stops syncing with ${pc.name.ifEmpty { "your PC" }} until you pair again.", "Unpair", {
        confirmUnpair = false; launch { core.call("bridge.link.setEnabled", false) }
    }, { confirmUnpair = false }, destructive = true)
}

/** address + code (the PC shows both in Settings > Devices > Pair a phone) */
@Composable
fun PairForm(core: Core, modifier: Modifier = Modifier) {
    var addr by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val launch = rememberLauncher()
    Column(modifier, Arrangement.spacedBy(10.dp)) {
        LkField(addr, { addr = it.trim() }, label = "PC address", placeholder = "192.168.1.20:47831", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
        LkField(code, { code = it.filter(Char::isDigit).take(8) }, label = "Pairing code", placeholder = "6-digit code", keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        LkButton("Pair", {
            launch {
                busy = true; msg = ""
                msg = try { core.call("bridge.link.pair", JSONObject().put("address", addr).put("code", code)); "Paired." } catch (e: Exception) { e.message?.ifEmpty { null } ?: "Could not pair. Check the address and code." }
                busy = false
            }
        }, Modifier.fillMaxWidth(), enabled = !busy && addr.length >= 7 && code.length >= 4)
        if (msg.isNotEmpty()) Text(msg, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = if (msg == "Paired.") Lk.colors.ok else Lk.colors.muted, style = Lk.type.body)
    }
}

@Composable
private fun AskPc(core: Core) {
    var t by remember { mutableStateOf("") }
    var msg by remember { mutableStateOf("") }
    val launch = rememberLauncher()
    val send = { text: String ->
        if (text.isNotBlank()) launch {
            msg = "Sending..."
            val r = core.call("core.linkClient.say", text) as? JSONObject
            msg = if (r?.optBoolean("ok") == true) "Sent to your PC" else r?.optString("error")?.ifEmpty { null } ?: "Could not reach the PC"
            if (r?.optBoolean("ok") == true) t = ""
        }
    }
    LkField(t, { t = it }, placeholder = "Ask your PC...")
    Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
        LkButton("Send", { send(t) }, Modifier.weight(1f), enabled = t.isNotBlank(), icon = LkIcons.Send)
        LkButton("Send my clipboard", {
            launch {
                val r = core.native("clipboard.read")
                val text = (r as? String) ?: (r as? JSONObject)?.optString("text").orEmpty()
                if (text.isEmpty() || NativeResult.failed(r)) msg = "The clipboard is empty (Android only lets Lokey read it while it is open)" else send("From my phone clipboard: $text")
            }
        }, Modifier.weight(1f), kind = LkButtonKind.Quiet)
    }
    if (msg.isNotEmpty()) Text(msg, Modifier.semantics { liveRegion = LiveRegionMode.Polite }, color = Lk.colors.muted, style = Lk.type.caption)
}

@Preview(widthDp = 380, heightDp = 800) @Composable
private fun PcPreview() = LkBoth { Box(Modifier.heightIn(max = 780.dp)) { PcScreen(FakeCore()) } }

@Preview(widthDp = 380, heightDp = 600) @Composable
private fun PcUnpairedPreview() = LkBoth { Box(Modifier.heightIn(max = 580.dp)) { PcScreen(FakeCore(FakeCore.Scenario.Empty)) } }
