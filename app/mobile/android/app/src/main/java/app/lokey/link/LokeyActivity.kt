package app.lokey.link

import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.lifecycleScope
import app.lokey.link.core.IslandBridge
import app.lokey.link.core.WebCore
import app.lokey.link.ui.app.LokeyApp
import com.getcapacitor.BridgeActivity
import com.getcapacitor.CapConfig
import org.json.JSONObject

/**
 * The native app: one Compose activity over the headless core. It is still a Capacitor BridgeActivity, because the core runs in the Capacitor
 * WebView (page `/?headless=1`, no UI mounted) and the LokeyNative plugin answers its native calls; the WebView sits behind the Compose content.
 * MainActivity (the WebView UI) stays buildable; this one is the launcher only when the build property `nativeShell=true` is set (app/build.gradle).
 */
class LokeyActivity : BridgeActivity() {
    private var core: WebCore? = null
    private var island: IslandBridge? = null
    private var onboarded by mutableStateOf(true)

    @Suppress("DEPRECATION")
    override fun load() {
        // the same capacitor.config.json, started on the headless page
        val json = JSONObject(assets.open("capacitor.config.json").bufferedReader().use { it.readText() })
        val server = json.optJSONObject("server") ?: JSONObject().also { json.put("server", it) }
        server.put("appStartPath", "/?headless=1")
        config = CapConfig(assets, json)
        super.load()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(LokeyNative::class.java)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= 28) window.attributes = window.attributes.also { it.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES }
        val web: WebView? = bridge?.webView
        val c = web?.let { WebCore(it, lifecycleScope).also { w -> w.attach() } }
        core = c
        island = c?.let { IslandBridge(it, lifecycleScope).also { b -> b.start() } }
        if ((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true)
        onboarded = App.prefs.getBoolean(PREF_ONBOARDED, false)

        // Compose goes on top of the Capacitor layout (which holds the headless WebView)
        addContentView(ComposeView(this).apply {
            setContent {
                if (c != null) LokeyApp(c, onboarded, { App.prefs.edit().putBoolean(PREF_ONBOARDED, true).apply(); onboarded = true }, { App.prefs.edit().putBoolean(PREF_ONBOARDED, false).apply(); onboarded = false })
            }
        }, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // back never exits (the assistant keeps running): send the app to the background
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) { override fun handleOnBackPressed() { moveTaskToBack(true) } })
    }

    // Same lifecycle bookkeeping as MainActivity: the island and the microphone service depend on knowing whether Lokey is on screen.
    override fun onStart() {
        super.onStart()
        App.init(this); App.activity = this
        App.started++; App.foreground = true
        Island.refresh()
        runCatching { bridge?.webView?.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false) }
        LokeyService.sync(this)
    }

    override fun onStop() {
        super.onStop()
        App.started = maxOf(0, App.started - 1); App.foreground = App.started > 0
        Island.refresh()
    }

    override fun onDestroy() { island?.stop(); core?.close(); super.onDestroy() }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        Perms.onResult(requestCode, permissions, grantResults)
    }


    private companion object { const val PREF_ONBOARDED = "native_onboarded" }
}
