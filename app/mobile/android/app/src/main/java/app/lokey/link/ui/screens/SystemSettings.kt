package app.lokey.link.ui.screens

import androidx.compose.foundation.Image
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.lokey.link.core.Core
import app.lokey.link.core.FakeCore
import app.lokey.link.core.Health
import app.lokey.link.core.IslandKinds
import app.lokey.link.core.Level
import app.lokey.link.core.NativeResult
import app.lokey.link.core.Perm
import app.lokey.link.core.PermSpec
import app.lokey.link.core.Shizuku
import app.lokey.link.core.needsRestrictedHint
import app.lokey.link.ui.kit.LkBoth
import app.lokey.link.ui.kit.LkButton
import app.lokey.link.ui.kit.LkButtonKind
import app.lokey.link.ui.kit.LkCard
import app.lokey.link.ui.kit.LkIcon
import app.lokey.link.ui.kit.LkIcons
import app.lokey.link.ui.kit.LkLabel
import app.lokey.link.ui.kit.LkRow
import app.lokey.link.ui.theme.Lk
import kotlinx.coroutines.delay
import org.json.JSONObject

/** Status dot used by the health list: ok, warn, bad, or off (grey) */
@Composable
fun StatusDot(level: Level) {
    val c = Lk.colors
    val color = when (level) { Level.Ok -> c.ok; Level.Warn -> c.warn; Level.Bad -> c.bad; Level.Off -> c.dim }
    val label = when (level) { Level.Ok -> "Good"; Level.Warn -> "Check"; Level.Bad -> "Problem"; Level.Off -> "Off" }
    Box(Modifier.size(10.dp).background(color, CircleShape).semantics { contentDescription = label })
}

/** The permissions Lokey uses, with a real request for each (the plugin's perm.status / perm.request). Special ones open the exact Android screen; come back and it re-checks. */
@Composable
fun PermissionList(core: Core, items: List<PermSpec> = Perm.Core, modifier: Modifier = Modifier) {
    var tick by remember { mutableIntStateOf(0) }
    val status by poll(tick, 3000) { core.native("perm.status", JSONObject()) }
    var asked by remember { mutableStateOf(setOf<String>()) }
    val launch = rememberLauncher()
    Column(modifier, Arrangement.spacedBy(8.dp)) {
        items.forEach { p ->
            val on = Perm.granted(status, p.name)
            LkCard(padding = 12.dp) {
                Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(12.dp), Alignment.CenterVertically) {
                    Box(Modifier.size(28.dp).clip(CircleShape).background(if (on) Lk.colors.accent else Lk.colors.fill3), Alignment.Center) { if (on) LkIcon(LkIcons.Check, null, tint = Lk.colors.accentInk, size = 16) }
                    Column(Modifier.weight(1f)) {
                        Text(p.title, color = Lk.colors.text, style = Lk.type.rowTitle)
                        Text(p.why, color = Lk.colors.muted, style = Lk.type.caption)
                    }
                    LkButton(if (on) "On" else if (p.special) "Open" else "Allow", {
                        launch { core.native("perm.request", JSONObject().put("name", p.name)); asked = asked + p.name; delay(600); tick++ }
                    }, enabled = !on, kind = LkButtonKind.Quiet)
                }
                if (!on && p.name in asked && needsRestrictedHint(p.name, false)) {
                    Text("Greyed out or switches itself off? Android blocks this for apps installed from a file. Open App info, tap the menu (top right), choose Allow restricted settings, then try again.", color = Lk.colors.warn, style = Lk.type.caption)
                    LkButton("Open App info", { launch { core.native("perm.request", JSONObject().put("name", "app-info")) } }, kind = LkButtonKind.Quiet)
                }
            }
        }
    }
}

