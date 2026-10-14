package app.lokey.link

import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import org.json.JSONObject
import rikka.shizuku.Shizuku
import java.io.DataInputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The optional power tier: `shizuku.*` (status, permission, guide), `bg.*` (a second, virtual screen that tasks run on while the user keeps
 * using the phone) and `priv.*` (allow-listed shell commands and silent input on the real screen). All of it goes through BgService, the
 * Shizuku user service in a shell-privileged process. Nothing here is available without Shizuku running and Lokey allowed in it; every
 * failure is a plain reason, never a crash. See docs/SHIZUKU-TIER.md and PLUGIN.md. Not yet run on a phone.
 */
object ShizukuApi {
    private const val MANAGER = "moe.shizuku.privileged.api"
    private const val REQ = 4242
    private const val FRAME_EVENT_GAP_MS = 500L

    @Volatile private var svc: IBgService? = null
    private var conn: ServiceConnection? = null
    private var args: Shizuku.UserServiceArgs? = null
    private val lock = Any()
    @Volatile private var display: JSONObject? = null
    @Volatile private var lastFrameEvent = 0L
    @Volatile private var frameSeq = 0
    @Volatile private var probeAt = 0L
    @Volatile private var probe: JSONObject? = null
    @Volatile private var permResult: CountDownLatch? = null
    @Volatile private var permGranted = false
    private var listening = false

    fun methods(): Map<String, H> = mapOf(
        "shizuku.status" h { status(it.bool("probe", true)) },
        "shizuku.request" h { request() },
        "shizuku.openGuide" h { guide(it.str("page", "app")) },
        "bg.start" h { start(it) },
        "bg.state" h { state() },
        "bg.launch" h { launch(it) },
        "bg.frame" h { frame(it.int("quality", 60), it.int("maxWidth", 720)) },
        "bg.tap" h { svcCall("tap", obj("x" to it.num("x"), "y" to it.num("y"))) },
        "bg.longPress" h { svcCall("longPress", obj("x" to it.num("x"), "y" to it.num("y"), "ms" to it.long("ms", 700))) },
        "bg.swipe" h { svcCall("swipe", obj("x1" to it.num("x1"), "y1" to it.num("y1"), "x2" to it.num("x2"), "y2" to it.num("y2"), "ms" to it.long("ms", 300))) },
        "bg.text" h { text(it.str("text")) },
        "bg.key" h { svcCall("key", obj("key" to it.need("key"))) },
        "bg.ui" h { ui(it.int("maxNodes", 350)) },
        "bg.foreground" h { svcCall("foreground") },
        "bg.stop" h { stop(it.bool("keepService", false)) },
        "priv.shell" h { shellCmd(it.need("command")) },
        "priv.input" h { priv(it) },
    )

    // ---- Shizuku itself ------------------------------------------------------------------------------------------------------
    private fun installed() = runCatching { App.ctx.packageManager.getPackageInfo(MANAGER, 0); true }.getOrDefault(false)
    private fun running() = runCatching { Shizuku.pingBinder() }.getOrDefault(false)
    private fun granted() = running() && runCatching { Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED }.getOrDefault(false)

    private fun ensureListeners() {
        if (listening) return
        listening = true
        runCatching {
            Shizuku.addRequestPermissionResultListener { code, result -> if (code == REQ) { permGranted = result == PackageManager.PERMISSION_GRANTED; permResult?.countDown() } }
            Shizuku.addBinderDeadListener { svc = null; display = null; Events.emit("bg.state", obj("active" to false, "reason" to "Shizuku stopped")); Events.emit("bg.error", obj("reason" to "Shizuku stopped: start it again (wireless debugging)")) }
        }
    }

