package app.lokey.link

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.service.quicksettings.TileService
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

// Small view helpers (no layouts or libraries: the whole UI is a few lines of code)
private fun Activity.dp(n: Int) = (n * resources.displayMetrics.density).toInt()
private fun Activity.text(s: String, size: Float = 15f, color: Int = Color.parseColor("#ECEDEF"), bold: Boolean = false) =
    TextView(this).apply { text = s; textSize = size; setTextColor(color); if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD); setPadding(0, dp(4), 0, dp(4)) }
private fun Activity.button(s: String, filled: Boolean = false, click: () -> Unit) =
    Button(this).apply {
        text = s; isAllCaps = false; setTextColor(if (filled) Color.BLACK else Color.parseColor("#ECEDEF"))
        background = GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(Color.parseColor(if (filled) "#9D8BFF" else "#2A2D36")) }
        setOnClickListener { click() }
    }
private fun Activity.field(hint: String) = EditText(this).apply {
    this.hint = hint; setHintTextColor(Color.parseColor("#6B6E78")); setTextColor(Color.parseColor("#ECEDEF")); setSingleLine(); imeOptions = EditorInfo.IME_ACTION_SEND
}
private fun Activity.toast(s: String) = runOnUiThread { Toast.makeText(this, s, Toast.LENGTH_SHORT).show() }
private fun Activity.column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(20), dp(20), dp(20)) }

class SettingsActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
    }

    override fun onResume() { super.onResume(); build(); LinkService.start(this) }

    private fun build() {
        val root = column()
        root.addView(text("Settings", 28f, Color.parseColor("#9D8BFF"), true))
        root.addView(text("This phone's own assistant", 18f, bold = true))
        root.addView(text("Lokey works on its own with your free Google AI Studio key (aistudio.google.com/apikey). The key stays on this phone.", 13f, Color.parseColor("#9A9DA8")))
        val key = field("Gemini API key").apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; setText(Store.apiKey(this@SettingsActivity)) }
        val model = field("Model").apply { setText(Store.model(this@SettingsActivity)) }
        var lang = Store.lang(this)
        val langBtn = button(if (lang == "ta-IN") "Speaking: Tamil" else "Speaking: English") {}
        langBtn.setOnClickListener { lang = if (lang == "ta-IN") "en-IN" else "ta-IN"; langBtn.text = if (lang == "ta-IN") "Speaking: Tamil" else "Speaking: English" }
        root.addView(key); root.addView(model); root.addView(langBtn)
        root.addView(button("Save", true) { Store.setAi(this, key.text.toString(), model.text.toString(), lang); toast("Saved") })
        root.addView(text("PC link (optional)", 18f, bold = true))
        if (!Store.paired(this)) {
            root.addView(text("Pair to sync memory and let the phone hand work to your PC.", 13f, Color.parseColor("#9A9DA8")))
            root.addView(text("On the PC: Lokey > Settings > Devices > turn on, then show a code. Phone and PC must be on the same Wi-Fi.", 14f, Color.parseColor("#9A9DA8")))
            val addr = field("PC address, e.g. 192.168.1.20:47831").apply { inputType = InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_CLASS_TEXT }
            val code = field("6-digit code").apply { inputType = InputType.TYPE_CLASS_NUMBER }
            root.addView(addr); root.addView(code)
            root.addView(button("Pair", true) {
                val base = Api.normalise(addr.text.toString()); val c = code.text.toString().trim()
                Thread {
                    Api.pair(base, c, Build.MODEL).fold(
                        { t -> Store.save(this, base, t); runOnUiThread { build(); LinkService.start(this) }; toast("Paired") },
                        { toast(it.message ?: "Could not pair") })
                }.start()
            })
        } else {
            val st = Store.status(this)
            root.addView(text(if (Store.connected(this)) "Connected to ${Store.base(this).removePrefix("http://")}" else "Connecting…", 14f, Color.parseColor("#9A9DA8")))
            st?.let { root.addView(text("PC: ${it.optString("agent", "idle")}", 14f, Color.parseColor("#9A9DA8"))) }
            Store.pending(this)?.let { p ->
                root.addView(text(p.optString("title"), 18f, bold = true)); root.addView(text(p.optString("detail"), 14f))
                val row = LinearLayout(this); row.addView(button("Deny") { answer(p.optString("id"), false) }); row.addView(button("Allow", true) { answer(p.optString("id"), true) })
                root.addView(row)
            }
            root.addView(button("Sync memory now") { Thread { val (pl, ps) = Mem.sync(this); toast("Synced: $pl from the PC, $ps to the PC") }.start() })
            root.addView(button("Send my clipboard to the PC") {
                val t = getSystemService(android.content.ClipboardManager::class.java).primaryClip?.getItemAt(0)?.text?.toString().orEmpty()
                if (t.isEmpty()) toast("Clipboard is empty") else Thread { toast(Api.clip(this, t).fold({ "Sent" }, { it.message ?: "Failed" })) }.start()
            })
            root.addView(text("Keep it alive (vivo OriginOS)", 18f, bold = true))
            root.addView(text("Allow background activity and autostart for Lokey, and lock it in the recents list, or the system may stop the connection.", 13f, Color.parseColor("#9A9DA8")))
            root.addView(button("Open app settings") { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) })
            root.addView(button("Unpair this phone") { stopService(Intent(this, LinkService::class.java)); Store.clear(this); LokeyWidget.refresh(this); build() })
        }
        setContentView(ScrollView(this).apply { addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT) })
    }

    private fun answer(id: String, allow: Boolean) = Thread {
        val ok = Api.approve(this, id, allow); if (ok) { Store.setPending(this, null); Notif.clearAsk(this); LokeyWidget.refresh(this) }
        toast(if (ok) (if (allow) "Allowed on your PC" else "Denied") else "Could not reach the PC"); runOnUiThread { build() }
    }.start()
}

