package app.lokey.link

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import org.json.JSONArray
import org.json.JSONObject

/** Port of Lokey.Host ClapDetector (Services/Listener.cs): a small energy-onset detector. No Android types, so it is unit tested on the JVM. */
class ClapDetector {
    var sensitivity = 1.0
    private var floor = 0.01
    private var prevRms = 0.0
    private var lastOnset = -10_000L
    private var firstClap = -1L
    private var pendingRms = 0.0
    private var pendingAt = -1L

    /** one frame of audio (about 20 ms): its RMS and peak (0..1) and the time in ms. True when the second clap is confirmed. */
    fun feed(rms: Double, peak: Double, t: Long): Boolean {
        var done = false
        // confirm a candidate onset: the very next frame must be much quieter (a clap decays, a sustained sound does not)
        if (pendingAt >= 0) {
            val decayed = rms < pendingRms * 0.55
            val at = pendingAt; pendingAt = -1
            if (decayed) {
                if (firstClap >= 0 && at - firstClap in 140L..700L) { firstClap = -1; done = true } else firstClap = at
            }
        }
        if (rms < floor * 2.5) floor += (rms - floor) * 0.02
        floor = maxOf(floor, 0.002)
        val threshold = maxOf(0.07, floor * 10) / maxOf(0.4, sensitivity)
        if (peak > threshold && rms > prevRms * 2.5 && t - lastOnset > 90 && pendingAt < 0 && !done) { lastOnset = t; pendingAt = t; pendingRms = rms }
        prevRms = rms
        if (firstClap >= 0 && t - firstClap > 700) firstClap = -1
        return done
    }
}

/** Phrase spotting is pluggable: anything that can listen for phrases and call back with the phrase and its confidence. */
interface PhraseSpotter {
    val name: String
    fun available(c: Context): Boolean
    fun start(c: Context, phrases: List<String>, confidence: Double, onHit: (phrase: String, confidence: Double) -> Unit)
    fun stop()
}

/**
 * Phrase spotter on the platform SpeechRecognizer, restarted in a loop. HONEST STATUS: written but not tested on a device. It is a
 * heavy way to spot a phrase (the recogniser runs continuously, many OEM engines beep or mute on every restart, and on Android 12+ a
 * microphone indicator shows). A real keyword spotter (a small on-device model) would replace this class behind the same interface.
 */
class SpeechPhraseSpotter : PhraseSpotter {
    override val name = "Android SpeechRecognizer (loop)"
    private var rec: SpeechRecognizer? = null
    @Volatile private var on = false

    override fun available(c: Context) = SpeechRecognizer.isRecognitionAvailable(c)

    private fun norm(s: String) = s.lowercase().replace(Regex("[^\\p{L}\\p{N} ]"), "").trim()

    override fun start(c: Context, phrases: List<String>, confidence: Double, onHit: (String, Double) -> Unit) {
        on = true
        val wanted = phrases.map(::norm).filter { it.isNotEmpty() }
        App.ui.post {
            fun listen() {
                if (!on) return
                rec?.destroy()
                val r = SpeechRecognizer.createSpeechRecognizer(c); rec = r
                fun check(b: Bundle?, final: Boolean) {
                    val l = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: return
                    val sc = b.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)
                    for ((i, t) in l.withIndex()) {
                        val n = norm(t); val p = wanted.firstOrNull { n.contains(it) } ?: continue
                        val conf = sc?.getOrNull(i)?.toDouble()?.takeIf { it >= 0 } ?: if (final) 0.9 else 0.85
                        if (conf >= confidence) { onHit(p, conf); return }
                    }
                }
                r.setRecognitionListener(object : RecognitionListener {
                    override fun onResults(b: Bundle?) { check(b, true); App.ui.postDelayed({ listen() }, 250) }
                    override fun onPartialResults(b: Bundle?) = check(b, false)
                    override fun onError(e: Int) { App.ui.postDelayed({ listen() }, if (e == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || e == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) 3000 else 400) }
                    override fun onReadyForSpeech(p: Bundle?) {}; override fun onBeginningOfSpeech() {}; override fun onRmsChanged(v: Float) {}
                    override fun onBufferReceived(b: ByteArray?) {}; override fun onEndOfSpeech() {}; override fun onEvent(t: Int, p: Bundle?) {}
                })
                r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true).putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true).putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3))
            }
            listen()
        }
    }

    override fun stop() { on = false; App.ui.post { rec?.destroy(); rec = null } }
}

/** wake.set / wake.status / event wake.detected {kind, phrase, confidence}: the audio is analysed on the phone only and never stored or sent. */
object Wake {
    private var claps = false
    private var phrases: List<String> = emptyList()
    private var confidence = 0.82
    private var sens = 1.0
    private var paused = false
    private var actions: Map<String, String> = emptyMap()
    private var error: String? = null
    private var thread: Thread? = null
    @Volatile private var run = false
    private var lastFire = 0L
    val spotter: PhraseSpotter = SpeechPhraseSpotter()

    init { load() }

    private fun load() {
        runCatching {
            val j = JSONObject(App.prefs.getString("wake", "{}") ?: "{}")
            claps = j.optBoolean("claps"); phrases = j.optJSONArray("phrases")?.strings().orEmpty(); confidence = j.optDouble("confidence", 0.82); sens = j.optDouble("clapSensitivity", 1.0); paused = j.optBoolean("paused")
            j.optJSONObject("actions")?.let { a -> actions = a.keys().asSequence().associateWith { k -> a.optString(k, "listen") } }
        }
    }

    fun wanted() = (claps || phrases.isNotEmpty()) && !paused
    private fun micGranted() = Perms.has(android.Manifest.permission.RECORD_AUDIO)

