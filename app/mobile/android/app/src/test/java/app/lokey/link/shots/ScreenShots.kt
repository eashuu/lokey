package app.lokey.link.shots

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import app.lokey.link.core.CoreStatus
import app.lokey.link.core.FakeCore
import app.lokey.link.ui.app.Shell
import app.lokey.link.ui.home.MusicCard
import app.lokey.link.ui.home.PcCard
import app.lokey.link.ui.home.ReminderCard
import app.lokey.link.ui.home.TimerCard
import app.lokey.link.ui.island.IslandPill
import app.lokey.link.ui.kit.*
import app.lokey.link.ui.screens.OnboardingScreen
import app.lokey.link.ui.screens.Step
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LokeyTheme
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Renders every screen and the kit on FakeCore at a phone size (1260 x 2800 px, 480 dpi, so 420 x 933 dp) in dark and light, with a punch-hole cutout and
 * a status bar drawn on top. Run with `gradle recordScreens`; PNGs land in C:/lokey-android-tools/shots/native. The spirit is a placeholder disc here
 * (a WebView cannot render in Robolectric). Not an assertion test: it exists to be looked at.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w420dp-h934dp-xxhdpi")
class ScreenShots {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()
    private val dir = File(System.getProperty("lokey.shots") ?: "build/shots").apply { mkdirs() }
    private var scene by mutableStateOf<@Composable () -> Unit>({})
    private var dark by mutableStateOf(true)
    private var sceneKey by mutableStateOf(0)

    private fun setup() {
        rule.setContent {
            CompositionLocalProvider(LocalInspectionMode provides true) { LokeyTheme(dark = dark) { Phone { androidx.compose.runtime.key(sceneKey) { scene() } } } }
        }
    }

    private fun shot(name: String, content: @Composable () -> Unit) {
        for (d in listOf(true, false)) {
            rule.runOnUiThread { dark = d; scene = content; sceneKey++ }
            rule.waitForIdle()
            rule.onAllNodes(androidx.compose.ui.test.isRoot()).onFirst().captureRoboImage(File(dir, "$name-${if (d) "dark" else "light"}.png").path)
        }
    }

