package app.lokey.link

import android.os.Bundle
import android.webkit.WebView
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(LokeyNative::class.java)
        super.onCreate(savedInstanceState)
    }

    // The overlay island and the wake-up must not depend on the page: the NATIVE layer knows whether Lokey is in front from here.
    // Capacitor keeps JS timers running while paused (KeepRunning defaults to true) and the renderer keeps its priority when hidden;
    // Chromium may still throttle a hidden page, which is why the island, wake word and PC link run natively.
    override fun onStart() {
        super.onStart()
        App.init(this); App.activity = this
        App.started++; App.foreground = true
        Island.refresh()
        runCatching { bridge?.webView?.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false) }
        LokeyService.sync(this)   // from the foreground: this is the moment a microphone service may start
    }

    override fun onStop() {
        super.onStop()
        App.started = maxOf(0, App.started - 1); App.foreground = App.started > 0
        Island.refresh()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        Perms.onResult(requestCode, permissions, grantResults)
    }
}