/** The popup: appears over whatever you are doing when the PC needs an OK */
class ApprovalActivity : Activity() {
    override fun onNewIntent(i: Intent?) { super.onNewIntent(i); build() }
    override fun onCreate(b: Bundle?) { super.onCreate(b); build() }
    private fun build() {
        val p = Store.pending(this)
        if (p == null) { toast("Nothing waiting"); finish(); return }
        val root = column()
        root.addView(text(p.optString("title", "Lokey is asking"), 20f, bold = true))
        root.addView(text(p.optString("detail"), 14f, Color.parseColor("#C5C7CF")))
        root.addView(text(p.optString("tool"), 12f, Color.parseColor("#6B6E78")))
        val row = LinearLayout(this).apply { gravity = Gravity.END }
        fun go(allow: Boolean) = Thread {
            val ok = Api.approve(this, p.optString("id"), allow)
            if (ok) { Store.setPending(this, null); Notif.clearAsk(this); LokeyWidget.refresh(this) }
            toast(if (ok) (if (allow) "Allowed on your PC" else "Denied") else "Could not reach the PC"); runOnUiThread { finish() }
        }.start()
        row.addView(button("Deny") { go(false) }); row.addView(button("Allow", true) { go(true) })
        root.addView(row)
        setContentView(root)
    }
}

/** The quick-ask popup, opened from the widget or the Quick Settings tile */
class SayActivity : Activity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        if (Store.apiKey(this).isEmpty() && !Store.paired(this)) { startActivity(Intent(this, SettingsActivity::class.java)); finish(); return }
        val root = column()
        root.addView(text("Ask Lokey", 20f, bold = true))
        val f = field("What should Lokey do on your PC?")
        val out = text("", 14f, Color.parseColor("#C5C7CF"))
        fun send() {
            val t = f.text.toString().trim(); if (t.isEmpty()) return
            out.text = "..."; f.setText("")
            Thread { val r = Brain.ask(this, t); runOnUiThread { out.text = r.getOrElse { "! " + (it.message ?: "failed") } } }.start()
        }
        f.setOnEditorActionListener { _, _, _ -> send(); true }
        root.addView(f); root.addView(button("Send", true) { send() }); root.addView(out)
        setContentView(root)
    }
}

/** Quick Settings tile */
class AskTile : TileService() {
    override fun onStartListening() { qsTile?.apply { label = "Ask Lokey"; state = android.service.quicksettings.Tile.STATE_INACTIVE; updateTile() } }
    @Suppress("DEPRECATION")
    override fun onClick() {
        val i = Intent(this, SayActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 20, i, PendingIntent.FLAG_IMMUTABLE)) else startActivityAndCollapse(i)
    }
}


/** Speech in (the phone's recogniser, English or Tamil) and out (the phone's voice) */
class Voice(private val a: Activity, private val onText: (String) -> Unit, private val onState: (Boolean) -> Unit) {
    private var rec: android.speech.SpeechRecognizer? = null
    private var tts: android.speech.tts.TextToSpeech? = android.speech.tts.TextToSpeech(a) { }
    var listening = false; private set

