package app.lokey.link.ui.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import app.lokey.link.core.ApprovalSource
import app.lokey.link.core.Core
import app.lokey.link.core.CoreStatus
import app.lokey.link.core.FakeCore
import app.lokey.link.core.Notice
import app.lokey.link.ui.home.HomeScreen
import app.lokey.link.ui.kit.LkApprovalCard
import app.lokey.link.ui.kit.LkBottomNav
import app.lokey.link.ui.kit.LkDest
import app.lokey.link.ui.kit.LkEmpty
import app.lokey.link.ui.kit.LkSheet
import app.lokey.link.ui.kit.LkToast
import app.lokey.link.ui.screens.InboxScreen
import app.lokey.link.ui.screens.IslandCheckSheet
import app.lokey.link.ui.screens.native
import app.lokey.link.ui.screens.LocalNav
import app.lokey.link.ui.screens.LocalSetupAgain
import app.lokey.link.ui.screens.Nav
import app.lokey.link.ui.screens.OnboardingScreen
import app.lokey.link.ui.screens.PcScreen
import app.lokey.link.ui.screens.TodayScreen
import app.lokey.link.ui.screens.YouScreen
import app.lokey.link.ui.screens.number
import app.lokey.link.ui.screens.flag
import app.lokey.link.ui.theme.Lk
import app.lokey.link.ui.theme.LkDefaults
import app.lokey.link.ui.theme.LokeyTheme
import kotlinx.coroutines.delay

/**
 * The whole app: theme and text size from the settings, the first-run flow, then the five destinations with the toast and approval-sheet hosts on top.
 * [onboarded] / [onOnboarded] persist the first-run flow; [onSetupAgain] reopens it (You, OriginOS tips).
 */
@Composable
fun LokeyApp(core: Core, onboarded: Boolean = true, onOnboarded: () -> Unit = {}, onSetupAgain: () -> Unit = {}) {
    val settings by core.settings.collectAsState()
    val system = isSystemInDarkTheme()
    val scale = settings.raw.number("appearance", "scale", default = 1.0).coerceIn(0.75, 1.5).toFloat()
    val d = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(d.density, d.fontScale * scale), LocalSetupAgain provides onSetupAgain) {
        LokeyTheme(dark = settings.dark ?: system, accent = settings.accent?.let { Color(it) } ?: LkDefaults.Accent, reduceMotion = settings.raw.flag("appearance", "reduceMotion")) {
            Box(Modifier.fillMaxSize().background(Lk.colors.bg)) {
                val status by core.status.collectAsState()
                when {
                    !onboarded -> OnboardingScreen(core, onOnboarded)
                    status is CoreStatus.Failed -> Failure((status as CoreStatus.Failed).error, core::retry)
                    else -> Shell(core, booting = status is CoreStatus.Booting)
                }
                // vivo / iQOO: the Island check is due at the first launch after install or update, until it has been answered
                var check by remember { mutableStateOf(false) }
                androidx.compose.runtime.LaunchedEffect(onboarded) {
                    if (onboarded) check = ((core.native("island.status") as? org.json.JSONObject)?.optJSONObject("vivoSuperx")?.optBoolean("needCheck")) == true
                }
                if (check && onboarded) IslandCheckSheet(core) { check = false }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun Shell(core: Core, booting: Boolean, initialDest: LkDest = LkDest.Home, initialSection: String? = null, hideNavOnIme: Boolean = true) {
    var dest by rememberSaveable { mutableStateOf(initialDest) }
    var section by rememberSaveable { mutableStateOf(initialSection) }
    val approvals by core.approvals.collectAsState()
    val ime = WindowInsets.isImeVisible
    var toast by remember { mutableStateOf<Notice?>(null) }
    var hidden by remember { mutableStateOf(setOf<String>()) }
    LaunchedEffect(core) { core.notices.collect { toast = it; delay(3200); if (toast === it) toast = null } }
    val go = { d: LkDest, s: String? -> dest = d; section = s }
    BackHandler(enabled = dest != LkDest.Home) { if (section != null) section = null else dest = LkDest.Home }

    CompositionLocalProvider(LocalNav provides Nav(dest, section, go)) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)).imePadding()) {
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (dest) {
                    LkDest.Home -> HomeScreen(core, booting)
                    LkDest.Inbox -> InboxScreen(core)
                    LkDest.Today -> TodayScreen(core)
                    LkDest.Pc -> PcScreen(core)
                    LkDest.You -> YouScreen(core)
                }
                toast?.let { LkToast(it.text, Modifier.align(Alignment.BottomCenter).padding(horizontal = 16.dp, vertical = 8.dp)) }
            }
            if (!(ime && hideNavOnIme)) LkBottomNav(dest, { go(it, null) }, Modifier.padding(horizontal = 12.dp, vertical = 8.dp).windowInsetsPadding(WindowInsets.navigationBars), badges = if (approvals.isNotEmpty() && dest != LkDest.Home && dest != LkDest.Pc) mapOf(LkDest.Home to approvals.size) else emptyMap())
        }

        // Home and PC show approvals inline; everywhere else they come up as a sheet
        val next = approvals.firstOrNull { it.id !in hidden }
        if (dest != LkDest.Home && !(dest == LkDest.Pc && next?.source == ApprovalSource.Pc) && next != null) {
            LkSheet(if (next.source == ApprovalSource.Pc) "Your PC is asking" else "Lokey is asking", onDismiss = { hidden = hidden + next.id }) {
                LkApprovalCard(next.title, next.detail, { core.answerApproval(next, false) }, { core.answerApproval(next, true) }, source = if (next.source == ApprovalSource.Pc) "PC" else "Lokey")
            }
        }
    }
}

@Composable
private fun Failure(error: String, retry: () -> Unit) {
    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing), Arrangement.Center) {
        LkEmpty("Lokey could not start", error.lineSequence().firstOrNull().orEmpty().ifBlank { "The assistant core did not start." }, action = "Try again", onAction = retry)
    }
}

@Preview(widthDp = 380, heightDp = 780) @Composable
private fun AppPreview() = LokeyApp(FakeCore())

@Preview(widthDp = 380, heightDp = 780) @Composable
private fun AppEmptyPreview() = LokeyApp(FakeCore(FakeCore.Scenario.Empty))
