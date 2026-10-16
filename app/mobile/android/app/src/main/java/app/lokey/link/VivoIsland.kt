package app.lokey.link

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle
import android.util.Log
import app.lokey.link.core.NativeResult
import org.json.JSONObject

/** Pure helpers (JVM-tested): which scene / template a face kind uses. */
object VivoMap {
    /** vivo's documented scenes (spelled as in their docs: DELIEVERY, METTING). Others exist on vivo's side; these are the ones in the public page. */
    val SCENES = listOf("MOVIE", "HEALTH_REGISTER", "TAXI", "TAKEOUT", "DELIEVERY", "NAVIGATION", "CAR_STATE", "METTING", "TRAIN", "FLIGHT")

    /** EXPERIMENTAL guesses: none of vivo's scenes is "an assistant", so each kind takes the closest-feeling one. Configurable (island.setEnabled {vivoScenes}). */
    val DEFAULT_SCENES = mapOf("voice" to "METTING", "timer" to "TAKEOUT", "job" to "DELIEVERY", "approval" to "HEALTH_REGISTER", "pc" to "CAR_STATE", "reminder" to "FLIGHT")

    /** 1 priority info, 2 progress visualisation, 4 basic card */
    fun template(kind: String) = when (kind) { "timer", "job" -> 2; "approval" -> 1; else -> 4 }

    fun scene(kind: String, custom: Map<String, String>): String = custom[kind]?.takeIf { it in SCENES } ?: DEFAULT_SCENES[kind] ?: "HEALTH_REGISTER"

    /** the documented 10 s per-activity update limit: how long to wait before the next update may be sent (0 = now) */
    fun waitMs(lastPostAt: Long, now: Long, minGap: Long = 10_000L): Long = if (lastPostAt <= 0) 0 else maxOf(0, lastPostAt + minGap - now)
}

/**
 * EXPERIMENT: vivo's Origin Island (原子岛 / 原子通知) client route, as publicly documented (help.aliyun.com/zh/document_detail/3030718, quoting vivo's
 * guide): ordinary notification EXTRAS on a HIGH-importance channel. vivo says access must be approved by vivo (apply through the vivo developer
 * platform, doc 894); without that the system may simply ignore the extras. We cannot know from here whether a sideloaded app is honoured, which is
 * what island.vivoProbe is for. No package names are spoofed.
 *
 * Documented local keys, all sent: notification.superx.operation (int 0 create / 1 update / 2 end), .showNotify (boolean, true = fall back to a
 * normal notification), .template (int), .clickResp (PendingIntent), .scene (String), .baseInfos (Bundle with .baseInfos.icon Icon,
 * .baseInfos.title, .baseInfos.content). NOT documented for the local route: the Bundle schema of the capsule / island / progressInfo / subInfo
 * data (those names exist only in the remote push JSON), so they are not sent and a progress / basic template falls back to baseInfos only.
 */
object VivoIsland : AtomicIslandAdapter {
    private const val TAG = "LokeyVivo"
    private const val P = "notification.superx."
    @Volatile var attempted = false

    fun enabled() = App.prefs.getBoolean("vivo_island", true)
    fun isVivoDevice() = Build.MANUFACTURER.lowercase().let { it.contains("vivo") || it.contains("iqoo") } || Build.BRAND.lowercase().let { it.contains("vivo") || it.contains("iqoo") }
    override fun available() = enabled() && isVivoDevice()
    override fun publish(faces: List<Face>) { VivoSuperX.publish(App.ctx, faces) }   // subset route: the extras ride on the Live Update notifications (LiveUpdates.build); route "full": VivoSuperX posts its own pill

    fun scenes(): Map<String, String> = runCatching { JSONObject(App.prefs.getString("vivo_scenes", "{}")).let { j -> j.keys().asSequence().associateWith { j.getString(it) } } }.getOrDefault(emptyMap())

    fun setScenes(m: JSONObject) {
        val cur = JSONObject(scenes().toMap())
        m.keys().forEach { k -> val v = m.optString(k); if (v in VivoMap.SCENES && k in VivoMap.DEFAULT_SCENES) cur.put(k, v) }
        App.prefs.edit().putString("vivo_scenes", cur.toString()).apply()
    }

    /** the extras Bundle for a face; op 0 create, 1 update, 2 end */
    fun extras(c: Context, f: Face, op: Int, click: PendingIntent): Bundle {
        val icon: Icon = Island.iconFor(f)?.let { Icon.createWithBitmap(it) } ?: Icon.createWithResource(c, R.drawable.ic_lokey)
        val base = Bundle().apply {
            putParcelable(P + "baseInfos.icon", icon)
            putCharSequence(P + "baseInfos.title", f.title.ifEmpty { "Lokey" })
            putCharSequence(P + "baseInfos.content", f.subtitle.ifEmpty { f.title })
        }
        return Bundle().apply {
            putInt(P + "operation", op)
            putBoolean(P + "showNotify", true)
            putInt(P + "template", VivoMap.template(f.kind))
            putParcelable(P + "clickResp", click)
            putString(P + "scene", VivoMap.scene(f.kind, scenes()))
            putBundle(P + "baseInfos", base)
        }
    }

    fun decorate(b: Notification.Builder, c: Context, f: Face, op: Int, click: PendingIntent) {
        if (!enabled() || (VivoSuperX.routeFull() && f.id != VivoSuperX.PROBE_ID)) return   // route "full" sends its own notification instead
        attempted = true
        b.addExtras(extras(c, f, op, click))
        if (VivoMap.template(f.kind) != 1) Log.i(TAG, "template ${VivoMap.template(f.kind)} for ${f.kind}: vivo documents no local schema for progressInfo/subInfo, sending baseInfos only")
    }