/** Settings > Permissions and Android access */
@Composable
fun AccessSettings(core: Core) {
    val launch = rememberLauncher()
    PermissionList(core, Perm.Core + Perm.Extra)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LkLabel("Open Android settings", Modifier.padding(start = 4.dp))
        Group {
            listOf("notifications" to ("Notification settings" to "Let Lokey post cards and reminders"), "overlay" to ("Floating windows" to "Draw the island over other apps"),
                "accessibility" to ("Accessibility service" to "Tap, type and read the screen for you"), "notification-listener" to ("Notification access" to "Inbox, music and lyrics"),
                "battery" to ("Battery" to "Background power consumption: no restrictions"), "app-info" to ("App info" to "Autostart, permissions, Allow restricted settings"),
            ).forEach { (name, t) -> LkRow(t.first, sub = t.second, chevron = true, onClick = { launch { core.native("perm.request", JSONObject().put("name", name)) } }) }
        }
    }
}

/** Settings > Island: what it shows, the system-wide pill, Live Updates, and the background health list */
@Composable
fun IslandSettings(core: Core) {
    val s by core.settings.collectAsState()
    val set = rememberSet(core)
    Group {
        SettingSwitch(core, "Island", "The black capsule over the camera.", "island", "enabled", default = true)
        SettingSwitch(core, "Haptics", "A short buzz for taps, hold-to-talk and approvals.", "phone", "haptics", default = true)
        SettingChoice(core, "Spirit animations", listOf("full" to "Full", "calm" to "Calm"), "phone", "spirit", default = "full")
    }
    Note("Calm: fewer fidgets, 30 fps, easier on the battery.")
    LkLabel("Show on the island (approvals always show)", Modifier.padding(start = 4.dp))
    Group {
        Column {
            IslandKinds.Optional.forEach { (k, label) -> LkRow(label, checked = s.activities?.contains(k) ?: true, onCheckedChange = { set(listOf("phone", "activities"), org.json.JSONArray(IslandKinds.toggle(s.activities, k, it))) }) }
        }
    }
    SystemIsland(core)
    BackgroundHealth(core)
}

@Composable
private fun SystemIsland(core: Core) {
    val st by poll(Unit, 4000) { core.native("island.status") as? JSONObject }
    val launch = rememberLauncher()
    fun yes(vararg k: String) = k.any { st?.optBoolean(it) == true }
    val overlay = yes("overlayPermission", "overlay", "overlayGranted")
    val live = yes("liveUpdatesPermission", "liveUpdates", "promoted", "promotedGranted")
    val cutout = st != null && st!!.has("cutout") && !st!!.isNull("cutout") || yes("cutoutFound")
    val sdk = st?.optInt("sdk") ?: 0
    LkLabel("System island", Modifier.padding(start = 4.dp))
    Group {
        SettingSwitch(core, "Pill over other apps", "When Lokey is not in front, a black pill is drawn around the camera. Hidden while the app is open.", "phone", "systemIsland", default = true)
        SettingSwitch(core, "Live Updates", "Timers, music, approvals and jobs as Android 16 live notifications.", "phone", "liveUpdates", default = true)
        SettingSwitch(core, "vivo Origin Island (experimental)", "Also post activities the way vivo's own apps do, so OriginOS may show them in its island.", "phone", "vivoIsland", default = true)
    }
    Group {
        PermRow("Draw over other apps", "Needed for the pill.", st?.let { overlay }, "overlay", core)
        PermRow("Live Updates permission", "Promoted notifications.", st?.let { live }, "live_updates", core)
        LkRow("Camera cutout", sub = if (st == null) "Checking..." else if (cutout) "Found: the pill wraps it." else "Not found: the pill sits at the top centre.")
        LkRow("Android", sub = if (sdk > 0) "SDK $sdk" + if (sdk >= 36) " (Android 16)" else ": Live Updates need Android 16" else "Unknown")
        LkRow("Battery", sub = "Open the battery exemption: no restrictions, or Android stops the pill.", chevron = true, onClick = { launch { core.native("perm.request", JSONObject().put("name", "battery")) } })
    }
    VivoTest(core)
}