    fun listen() {
        if (a.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { a.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2); return }
        if (!android.speech.SpeechRecognizer.isRecognitionAvailable(a)) { Toast.makeText(a, "No speech recogniser on this phone", Toast.LENGTH_SHORT).show(); return }
        stopSpeaking()
        rec?.destroy()
        rec = android.speech.SpeechRecognizer.createSpeechRecognizer(a).apply {
            setRecognitionListener(object : android.speech.RecognitionListener {
                override fun onResults(r: Bundle?) { set(false); r?.getStringArrayList(android.speech.SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let(onText) }
                override fun onError(e: Int) { set(false); if (e != android.speech.SpeechRecognizer.ERROR_NO_MATCH && e != android.speech.SpeechRecognizer.ERROR_SPEECH_TIMEOUT) Toast.makeText(a, "Could not hear you (error $e)", Toast.LENGTH_SHORT).show() }
                override fun onReadyForSpeech(p: Bundle?) {}
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(v: Float) {}
                override fun onBufferReceived(b: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(b: Bundle?) {}
                override fun onEvent(t: Int, b: Bundle?) {}
            })
            startListening(Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, Store.lang(a)))
        }
        set(true)
    }
    private fun set(on: Boolean) { listening = on; a.runOnUiThread { onState(on) } }
    fun stopSpeaking() { tts?.stop() }
    /** speaks in Tamil when the text is Tamil script, otherwise Indian English */
    fun speak(t: String) {
        val ta = t.any { it in '\u0B80'..'\u0BFF' }
        tts?.language = if (ta) java.util.Locale("ta", "IN") else java.util.Locale("en", "IN")
        tts?.speak(t.take(600), android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, "lokey")
    }
    fun close() { rec?.destroy(); tts?.shutdown() }
}

/** The assistant itself: type or talk, it answers and acts on the phone. Works without a PC. */
class MainActivity : Activity() {
    private lateinit var log: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var input: EditText
    private lateinit var mic: Button
    private lateinit var voice: Voice
    private lateinit var head: TextView
    private var speakNext = false

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(12), dp(16), dp(12)) }
        val bar = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        head = text("Lokey", 22f, Color.parseColor("#9D8BFF"), true).apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) }
        bar.addView(head); bar.addView(button("Settings") { startActivity(Intent(this, SettingsActivity::class.java)) })
        root.addView(bar)
        log = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll = ScrollView(this).apply { addView(log); layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f) }
        root.addView(scroll)
        val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        input = field("Ask or tell Lokey...").apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f); setOnEditorActionListener { _, _, _ -> sendTyped(); true } }
        mic = button("Mic") { if (voice.listening) voice.stopSpeaking() else voice.listen() }
        voice = Voice(this, { t -> speakNext = true; ask(t) }, { on -> mic.text = if (on) "Listening..." else "Mic" })
        row.addView(input); row.addView(mic); row.addView(button("Send", true) { sendTyped() })
        root.addView(row)
        setContentView(root)
        add("Lokey", if (Store.apiKey(this).isEmpty() && !Store.paired(this)) "Open Settings and add your Gemini key to start. You can also pair with your PC." else "Hi. Ask me anything, or tap Mic.")
        // Share > Lokey: text goes to the PC clipboard (paired) or becomes a question (alone)
        if (intent?.action == Intent.ACTION_SEND) intent.getStringExtra(Intent.EXTRA_TEXT)?.let { t ->
            if (Store.paired(this)) Thread { toast(Api.clip(this, t).fold({ "Sent to your PC clipboard" }, { it.message ?: "Failed" })) }.start() else input.setText(t)
        }
    }

    override fun onResume() {
        super.onResume(); LinkService.start(this)
        head.text = if (Store.paired(this)) (if (Store.connected(this)) "Lokey - PC connected" else "Lokey - PC paired") else "Lokey"
        Thread { Mem.sync(this) }.start()
    }
    override fun onDestroy() { voice.close(); super.onDestroy() }
    override fun onRequestPermissionsResult(code: Int, p: Array<out String>, r: IntArray) { if (code == 2 && r.firstOrNull() == PackageManager.PERMISSION_GRANTED) voice.listen() }

    private fun add(who: String, t: String) {
        val v = text("$who\n$t", 15f, if (who == "You") Color.parseColor("#C5C7CF") else Color.parseColor("#ECEDEF")).apply { setPadding(0, dp(8), 0, dp(8)); setTextIsSelectable(true) }
        log.addView(v); scroll.post { scroll.fullScroll(android.view.View.FOCUS_DOWN) }
    }
    private fun sendTyped() { val t = input.text.toString().trim(); if (t.isNotEmpty()) { input.setText(""); speakNext = false; ask(t) } }
    private fun ask(t: String) {
        add("You", t)
        val wait = text("...", 13f, Color.parseColor("#6B6E78")); log.addView(wait)
        Thread {
            val r = Brain.ask(this, t) { step -> runOnUiThread { wait.text = "using $step..." } }
            runOnUiThread {
                log.removeView(wait)
                r.fold({ add("Lokey", it); if (speakNext) voice.speak(it) }, { add("Lokey", "! " + (it.message ?: "failed")) })
            }
        }.start()
    }
}