    fun status(): JSONObject = obj("listening" to (run || spotting), "paused" to paused, "speech" to spotting, "claps" to run, "recogniser" to (if (phrases.isNotEmpty()) spotter.name else null), "error" to error,
        "available" to true, "micService" to LokeyService.micOk)

    @Volatile private var spotting = false

    /** phrase -> action (listen | greet | welcome) as the page sent them in `list`; the page maps the action again when the app opens */
    @Volatile var lastEventAt = 0L
    @Volatile var lastDecision = "nothing detected yet"

    fun set(p: JSONObject): JSONObject {
        claps = p.bool("claps"); phrases = p.optJSONArray("phrases")?.strings().orEmpty().filter { it.isNotBlank() }; confidence = p.num("confidence", 0.82); sens = p.num("clapSensitivity", 1.0); paused = p.bool("paused")
        p.optJSONArray("list")?.let { l -> actions = (0 until l.length()).mapNotNull { l.optJSONObject(it) }.associate { it.str("text").lowercase() to it.str("action", "listen") } }
        persist()
        error = null
        if (wanted() && !micGranted()) error = "microphone permission needed (perm.request mic)"
        LokeyService.sync(App.ctx)
        return status()
    }

    private fun persist() {
        App.prefs.edit().putString("wake", obj("claps" to claps, "phrases" to arr(phrases), "confidence" to confidence, "clapSensitivity" to sens, "paused" to paused, "actions" to JSONObject(actions)).toString()).apply()
    }

    /** the notification button "Pause listening" / "Resume listening" */
    fun togglePaused() { paused = !paused; persist(); LokeyService.sync(App.ctx) }
    fun isPaused() = paused

    /** wake is wanted but the microphone service is not running: the notification offers "Start listening" (opens Lokey, which may start it) */
    fun needsStart() = wanted() && micGranted() && !LokeyService.micOk

    /** called by the service: start or stop the capture to match the settings (and pause it while a voice session owns the microphone) */
    @Synchronized fun apply(c: Context, micOk: Boolean) {
        stopCapture()
        if (!wanted()) return
        if (LokeyService.voiceOn()) { error = null; return }
        if (!micGranted()) { error = "microphone permission needed (perm.request mic)"; return }
        if (!micOk) { error = "the microphone service could not start in the background; open Lokey once (or tap Start listening in the notification)"; return }
        error = null
        if (claps) startClaps()
        if (phrases.isNotEmpty()) {
            if (spotter.available(c)) { spotting = true; spotter.start(c, phrases, confidence) { ph, cf -> fire("phrase", ph, cf) } } else error = "no speech recogniser on this phone; claps only"
        }
    }

    @Synchronized fun stopCapture() {
        run = false; thread?.interrupt(); thread = null
        if (spotting) { spotting = false; spotter.stop() }
    }

    /** a clap or phrase was heard. App in front: tell the page. App not in front: show "Listening" at once and open the app (the page reads the launch action). */
    internal fun fire(kind: String, phrase: String?, conf: Double) {
        val now = System.currentTimeMillis()
        val d = WakePolicy.decide(wanted(), LokeyService.voiceOn(), App.foreground, now, lastFire)
        lastDecision = "$kind ${phrase ?: ""}: $d"
        if (d.startsWith("ignore")) return
        lastFire = now; lastEventAt = now
        val action = phrase?.let { actions[it.lowercase()] } ?: "listen"
        if (d.startsWith("emit")) { Events.emit("wake.detected", obj("kind" to kind, "phrase" to phrase, "confidence" to conf), durable = true); return }
        Events.emit("wake.detected", obj("kind" to kind, "phrase" to phrase, "confidence" to conf), durable = true)   // kept until the page is alive
        Island.wakeListening(20_000)
        Launch.pending = obj("action" to "wake", "kind" to kind, "phrase" to phrase, "wakeAction" to action)
        // with the overlay permission Android lets a background service open the app; otherwise a full-screen notification is the fallback
        val started = runCatching { Launch.start(Launch.ACT_WAKE, mapOf("kind" to kind, "phrase" to (phrase ?: ""), "wakeAction" to action)) }.isSuccess && Perms.granted("overlay")
        if (!started) Notif.wakeFallback(App.ctx, kind, phrase ?: "", action)
    }

    private fun startClaps() {
        run = true
        thread = Thread({
            val rate = 16000; val frame = rate / 50   // 20 ms
            val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val rec = try { AudioRecord(MediaRecorder.AudioSource.MIC, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, frame * 8)) } catch (e: Exception) { error = "microphone unavailable: ${e.message}"; run = false; return@Thread }
            if (rec.state != AudioRecord.STATE_INITIALIZED) { error = "microphone is busy or blocked"; run = false; rec.release(); return@Thread }
            val det = ClapDetector().also { it.sensitivity = sens }
            val buf = ShortArray(frame); val t0 = System.nanoTime()
            try {
                rec.startRecording()
                while (run) {
                    var n = 0
                    while (n < frame && run) { val r = rec.read(buf, n, frame - n); if (r <= 0) break; n += r }
                    if (n < frame) { if (!run) break; Thread.sleep(20); continue }
                    var sum = 0.0; var peak = 0.0
                    for (s in buf) { val v = s / 32768.0; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v) }
                    if (det.feed(Math.sqrt(sum / frame), peak, (System.nanoTime() - t0) / 1_000_000)) fire("clap", null, 0.9)
                }
            } catch (_: InterruptedException) {
            } catch (e: Exception) { error = "microphone error: ${e.message}" } finally { runCatching { rec.stop() }; rec.release(); run = false }
        }, "lokey-clap").also { it.priority = Thread.NORM_PRIORITY + 1; it.start() }
    }

    fun methods(): Map<String, H> = mapOf("wake.set" h { set(it) }, "wake.status" h { status() })
}