    /** what the Power tier page shows: installed, running, allowed, version, and (probed once a minute) whether a second screen can be created at all */
    private fun status(doProbe: Boolean): JSONObject {
        ensureListeners()
        val inst = installed(); val run = running(); val perm = granted()
        val out = obj("installed" to inst, "running" to run, "permissionGranted" to perm, "sdk" to Build.VERSION.SDK_INT, "brand" to Build.BRAND, "model" to Build.MODEL,
            "version" to (if (run) runCatching { Shizuku.getVersion() }.getOrNull() else null), "uid" to (if (run) runCatching { Shizuku.getUid() }.getOrNull() else null),
            "serviceBound" to (svc?.asBinder()?.pingBinder() == true), "display" to display)
        val reason = when {
            !inst -> "Shizuku is not installed."
            !run -> "Shizuku is installed but not running. Start it again with wireless debugging (it stops at every reboot)."
            runCatching { Shizuku.isPreV11() }.getOrDefault(false) -> "Shizuku is too old: update it."
            !perm -> "Lokey is not allowed in Shizuku yet."
            else -> null
        }
        out.put("canCreateDisplay", JSONObject.NULL)
        if (reason != null) return out.put("reason", reason)
        if (doProbe) {
            val p = probe?.takeIf { SystemClock.elapsedRealtime() - probeAt < 60_000 } ?: probeDisplay().also { probe = it; probeAt = SystemClock.elapsedRealtime() }
            out.put("canCreateDisplay", p.optBoolean("ok")); out.put("probe", p)
            if (!p.optBoolean("ok")) out.put("reason", p.optString("reason", "A second screen could not be created on this phone."))
        }
        return out
    }

    /** creates a tiny display and throws it away: the one honest answer to "can this phone do it" */
    private fun probeDisplay(): JSONObject = try {
        val had = display != null
        if (had) obj("ok" to true, "note" to "a second screen is already running")
        else {
            val info = sc("probe")
            val d = sc("display.create", obj("width" to 360, "height" to 640, "dpi" to 240, "idleMs" to 0))
            sc("display.destroy")
            obj("ok" to true, "displayId" to d.opt("displayId"), "ime" to d.opt("ime"), "uid" to info.opt("uid"), "inputReady" to info.opt("input"), "release" to info.opt("release"))
        }
    } catch (f: Fail) { obj("ok" to false, "reason" to f.reason) }

    private fun request(): JSONObject {
        ensureListeners()
        if (!installed()) return fail("Shizuku is not installed")
        if (!running()) return fail("Shizuku is not running: start it first (wireless debugging)")
        if (granted()) return ok("granted" to true)
        if (runCatching { Shizuku.shouldShowRequestPermissionRationale() }.getOrDefault(false)) return fail("Lokey was denied for good in Shizuku: open Shizuku > Authorized apps and allow Lokey").put("granted", false)
        val l = CountDownLatch(1); permResult = l; permGranted = false
        Shizuku.requestPermission(REQ)
        l.await(60, TimeUnit.SECONDS)
        return if (permGranted) ok("granted" to true) else fail("Shizuku permission was not given").put("granted", false)
    }