    /** vivo's getSceneStatus lives in their push SDK, which is not bundled; reached by reflection only if present */
    fun sceneStatus(c: Context, scene: String): Any? = runCatching {
        val cls = Class.forName("com.vivo.push.PushClient")
        val inst = cls.getMethod("getInstance", Context::class.java).invoke(null, c)
        cls.methods.firstOrNull { it.name == "getSceneStatus" }?.let { m -> if (m.parameterCount == 1) m.invoke(inst, scene) else null }
    }.getOrNull()

    fun status(c: Context): JSONObject = obj("attempted" to attempted, "enabled" to enabled(), "vivoDevice" to isVivoDevice(), "sceneStatus" to sceneStatus(c, VivoMap.scene("approval", scenes())),
        "sceneStatusNote" to "needs vivo's push SDK (getSceneStatus); not bundled, so null", "scenes" to JSONObject(VivoMap.DEFAULT_SCENES.mapValues { VivoMap.scene(it.key, scenes()) }.toMap()),
        "manufacturer" to Build.MANUFACTURER, "brand" to Build.BRAND,
        "route" to VivoSuperX.route(), "style" to VivoSuperX.style(), "showed" to VivoSuperX.showed(), "needCheck" to VivoSuperX.needsCheck(), "lastFullProbe" to VivoSuperX.lastProbe)

    @Volatile private var subsetEnd: Runnable? = null

    private fun subsetFace(kind: String) = Face(VivoSuperX.PROBE_ID, kind, "Lokey island test", "If this is on the island, vivo accepted it")
    private fun fullFace(kind: String) = Face("vivo-probe-full", kind, if (kind == "voice") "Thinking..." else "Lokey island test", "If this is on the island, vivo accepted it", progress = if (kind == "timer" || kind == "job") 0.4 else null)

    private fun endSubset(c: Context, f: Face) {
        subsetEnd?.let { App.ui.removeCallbacks(it) }; subsetEnd = null
        runCatching { LiveUpdates.endNow(c, f) }
    }

    private fun probeSubset(c: Context, face: Face): JSONObject {
        val nm = c.getSystemService(NotificationManager::class.java)
        LiveUpdates.channels(c)
        val n = LiveUpdates.build(c, face, op = 0)
        nm.notify(LiveUpdates.id(face.id), n)
        attempted = true
        subsetEnd?.let { App.ui.removeCallbacks(it) }
        subsetEnd = Runnable { endSubset(c, face) }.also { App.ui.postDelayed(it, 30_000) }   // the test ends itself after 30 s
        val back = nm.activeNotifications.firstOrNull { it.id == LiveUpdates.id(face.id) }?.notification?.extras
        val keys = back?.keySet()?.filter { it.startsWith(P) }.orEmpty()
        val ch = nm.getNotificationChannel(n.channelId)
        return ok("route" to "subset", "posted" to (back != null), "extrasReadBack" to keys, "extrasKept" to keys.isNotEmpty(), "scene" to VivoMap.scene(face.kind, scenes()), "template" to VivoMap.template(face.kind),
            "channelImportance" to ch?.importance, "canPromote" to LiveUpdates.canPromote(c),
            "promotable" to (if (Build.VERSION.SDK_INT >= 36) runCatching { n.javaClass.getMethod("hasPromotableCharacteristics").invoke(n) as Boolean }.getOrNull() else null))
    }

    /**
     * island.vivoProbe {kind?:'approval', route?:'subset'|'full'|'both', end?:bool}: posts one island notification and reads back which extras the system kept.
     * 'both' posts the documented subset now, ends it after 20 s and then posts the full schema (its read-back lands in island.status vivoSuperx.lastFullProbe).
     * Whether anything shows on screen is for the user to say (island.setEnabled {vivoShowed}); never assumed.
     */
    fun probe(c: Context, p: JSONObject): JSONObject {
        val kind = p.str("kind", "approval").let { if (it in IslandModel.LIVE_KINDS) it else "approval" }
        val route = p.str("route", "subset").let { if (it in listOf("subset", "full", "both")) it else "subset" }
        if (p.bool("end")) { if (subsetEnd != null) endSubset(c, subsetFace(kind)); VivoSuperX.end(c); return ok("ended" to true) }
        if (!Perms.granted("notifications")) return fail("notifications are off (perm.request notifications)")
        if (!enabled()) return fail("vivo island is switched off (island.setEnabled {vivo:true})")
        val sf = subsetFace(kind)
        val r = when (route) {
            "full" -> VivoSuperX.probe(c, fullFace(kind))
            "both" -> probeSubset(c, sf).also {
                App.ui.postDelayed({ endSubset(c, sf); App.ui.postDelayed({ runCatching { VivoSuperX.probe(c, fullFace(kind)) } }, 1600) }, 20_000)
                it.put("fullInSec", 22)
            }
            else -> probeSubset(c, sf)
        }
        if (NativeResult.failed(r)) return r
        return r.put("vivoDevice", isVivoDevice()).put("sceneStatus", sceneStatus(c, VivoMap.scene(kind, scenes()))).put("style", VivoSuperX.style()).put("showed", VivoSuperX.showed())
            .put("note", "extrasKept only proves the notification carries the extras; whether the island shows it is what you must look at on screen. Ends itself in 30 s.")
    }
}
