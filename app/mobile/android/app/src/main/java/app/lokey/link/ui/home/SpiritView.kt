package app.lokey.link.ui.home

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.webkit.WebViewAssetLoader
import app.lokey.link.core.SoulMode
import app.lokey.link.ui.theme.Lk
import org.json.JSONObject

/**
 * The existing WebGL spirit (src/mobile/spiritPage.tsx, the renderer's own `Spirit`) in one small plain WebView. The page comes from the app's
 * bundled web assets through a WebViewAssetLoader; no core runs in it. [onHold] reports its long-press (hold to talk).
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun SpiritView(mode: SoulMode, skin: String, calm: Boolean, size: Dp, onHold: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    if (LocalInspectionMode.current) { // previews cannot host a WebView: a quiet stand-in with the same footprint
        Box(modifier.size(size).background(Lk.colors.accentSoft, CircleShape)); return
    }
    val state = remember { SpiritState() }
    val json = JSONObject().put("mode", mode.name).put("skin", skin).put("calm", calm).toString()
    state.latest = json
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e -> when (e) { Lifecycle.Event.ON_PAUSE -> state.web?.onPause(); Lifecycle.Event.ON_RESUME -> state.web?.onResume(); else -> Unit } }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }
    AndroidView(
        modifier = modifier.size(size),
        factory = { ctx ->
            val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(ctx)).build()
            val main = Handler(Looper.getMainLooper())
            WebView(ctx).apply {
                state.web = this
                setBackgroundColor(0)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                addJavascriptInterface(object {
                    @JavascriptInterface fun hold(on: Boolean) { main.post { state.onHold(on) } }
                    @JavascriptInterface fun tap() = Unit
                }, "LokeySpirit")
                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
                    override fun onPageFinished(view: WebView, url: String?) { state.loaded = true; state.sent = ""; state.push() }
                }
                loadUrl("https://appassets.androidplatform.net/assets/public/index.html?spirit=1")
            }
        },
        update = { state.onHold = onHold; state.push() },
        onRelease = { it.destroy(); state.web = null },
    )
}

private class SpiritState {
    var web: WebView? = null
    var loaded = false
    var latest = "{}"
    var sent = ""
    var onHold: (Boolean) -> Unit = {}
    fun push() {
        val w = web ?: return
        if (!loaded || latest == sent) return
        sent = latest
        w.evaluateJavascript("window.__spirit&&window.__spirit.set(${JSONObject.quote(latest)})", null)
    }
}
