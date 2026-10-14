package app.lokey.link

import android.content.ComponentName
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject

/**
 * media.get / media.control: any music app, through the active MediaSessions. Reading sessions needs the notification-listener
 * access (LokeyNotifs); without it media.get returns hasSession:false with needsListener:true.
 */
object MediaApi {
    private var controllers: List<MediaController> = emptyList()
    private var attached = false
    @Volatile private var selected: String? = null
    private var debounce = false
    private var artKey = ""
    private var artUrl: String? = null

    private val listenerComp get() = ComponentName(App.ctx, LokeyNotifs::class.java)

    private val cb = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) = changed()
        override fun onMetadataChanged(metadata: MediaMetadata?) = changed()
        override fun onSessionDestroyed() = changed()
    }

    @Synchronized fun attach(): Boolean {
        if (!Perms.granted("notification-listener")) { attached = false; return false }
        return try {
            val m = App.ctx.getSystemService(MediaSessionManager::class.java)
            if (!attached) m.addOnActiveSessionsChangedListener({ set(it.orEmpty()) }, listenerComp, App.ui)
            attached = true
            set(m.getActiveSessions(listenerComp))
            true
        } catch (e: SecurityException) { attached = false; false }
    }

    fun detach() { attached = false }

    @Synchronized private fun set(list: List<MediaController>) {
        controllers.forEach { runCatching { it.unregisterCallback(cb) } }
        controllers = list
        list.forEach { it.registerCallback(cb, App.ui) }
        changed()
    }

    private fun changed() {
        if (debounce) return
        debounce = true
        App.ui.postDelayed({ debounce = false; runCatching { Events.emit("media.changed", state()); LokeyWidget.refresh(App.ctx); Island.onMedia() } }, 120)
    }

    private fun isPlaying(c: MediaController) = c.playbackState?.state.let { it == PlaybackState.STATE_PLAYING || it == PlaybackState.STATE_BUFFERING }

    fun playing(): Boolean = controllers.any(::isPlaying)

    private fun current(): MediaController? = controllers.firstOrNull { it.packageName == selected } ?: controllers.firstOrNull(::isPlaying) ?: controllers.firstOrNull()

    private fun label(pkg: String): String = runCatching { App.ctx.packageManager.let { it.getApplicationLabel(it.getApplicationInfo(pkg, 0)).toString() } }.getOrDefault(pkg)

    private fun art(md: MediaMetadata?): String? {
        md ?: return null
        val key = (md.getString(MediaMetadata.METADATA_KEY_TITLE) ?: "") + "|" + (md.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: "") + "|" + (md.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: "")
        if (key == artKey && artUrl != null) return artUrl
        var bmp: Bitmap? = listOf(MediaMetadata.METADATA_KEY_ALBUM_ART, MediaMetadata.METADATA_KEY_ART, MediaMetadata.METADATA_KEY_DISPLAY_ICON).firstNotNullOfOrNull { md.getBitmap(it) }
        if (bmp == null) {
            val u = listOf(MediaMetadata.METADATA_KEY_ALBUM_ART_URI, MediaMetadata.METADATA_KEY_ART_URI, MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI).firstNotNullOfOrNull { md.getString(it) }
            if (u != null && u.startsWith("content:")) bmp = runCatching { App.ctx.contentResolver.openInputStream(Uri.parse(u))?.use { android.graphics.BitmapFactory.decodeStream(it) } }.getOrNull()
        }
        artKey = key; artUrl = bmp?.fit(320)?.dataUrl()
        return artUrl
    }

    fun state(): JSONObject {
        if (!attached) attach()
        val c = current()
        if (c == null) return obj("hasSession" to false, "app" to "", "title" to "", "artist" to "", "album" to "", "playing" to false, "positionMs" to 0, "durationMs" to 0,
            "sampledAt" to System.currentTimeMillis(), "art" to null, "canNext" to false, "canPrev" to false, "sessions" to JSONArray(), "currentSession" to null, "needsListener" to !attached)
        val md = c.metadata; val ps = c.playbackState
        val playing = isPlaying(c)
        val dur = (md?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0).coerceAtLeast(0)
        var pos = ps?.position?.coerceAtLeast(0) ?: 0
        // position is as of ps.lastPositionUpdateTime (elapsedRealtime): move it up to "now" so sampledAt can be the wall clock
        if (ps != null && playing) pos += ((SystemClock.elapsedRealtime() - ps.lastPositionUpdateTime) * ps.playbackSpeed).toLong()
        if (dur > 0) pos = pos.coerceAtMost(dur)
        val acts = ps?.actions ?: 0
        return obj(
            "hasSession" to true, "app" to label(c.packageName),
            "title" to (md?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: ""),
            "artist" to (md?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: md?.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: md?.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE) ?: ""),
            "album" to (md?.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: ""),
            "playing" to playing, "positionMs" to pos, "durationMs" to dur, "sampledAt" to System.currentTimeMillis(), "art" to art(md),
            "canNext" to (acts and PlaybackState.ACTION_SKIP_TO_NEXT != 0L), "canPrev" to (acts and PlaybackState.ACTION_SKIP_TO_PREVIOUS != 0L),
            "sessions" to arr(controllers.map { obj("id" to it.packageName, "app" to label(it.packageName), "playing" to isPlaying(it)) }),
            "currentSession" to c.packageName,
        )
    }

    private fun control(p: JSONObject): JSONObject {
        if (!attached) attach()
        val c = current() ?: return fail(if (attached) "nothing is playing" else "needs notification access (perm.request notification-listener)")
        val t = c.transportControls
        when (p.str("action")) {
            "play" -> t.play(); "pause" -> t.pause(); "next" -> t.skipToNext(); "prev" -> t.skipToPrevious()
            "toggle" -> if (isPlaying(c)) t.pause() else t.play()
            "seek" -> t.seekTo(p.long("positionMs"))
            else -> return fail("unknown action")
        }
        changed()
        return ok()
    }

    fun methods(): Map<String, H> = mapOf(
        "media.get" h { state() },
        "media.control" h { control(it) },
        "media.selectSession" h { selected = it.str("id"); changed(); obj() },
    )
}