    @Composable
    private fun Phone(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lk.colors.bg)) {
            Box(Modifier.fillMaxSize().padding(top = 40.dp, bottom = 20.dp)) { content() }
            // status bar and the punch-hole camera, where the system draws them
            Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 10.dp), Arrangement.SpaceBetween) {
                Text("12:48", color = Lk.colors.text, style = Lk.type.caption); Text("84%", color = Lk.colors.text, style = Lk.type.caption)
            }
            Box(Modifier.align(Alignment.TopCenter).padding(top = 12.dp).size(14.dp).background(Color.Black, CircleShape))
        }
    }

    @Test fun smoke() {
        rule.setContent { LokeyTheme(dark = true) { Box(Modifier.fillMaxSize().background(Lk.colors.bg).padding(40.dp)) { LkCard(title = "Hello") { Text("World", color = Lk.colors.text, style = Lk.type.body) } } } }
        rule.onAllNodes(androidx.compose.ui.test.isRoot()).onFirst().captureRoboImage(File(dir, "smoke.png").path)
    }

    @Test fun screens() {
        setup()
        val busy = FakeCore(); val empty = FakeCore(FakeCore.Scenario.Empty)
        fun app(core: FakeCore, dest: LkDest, section: String? = null, status: CoreStatus = CoreStatus.Ready("t")) = @Composable { Shell(core, status is CoreStatus.Booting, dest, section, hideNavOnIme = false) }
        shot("home-busy", app(busy, LkDest.Home))
        shot("home-empty", app(empty, LkDest.Home))
        shot("inbox-busy", app(busy, LkDest.Inbox)); shot("inbox-empty", app(empty, LkDest.Inbox))
        shot("today-busy", app(busy, LkDest.Today)); shot("today-empty", app(empty, LkDest.Today))
        shot("pc-busy", app(busy, LkDest.Pc)); shot("pc-unpaired", app(empty, LkDest.Pc))
        shot("you-hub", app(busy, LkDest.You))
        for (s in listOf("spirit", "bond", "voice", "wake", "brain", "appearance", "island", "access", "privacy", "shizuku", "tips", "about")) shot("you-$s", app(busy, LkDest.You, s))
        // approval from another tab: the sheet is its own window, so show the card it holds
        for ((i, name) in Step.entries.withIndex()) shot("onboarding-${i + 1}-${name.name.lowercase()}", { OnboardingScreen(empty, {}, i) })
    }

    @Test fun kit() {
        setup()
        val core = FakeCore()
        shot("kit-1-cards-rows") {
            Column(Modifier.padding(16.dp), Arrangement.spacedBy(16.dp)) {
                LkCard(title = "Battery") { Text("84 %", color = Lk.colors.text, style = Lk.type.num) }
                LkSection("Island") {
                    LkRow("Show island", sub = "Over other apps", icon = LkIcons.Bell, checked = true, onCheckedChange = {})
                    LkRow("Wake word", checked = false, onCheckedChange = {})
                    LkRow("Position", value = "Top centre", onClick = {})
                    LkRow("Background health", sub = "All checks passed", icon = LkIcons.Check, chevron = true, onClick = {})
                }
                LkSection("Inbox") {
                    LkListItem("PC finished the build", sub = "lokey-app: 0 errors, 3 warnings", meta = "09:41", unread = true, leading = { LkIconDisc(LkIcons.Pc) })
                    LkListItem("Reminder: call mum", sub = "Today, 18:00", meta = "08:05", leading = { LkIconDisc(LkIcons.Bell) })
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LkStatTile("Battery", "84", Modifier.weight(1f), unit = "%", progress = 0.84f)
                    LkStatTile("Steps", "6,420", Modifier.weight(1f), sub = "Goal 8,000")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { LkBadge("Online", tone = LkTone.Ok); LkBadge("Beta", tone = LkTone.Accent); LkBadge("Risky", tone = LkTone.Warn); LkBadge("Offline", tone = LkTone.Bad); LkBadge("Muted"); LkBadge("3", mono = true) }
                LkProgress(0.4f)
            }
        }
        shot("kit-2-controls") {
            Column(Modifier.padding(16.dp), Arrangement.spacedBy(14.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { LkButton("Allow", {}); LkButton("Later", {}, kind = LkButtonKind.Quiet); LkButton("Delete", {}, kind = LkButtonKind.Destructive) }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    LkIconButton(LkIcons.Mic, "Talk", {}, active = true); LkIconButton(LkIcons.Bell, "Notifications", {}); LkIconButton(LkIcons.Close, "Close", {})
                    LkSwitch(true, {}, "On"); LkSwitch(false, {}, "Off")
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { LkChip("All", true, {}); LkChip("PC", false, {}); LkChip("Phone", false, {}) }
                LkSegmented(listOf("Dark", "Light", "Auto"), 0, {})
                LkSlider(0.62f, {}, "Volume", valueText = "62")
                LkField("", {}, label = "Server address", placeholder = "192.168.0.10")
                LkField("nope", {}, label = "Pairing code", error = "Code not recognised")
                LkToast("Copied to PC", action = "Undo")
                LkDialogSurface("Forget this PC?", "Lokey will stop syncing until you pair again.", "Forget", {}, "Cancel", {}, destructive = true)
            }
        }
        shot("kit-3-nav-approval-empty") {
            Column(Modifier.padding(16.dp), Arrangement.spacedBy(16.dp)) {
                LkApprovalCard("Run a command on PC", "git push origin main", {}, {}, risk = "Writes")
                LkBottomNav(LkDest.Home, {}, badges = mapOf(LkDest.Inbox to 3))
                LkBottomNav(LkDest.You, {})
                LkEmpty("Nothing new", "Messages from your PC and phone land here.", action = "Refresh")
                IslandPill { Text("Charging 84%", color = Color.White, style = Lk.type.island) }
            }
        }
        shot("kit-4-face-cards") {
            Column(Modifier.padding(16.dp), Arrangement.spacedBy(12.dp)) { TimerCard(core); MusicCard(core); ReminderCard(core); PcCard(core, onOpen = {}) }
        }
        shot("kit-5-sheet") {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.5f)), Alignment.BottomCenter) {
                androidx.compose.foundation.layout.Box(Modifier.background(Lk.colors.s1, app.lokey.link.ui.theme.LkShapes.Sheet)) {
                    LkSheetSurface("Quick settings", Modifier.padding(top = 20.dp)) { LkRow("Island", checked = true, onCheckedChange = {}); LkRow("Wake word", checked = false, onCheckedChange = {}) }
                }
            }
        }
    }
}
