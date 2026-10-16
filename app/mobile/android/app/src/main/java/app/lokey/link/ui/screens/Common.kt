package app.lokey.link.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.State
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import app.lokey.link.core.Core
import app.lokey.link.ui.kit.LkDest
import app.lokey.link.ui.kit.LkIconButton
import app.lokey.link.ui.kit.LkIcons
import app.lokey.link.ui.theme.Lk
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Where the app is and how to move: `go(LkDest.You, "island")` opens a sub page of You. */
class Nav(val dest: LkDest, val section: String?, val go: (LkDest, String?) -> Unit)
val LocalNav = compositionLocalOf { Nav(LkDest.Home, null) { _, _ -> } }

/** A page: big title with an optional line under it, scrolling content with a 16 dp gutter. */
@Composable
fun Page(title: String, modifier: Modifier = Modifier, line: String? = null, right: (@Composable () -> Unit)? = null, content: @Composable () -> Unit) {
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 16.dp), Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 4.dp, top = 4.dp), verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Text(title, color = Lk.colors.text, style = Lk.type.pageTitle, modifier = Modifier.semantics { heading() })
                if (line != null) Text(line, Modifier.padding(top = 3.dp), color = Lk.colors.muted, style = Lk.type.body.copy(fontSize = androidx.compose.ui.unit.TextUnit(13f, androidx.compose.ui.unit.TextUnitType.Sp)))
            }
            right?.invoke()
        }
        content()
    }
}

/** A sub page of You: back arrow and a 22 sp title. */
@Composable
fun SubPage(title: String, onBack: () -> Unit, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 24.dp), Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
            LkIconButton(LkIcons.Back, "Back", onBack)
            Text(title, Modifier.padding(start = 4.dp).semantics { heading() }, color = Lk.colors.text, style = Lk.type.title)
        }
        content()
    }
}

/** Runs [load] when shown, every [everyMs] while the screen is on, and again on return from a system settings screen. null until the first answer. */
@Composable
fun <T> poll(key: Any?, everyMs: Long = 0, load: suspend () -> T): State<T?> {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val preview = androidx.compose.ui.platform.LocalInspectionMode.current
    return produceState<T?>(null, key) {
        if (preview) { value = try { load() } catch (_: Exception) { null }; return@produceState }
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                value = try { load() } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { value }
                if (everyMs <= 0) break
                delay(everyMs)
            }
        }
    }
}

/** `patch("""{"voice":{"speakReplies":true}}""")`, a settings change sent to the core */
@Composable
fun rememberPatch(core: Core): (String) -> Unit {
    val scope = rememberCoroutineScope()
    return remember(core) { { json: String -> scope.launch { try { core.patchSettings(JSONObject(json)) } catch (_: Exception) { } }; Unit } }
}

@Composable
fun rememberLauncher(): (suspend () -> Unit) -> Unit {
    val scope = rememberCoroutineScope()
    return remember { { f: suspend () -> Unit -> scope.launch { try { f() } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { } }; Unit } }
}

/** a plugin call whose failure is a value: `{ok:false, reason}` is returned as such */
suspend fun Core.native(method: String, params: JSONObject = JSONObject()): Any? = try { nativeCall(method, params) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { JSONObject().put("ok", false).put("reason", e.message ?: "failed") }

fun JSONObject.at(vararg path: String): JSONObject? { var o: JSONObject? = this; for (p in path) o = o?.optJSONObject(p); return o }
fun JSONObject.flag(vararg path: String, default: Boolean = false): Boolean { val k = path.last(); return at(*path.dropLast(1).toTypedArray())?.takeIf { it.has(k) && !it.isNull(k) }?.optBoolean(k, default) ?: default }
fun JSONObject.text(vararg path: String, default: String = ""): String { val k = path.last(); return at(*path.dropLast(1).toTypedArray())?.takeIf { it.has(k) && !it.isNull(k) }?.optString(k, default) ?: default }
fun JSONObject.number(vararg path: String, default: Double = 0.0): Double { val k = path.last(); return at(*path.dropLast(1).toTypedArray())?.takeIf { it.has(k) && !it.isNull(k) }?.optDouble(k, default) ?: default }