@Composable
private fun PermRow(title: String, sub: String, ok: Boolean?, perm: String, core: Core) {
    val launch = rememberLauncher()
    Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(horizontal = 12.dp), Arrangement.spacedBy(12.dp), Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(vertical = 8.dp)) { Text(title, color = Lk.colors.text, style = Lk.type.rowTitle); Text(sub, color = Lk.colors.muted, style = Lk.type.caption) }
        when (ok) { null -> Unit; true -> Text("On", color = Lk.colors.ok, style = Lk.type.button); false -> LkButton("Allow", { launch { core.native("perm.request", JSONObject().put("name", perm)) } }) }
    }
}

@Composable
private fun VivoTest(core: Core) {
    var res by remember { mutableStateOf("") }
    var asked by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var tick by remember { mutableIntStateOf(0) }
    val st by poll(tick, 4000) { (core.native("island.status") as? JSONObject)?.optJSONObject("vivoSuperx") }
    val launch = rememberLauncher()
    var check by remember { mutableStateOf(false) }
    fun yn(v: Boolean?) = when (v) { true -> "yes"; false -> "no"; null -> "unknown" }
    val style = st?.optString("style")?.ifEmpty { null } ?: "overlay"
    val route = st?.optString("route")?.ifEmpty { null } ?: "subset"
    val showed = st?.optString("showed").orEmpty()
    val set = { k: String, v: Any -> launch { core.native("island.setEnabled", JSONObject().put(k, v)); tick++ } }
    val probe = { r: String ->
        launch {
            busy = true; asked = false
            val x = core.native("island.vivoProbe", JSONObject().put("kind", "approval").put("route", r)) as? JSONObject
            res = when {
                x == null -> "No answer from the phone."
                NativeResult.failed(x) -> "Could not post: ${NativeResult.reason(x)}."
                else -> "${if (x.optBoolean("posted", true)) "Posted." else "Not posted."} System kept vivo's data: ${yn(x.opt("extrasKept") as? Boolean)}." +
                    (if (r == "both") " The full one follows in about 22 s." else "") + " Look at the top of the screen: did the system pill show?"
            }
            asked = true; busy = false; tick++
        }
    }
    LkLabel("vivo Origin Island", Modifier.padding(start = 4.dp))
    Group {
        LkRow("Test full island", sub = "Posts the full vivo schema (route vivo-full).", onClick = { if (!busy) probe("full") })
        LkRow("Test documented subset", sub = "Posts only vivo's publicly documented fields.", onClick = { if (!busy) probe("subset") })
        LkRow("Test both", sub = "Subset now, the full one 20 s later.", onClick = { if (!busy) probe("both") })
        LkRow("Send with", value = if (route == "full") "Full schema" else "Documented subset", sub = "Which route real activities use. Tap to switch.",
            onClick = { set("vivoRoute", if (route == "full") "subset" else "full") })
        LkRow("Island style", value = when (style) { "system" -> "System (vivo)"; "both" -> "Both"; else -> "Overlay pill" },
            sub = "System hides Lokey's own pill only after you answered \"It showed\" below. Tap to change.",
            onClick = { set("vivoStyle", when (style) { "overlay" -> "system"; "system" -> "both"; else -> "overlay" }) })
        LkRow("Island check", sub = "Show the test pill again and tell Lokey whether it appeared.", chevron = true, onClick = { check = true })
        LkRow("Last answer", sub = when (showed) { "yes" -> "You said the system pill showed."; "no" -> "You said it did not show."; else -> "Not answered yet." })
    }
    if (check) IslandCheckSheet(core) { check = false; tick++ }
    if (res.isNotEmpty()) Note(res)
    if (asked) Group {
        LkRow("It showed", sub = "The system pill appeared.", onClick = { set("vivoShowed", true); asked = false })
        LkRow("It didn't", sub = "Nothing appeared.", onClick = { set("vivoShowed", false); asked = false })
    }
    Note("vivo only shows third-party apps that vivo approved (docs/VIVO-ISLAND.md). If the test posts but nothing appears, that is expected until Lokey is approved.")
}

