package app.lokey.link.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.lokey.link.core.Core
import app.lokey.link.core.NativeResult
import app.lokey.link.ui.kit.LkButton
import app.lokey.link.ui.kit.LkButtonKind
import app.lokey.link.ui.kit.LkSheet
import app.lokey.link.ui.theme.Lk
import org.json.JSONObject

/**
 * The "Island check" (vivo / iQOO only): posts the full-schema test pill and asks the user whether the system pill around the camera showed.
 * Yes -> route full, style System, showed yes (our overlay pill steps aside). No -> route subset, style Overlay. Nothing is assumed: only the answer decides.
 */
@Composable
fun IslandCheckBody(core: Core, onDone: () -> Unit) {
    var phase by remember { mutableStateOf(0) }   // 0 intro, 1 asking
    var msg by remember { mutableStateOf("") }
    val launch = rememberLauncher()
    val cfg = { j: JSONObject -> launch { core.native("island.vivoProbe", JSONObject().put("end", true)); core.native("island.setEnabled", j); onDone() } }
    Text("Look at the top of the screen, around the camera. Lokey will show a test pill for 30 seconds.", color = Lk.colors.muted, style = Lk.type.body)
    if (phase == 0) {
        LkButton("Show the test pill", {
            launch {
                val r = core.native("island.vivoProbe", JSONObject().put("kind", "approval").put("route", "full")) as? JSONObject
                if (r == null || NativeResult.failed(r)) msg = "Could not show it: ${NativeResult.reason(r) ?: "no answer from the phone"}." else { msg = ""; phase = 1 }
            }
        }, Modifier.fillMaxWidth())
        if (msg.isNotEmpty()) Text(msg, color = Lk.colors.warn, style = Lk.type.caption)
    } else {
        Text("Is the pill around the camera showing?", color = Lk.colors.text, style = Lk.type.rowTitle)
        Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(10.dp)) {
            LkButton("Yes", { cfg(JSONObject().put("vivoRoute", "full").put("vivoStyle", "system").put("vivoShowed", true).put("vivoCheck", true)) }, Modifier.weight(1f))
            LkButton("No", { cfg(JSONObject().put("vivoRoute", "subset").put("vivoStyle", "overlay").put("vivoShowed", false).put("vivoCheck", true)) }, Modifier.weight(1f), kind = LkButtonKind.Quiet)
        }
    }
}

@Composable
fun IslandCheckSheet(core: Core, onClose: () -> Unit) {
    LkSheet("Island check", onClose) {
        IslandCheckBody(core, onClose)
        val launch = rememberLauncher()
        LkButton("Later", { launch { core.native("island.vivoProbe", JSONObject().put("end", true)); onClose() } }, Modifier.fillMaxWidth(), kind = LkButtonKind.Quiet)
    }
}