    /** page: app (open Shizuku), dev (developer options: wireless debugging), web (the setup guide), get (where to download Shizuku) */
    private fun guide(page: String): JSONObject {
        val pm = App.ctx.packageManager
        val opened = when (page) {
            "app" -> pm.getLaunchIntentForPackage(MANAGER)?.let { App.ctx.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } ?: false
            "dev" -> Perms.open(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
            "web" -> Perms.open(Intent.ACTION_VIEW, "https://shizuku.rikka.app/guide/setup/")
            "get" -> Perms.open(Intent.ACTION_VIEW, "https://shizuku.rikka.app/download/") || Perms.open(Intent.ACTION_VIEW, Uri.parse("https://github.com/RikkaApps/Shizuku/releases").toString())
            else -> return fail("unknown guide page: $page")
        }
        return if (opened) ok("page" to page) else fail(if (page == "app") "Shizuku is not installed" else "could not open $page")
    }

    // ---- the service ----------------------------------------------------------------------------------------------------------
    private fun ensureReady() {
        ensureListeners()
        if (!running()) throw Fail(if (installed()) "Shizuku is not running: start it again with wireless debugging (shizuku.openGuide)" else "Shizuku is not installed (shizuku.openGuide get)")
        if (runCatching { Shizuku.isPreV11() }.getOrDefault(false)) throw Fail("Shizuku is too old: update it")
        if (!granted()) throw Fail("permission needed: shizuku (shizuku.request)")
    }

    private fun bind(): IBgService {
        svc?.takeIf { it.asBinder().pingBinder() }?.let { return it }
        synchronized(lock) {
            svc?.takeIf { it.asBinder().pingBinder() }?.let { return it }
            ensureReady()
            val code = runCatching { App.ctx.packageManager.getPackageInfo(App.pkg, 0).longVersionCode.toInt() }.getOrDefault(1)
            val a = Shizuku.UserServiceArgs(ComponentName(App.pkg, BgService::class.java.name)).daemon(false).processNameSuffix("bg").debuggable(false).version(code).tag("lokey-bg")
            val latch = CountDownLatch(1)
            val c = object : ServiceConnection {
                override fun onServiceConnected(n: ComponentName?, b: IBinder?) { svc = b?.takeIf { it.pingBinder() }?.let { IBgService.Stub.asInterface(it) }; latch.countDown() }
                override fun onServiceDisconnected(n: ComponentName?) { svc = null; display = null; Events.emit("bg.state", obj("active" to false, "reason" to "the Shizuku service stopped")) }
            }
            runCatching { conn?.let { Shizuku.unbindUserService(args!!, it, true) } }
            args = a; conn = c
            Shizuku.bindUserService(a, c)
            if (!latch.await(12, TimeUnit.SECONDS) || svc == null) { Events.emit("bg.error", obj("reason" to "Shizuku did not start the Lokey service")); throw Fail("Shizuku did not start the Lokey service in 12 s (is it still running?)") }
            return svc!!
        }
    }

    /** one call into the service; failures become Fail(reason) */
    private fun sc(method: String, p: JSONObject = obj()): JSONObject {
        val s = bind()
        val r = try { JSONObject(s.call(method, p.toString())) } catch (e: android.os.DeadObjectException) { svc = null; display = null; Events.emit("bg.error", obj("reason" to "lost the Shizuku service")); throw Fail("lost the Shizuku service (Shizuku may have stopped)") } catch (e: android.os.RemoteException) { throw Fail("the Shizuku service did not answer: ${e.message}") }
        if (!r.optBoolean("ok", true)) throw Fail(r.optString("reason", "$method failed"))
        return r
    }

    private fun svcCall(method: String, p: JSONObject = obj()): JSONObject {
        val r = sc(method, p)
        if (method == "tap" || method == "swipe" || method == "longPress" || method == "key" || method == "text") touch()
        return r
    }

    private fun touch() { /* the service's own idle guard tracks frame requests; input needs no extra bookkeeping */ }

    // ---- bg.* -------------------------------------------------------------------------------------------------------------------
    private fun start(p: JSONObject): JSONObject {
        display?.let { if (svc?.asBinder()?.pingBinder() == true) return it.put("ok", true).put("reused", true) }
        val dm = App.ctx.resources.displayMetrics
        val w = p.int("width", 720)
        val h = p.int("height", ((w.toDouble() * dm.heightPixels / dm.widthPixels).toInt() / 2) * 2)
        val r = sc("display.create", obj("width" to w, "height" to h, "dpi" to p.int("dpi", 320), "idleMs" to p.long("idleMs", 20_000), "decorations" to p.bool("decorations", false)))
        display = r
        Events.emit("bg.state", obj("active" to true, "displayId" to r.opt("displayId"), "width" to r.opt("width"), "height" to r.opt("height"), "dpi" to r.opt("dpi")))
        return r
    }

    private fun state(): JSONObject = (display ?: obj("active" to false)).let { obj("ok" to true, "active" to (display != null && svc?.asBinder()?.pingBinder() == true), "display" to display) }

    private fun launch(p: JSONObject): JSONObject {
        val pkg = p.str("package").ifEmpty { p.need("pkg") }
        if (ShizukuAllow.denyPackage(pkg)) throw Fail("Lokey never operates $pkg (banking, payment, wallet, password or authenticator apps)")
        var activity = p.str("activity")
        if (activity.isEmpty()) activity = runCatching { App.ctx.packageManager.getLaunchIntentForPackage(pkg)?.component?.className }.getOrNull().orEmpty()
        val r = sc("launch", obj("pkg" to pkg, "activity" to activity, "fresh" to p.bool("fresh", false)))
        Events.emit("bg.state", obj("active" to true, "displayId" to display?.opt("displayId"), "pkg" to pkg))
        return r
    }

    private fun frame(q: Int, maxW: Int): JSONObject {
        val pfd: ParcelFileDescriptor = bind().frame(q, maxW) ?: throw Fail("no second screen yet (bg.start)")
        val fr = DataInputStream(ParcelFileDescriptor.AutoCloseInputStream(pfd).buffered()).use { i ->
            val w = i.readInt(); val h = i.readInt(); val age = i.readInt(); val fl = i.readUnsignedByte()
            Fr(w, h, age, fl, i.readBytes())
        }
        val bytes = fr.bytes; val w = fr.w; val h = fr.h; val age = fr.age; val flags = fr.flags
        val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
        val black = flags and 1 != 0
        val out = ok("jpegBase64" to b64, "mime" to "image/jpeg", "w" to w, "h" to h, "ageMs" to age, "black" to black, "stale" to (flags and 2 != 0), "seq" to ++frameSeq,
            "displayW" to display?.opt("width"), "displayH" to display?.opt("height"), "displayId" to display?.opt("displayId"))
        if (black) out.put("note", "the picture is black: the app has not drawn yet, or its window is secure (FLAG_SECURE) and Android blanks it")
        val now = SystemClock.elapsedRealtime()
        if (now - lastFrameEvent >= FRAME_EVENT_GAP_MS) { lastFrameEvent = now; Events.emit("bg.frame", obj("jpegBase64" to b64, "w" to w, "h" to h, "black" to black, "seq" to frameSeq)) }
        return out
    }

    private class Fr(val w: Int, val h: Int, val age: Int, val flags: Int, val bytes: ByteArray)

    private fun shellCmd(c: String): JSONObject {
        val v = ShizukuAllow.check(c, App.pkg)
        if (v.argv == null) throw Fail(v.error ?: "not allowed")
        return sc("shell", obj("command" to c))
    }

    private fun text(t: String): JSONObject {
        if (t.isEmpty()) throw Fail("no text")
        val r = JSONObject(bind().call("text", obj("text" to t).toString()))
        if (r.optBoolean("ok", true)) return r
        if (r.optBoolean("needsAccessibility")) return BgUi.setText(display?.optInt("displayId", -1) ?: -1, t)   // letters the key map does not have: Tamil, emoji...
        throw Fail(r.optString("reason", "typing failed"))
    }

    private fun ui(max: Int): JSONObject {
        val id = display?.optInt("displayId", -1) ?: -1
        if (id < 0) throw Fail("no second screen yet (bg.start)")
        return try { BgUi.tree(id, max) } catch (f: Fail) {
            // the accessibility service cannot see the display: ask uiautomator inside the shell process
            val r = try { sc("ui.dump") } catch (g: Fail) { throw Fail("${f.reason}; fallback: ${g.reason}") }
            r.put("note", "accessibility could not read it (${f.reason}); read with uiautomator")
        }
    }

    private fun stop(keepService: Boolean): JSONObject {
        val had = display != null
        display = null
        if (svc?.asBinder()?.pingBinder() == true) runCatching { JSONObject(svc!!.call("display.destroy", "{}")) }
        if (!keepService) {
            runCatching { conn?.let { Shizuku.unbindUserService(args!!, it, true) } }
            conn = null; svc = null
        }
        Events.emit("bg.state", obj("active" to false, "reason" to "stopped"))
        return ok("stopped" to had)
    }

    /** silent input and shell on the REAL screen (display 0) or any display id: tap, longPress, swipe, key, text */
    private fun priv(p: JSONObject): JSONObject {
        val d = p.int("display", 0)
        val body = JSONObject(p.toString()).put("display", d)
        return when (val a = p.need("action")) {
            "tap", "longPress", "swipe", "key", "text" -> sc(a, body)
            else -> throw Fail("priv.input: unknown action $a")
        }
    }

    /** a second screen must never outlive Lokey's own stop: the page calls bg.stop, the service is also bound non-daemon so Shizuku ends it when Lokey's process dies */
    @Suppress("unused") fun onDestroy() { runCatching { stop(false) } }
}