@Composable
private fun BackgroundHealth(core: Core) {
    val d by poll(Unit, 3000) { core.native("diag.status") as? JSONObject }
    val launch = rememberLauncher()
    val data = d ?: return
    LkLabel("Background health", Modifier.padding(start = 4.dp))
    Group {
        Health.rows(data, System.currentTimeMillis()).forEach { r ->
            Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(horizontal = 12.dp), Arrangement.spacedBy(12.dp), Alignment.CenterVertically) {
                StatusDot(r.level)
                Column(Modifier.weight(1f).padding(vertical = 8.dp)) { Text(r.title, color = Lk.colors.text, style = Lk.type.rowTitle); Text(r.text, color = Lk.colors.muted, style = Lk.type.caption) }
                if (r.fixPerm != null && r.level != Level.Ok) LkButton(r.fixLabel ?: "Fix", { launch { core.native("perm.request", JSONObject().put("name", r.fixPerm)) } }, kind = LkButtonKind.Quiet)
            }
        }
        LkRow("Notification access", sub = "Needed for music, lyrics and the Inbox.", chevron = true, onClick = { launch { core.native("perm.request", JSONObject().put("name", "notification-listener")) } })
    }
    Note("Android ${data.opt("sdk") ?: "?"}  -  ${data.optString("manufacturer", data.optString("brand", "unknown"))}")
}

/** Power tier (Shizuku): three steps and a test that runs a hidden second screen once and says plainly what happened */
@Composable
fun ShizukuSettings(core: Core) {
    var tick by remember { mutableIntStateOf(0) }
    val st by poll(tick, 0) { core.native("shizuku.status", JSONObject().put("probe", true)) as? JSONObject }
    var busy by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<ShizukuResult?>(null) }
    val launch = rememberLauncher()
    val guide = { page: String -> launch { val r = core.native("shizuku.openGuide", JSONObject().put("page", page)); note = NativeResult.reason(r) ?: "" } }
    Note("Optional. Lets Lokey run a task in another app on a hidden second screen while you keep using the phone. It needs Shizuku, a free app that gives Lokey shell-level access, no root.")
    Group {
        LkRow("Status", sub = Shizuku.status(st), value = if (st?.optBoolean("canCreateDisplay") == true) "Ready" else null)
    }
    val steps = Shizuku.steps(st)
    LkCard(title = "Set up") {
        steps.forEach { step ->
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("${step.n}. ${step.title}", color = Lk.colors.text, style = Lk.type.rowTitle)
                Text(step.hint, color = Lk.colors.muted, style = Lk.type.caption)
                if (step.done) Text("Done", color = Lk.colors.ok, style = Lk.type.button)
                else Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(8.dp)) {
                    when (step.n) {
                        1 -> LkButton("Get Shizuku", { guide("get") })
                        2 -> { LkButton("Open Shizuku", { guide("app") }); LkButton("Developer options", { guide("dev") }, kind = LkButtonKind.Quiet) }
                        else -> LkButton(if (busy == "request") "Asking..." else "Allow", { launch { busy = "request"; val r = core.native("shizuku.request"); note = NativeResult.reason(r) ?: ""; busy = ""; tick++ } })
                    }
                }
            }
        }
    }
    if (note.isNotEmpty()) Text(note, color = Lk.colors.warn, style = Lk.type.caption)
    Group { LkRow("Test second screen", sub = "Creates a small hidden screen, opens Settings on it, takes one picture and closes it. Nothing is shown on your main screen.", onClick = { if (busy.isEmpty()) launch { busy = "test"; result = null; result = runShizukuTest(core); busy = ""; tick++ } }, value = if (busy == "test") "Running..." else "Run") }
    result?.let { r ->
        LkCard {
            Text((if (r.pass) "Pass: " else "Fail: ") + r.verdict, color = if (r.pass) Lk.colors.ok else Lk.colors.warn, style = Lk.type.rowTitle)
            r.lines.forEach { (ok, t) -> Text((if (ok == false) "x  " else "ok  ") + t, color = if (ok == false) Lk.colors.warn else Lk.colors.soft, style = Lk.type.caption) }
            r.image?.let { img -> Image(img.asImageBitmap(), "What the second screen showed", Modifier.fillMaxWidth().heightIn(max = 280.dp)) }
        }
    }
    Note("Tasks never open banking, payment, wallet, password or authenticator apps, never type passwords or codes, and ask you (with a picture) before they send, buy or delete anything.")
}

class ShizukuResult(val pass: Boolean, val verdict: String, val lines: List<Pair<Boolean?, String>>, val image: android.graphics.Bitmap? = null)

/** one run of the whole chain on a small display: start, open Settings, one picture, the UI tree, stop. Always ends the display. */
private suspend fun runShizukuTest(core: Core): ShizukuResult {
    val lines = ArrayList<Pair<Boolean?, String>>()
    val t0 = System.currentTimeMillis()
    var image: android.graphics.Bitmap? = null
    fun j(r: Any?) = r as? JSONObject
    try {
        val s = j(core.native("bg.start", JSONObject().put("width", 540).put("height", 1200).put("dpi", 280)))
        if (s == null || NativeResult.failed(s)) { lines += false to "Could not create a second screen: ${NativeResult.reason(s) ?: "no answer"}"; return ShizukuResult(false, "No second screen can be created.", lines) }
        lines += true to "Second screen created (display ${s.opt("displayId")}, ${s.opt("width")}x${s.opt("height")})."
        val l = j(core.native("bg.launch", JSONObject().put("package", "com.android.settings")))
        if (l == null || NativeResult.failed(l)) { lines += false to "Settings did not open on it: ${NativeResult.reason(l) ?: "no answer"}"; return ShizukuResult(false, "The second screen exists, but this phone does not let an app start there.", lines) }
        lines += true to "Settings was started on the second screen."
        delay(1800)
        val ui = j(core.native("bg.ui", JSONObject().put("maxNodes", 60)))
        val nodes = if (ui != null && !NativeResult.failed(ui)) ui.optInt("count") else 0
        val pkg = if (ui != null && !NativeResult.failed(ui)) ui.optString("pkg") else ""
        lines += (nodes > 0) to if (nodes > 0) "The screen reader sees $nodes items." else "The screen reader sees nothing there."
        val f = j(core.native("bg.frame", JSONObject().put("quality", 70).put("maxWidth", 540)))
        if (f == null || NativeResult.failed(f) || f.optString("jpegBase64").isEmpty()) { lines += false to "No picture: ${NativeResult.reason(f) ?: "no answer"}"; return ShizukuResult(false, "The second screen produced no picture.", lines) }
        val bytes = android.util.Base64.decode(f.optString("jpegBase64"), android.util.Base64.DEFAULT)
        image = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        lines += !f.optBoolean("black") to if (f.optBoolean("black")) "The picture is black." else "Got a picture (${f.opt("w")}x${f.opt("h")})."
        if (f.optBoolean("black")) return ShizukuResult(false, if (nodes > 0) "Apps run on the second screen, but their picture comes back black (a secure window)." else "The second screen is black.", lines, image)
        if (pkg.isNotEmpty() && pkg != "com.android.settings") return ShizukuResult(false, "A picture came back, but Settings seems to have opened elsewhere.", lines, image)
        return ShizukuResult(true, "It works: a second screen ran Settings in ${(System.currentTimeMillis() - t0) / 100 / 10.0} s.", lines, image)
    } catch (e: kotlinx.coroutines.CancellationException) { throw e
    } catch (e: Exception) { lines += false to (e.message ?: "failed"); return ShizukuResult(false, "The test failed.", lines, image)
    } finally { try { core.native("bg.stop") } catch (_: Exception) { } }
}

@Preview(widthDp = 380, heightDp = 900) @Composable
private fun SystemPreview() = LkBoth {
    val core = remember { FakeCore() }
    Column(Modifier.heightIn(max = 880.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { PermissionList(core); }
}

@Preview(widthDp = 380, heightDp = 900) @Composable
private fun IslandSettingsPreview() = LkBoth {
    val core = remember { FakeCore() }
    Column(Modifier.heightIn(max = 880.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { IslandSettings(core) }
}
