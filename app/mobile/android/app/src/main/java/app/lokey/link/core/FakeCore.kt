package app.lokey.link.core

import org.json.JSONArray
import org.json.JSONObject

/** Believable sample data for @Preview and the design showcase. Commands act on the local state only; nothing talks to a phone or a PC. */
class FakeCore(private val scenario: Scenario = Scenario.Busy) : StateCore() {
    enum class Scenario { Empty, Busy }

    init {
        _status.value = CoreStatus.Ready("fake")
        setSettings(Parse.settings(FakeData.settings()))
        if (scenario == Scenario.Busy) {
            val t = System.currentTimeMillis()
            onVoice(JSONObject("""{"type":"said","text":"What is on my calendar today?","final":true}"""))
            onVoice(JSONObject("""{"type":"reply","text":"Two things: stand-up at 10:30 and dinner with Amma at 8.","final":true}"""))
            onVoice(JSONObject("""{"type":"notice","text":"Reminder set for 6 pm","tone":"info"}"""))
            setJobs(listOf(Job("j1", "agent", "Summarise the unread mail", JobStatus.Running, "Reading 12 of 31", null, t - 40_000)))
            setApprovals { listOf(Approval("a1", "Send \"on my way\" to Amma", "WhatsApp, +91 98xxx xxxxx", "send_message", 30_000)) }
            setToday(listOf(
                TodayItem("task:1", "Call the dentist", TodayKind.Task, t + 3_600_000, "Booking"),
                TodayItem("loop:1", "Reply to Ravi about the invoice", TodayKind.Loop, t + 7_200_000, "with Ravi"),
            ))
            setPc(PcStatus(paired = true, connected = true, name = "Studio PC", agent = "idle", jobs = listOf("Building lokey-app"), playing = "Weightless - Marconi Union"))
            setMedia(Media(true, "Spotify", "Weightless", "Marconi Union", true, 62_000, 480_000, t, true, true))
            addDue(TodayItem("rem:1", "Call mum", TodayKind.Reminder, t, "Reminder"))
            timerStart(25)
        } else {
            setPc(PcStatus())
        }
    }

    override fun say(text: String) {
        typed(text)
        onVoice(JSONObject().put("type", "reply").put("text", "You said: ${text.trim()}").put("final", true))
    }
    override fun hold(on: Boolean) = voiceState(if (on) VoiceState.Listening else VoiceState.Idle)
    override fun toggleConversation() = setConvo(!assistant.value.convo)
    override fun stopAll() = setJobs(emptyList())
    override fun stopJob(id: String) = setJobs(jobs.value.filter { it.id != id })
    override fun answerApproval(a: Approval, allow: Boolean) = clearApproval(a.id)
    override fun dismissDictation() = onDictation(JSONObject().put("type", "cancel"))
    override fun retry() = Unit
    override fun mediaControl(action: String) { media.value?.let { if (action == "toggle") setMedia(it.copy(playing = !it.playing)) } }
    override fun mediaSeek(positionMs: Long) { media.value?.let { setMedia(it.copy(positionMs = positionMs, sampledAt = System.currentTimeMillis())) } }
    override suspend fun call(path: String, vararg args: Any?): Any? = when (path) {
        "bridge.call" -> FakeData.native(args.firstOrNull() as? String ?: "", scenario == Scenario.Empty)
        "bridge.voice.info" -> JSONObject().put("hasKey", true).put("state", "idle").put("tasks", JSONArray())
        "bridge.voice.loops" -> if (scenario == Scenario.Empty) JSONArray() else JSONArray("""[{"id":"l1","what":"Reply to Ravi about the invoice","who":"Ravi","due":"2030-01-01T10:00:00Z"}]""")
        "bridge.memory.list" -> if (scenario == Scenario.Empty) JSONArray() else FakeData.facts()
        "bridge.brain.hasSecret" -> true
        "bridge.settings.get" -> FakeData.settings()
        else -> null
    }
    override fun subscribe(path: String, vararg args: Any?, onEvent: (Any?) -> Unit) = AutoCloseable { }
}

/** the answers FakeCore gives to native plugin calls (shapes from PLUGIN.md) */
object FakeData {
    fun settings(): JSONObject = JSONObject("""{
      "appearance":{"theme":"auto","accent":"wallpaper","scale":1,"animSpeed":1,"reduceMotion":false},
      "loadout":{"soul":"puff","personality":"chad","voice":"Charon","personalities":[{"id":"chad","name":"True Chad","prompt":""},{"id":"calm","name":"Calm","prompt":""}]},
      "voice":{"enabled":true,"language":"auto","dictationScript":"mixed","speakReplies":true,"holdToAnswer":true,"halfDuplex":true,"dictation":true},
      "agent":{"confirmMode":"risky","context":true},
      "wake":{"enabled":true,"claps":true,"phrases":true,"confidence":0.82,"clapSensitivity":1,"list":[{"text":"hey lokey","action":"listen"},{"text":"wake up buddy","action":"greet"},{"text":"daddy's home","action":"welcome"}]},
      "brain":{"learn":true,"embed":true,"excludeApps":["keepass"],"providers":[
        {"id":"gemini-flash","name":"Gemini Flash","kind":"gemini","model":"gemini-flash-latest","enabled":true,"keyRef":"gemini","roles":["main"],"dailyLimit":0},
        {"id":"openrouter","name":"OpenRouter (free models)","kind":"openai","model":"","enabled":false,"keyRef":"openrouter","roles":["main"],"dailyLimit":0}]},
      "island":{"enabled":true},
      "phone":{"activities":["approval","voice","timer","job","music","reminder","charging","pc"],"haptics":true,"spirit":"full","systemIsland":true,"liveUpdates":true,"vivoIsland":true}
    }""")

    fun facts() = JSONArray("""[
      {"id":"f1","text":"Prefers short answers","kind":"preference","pinned":true,"updated":0},
      {"id":"f2","text":"Amma is at +91 98xxx xxxxx; dinner is at 8","kind":"person","pinned":false,"updated":0},
      {"id":"f3","text":"Working on lokey-app","kind":"project","pinned":false,"updated":0}]""")

    fun native(method: String, empty: Boolean = false): Any? = if (empty && method in setOf("notifications.list", "calendar.list", "reminder.list")) JSONArray() else if (empty && method == "perm.status") JSONObject("""{"permissions":{}}""") else when (method) {
        "notifications.list" -> JSONArray("""[
          {"key":"k1","package":"com.whatsapp","app":"WhatsApp","title":"Amma","text":"Are you coming for dinner tonight?","time":${System.currentTimeMillis() - 120_000},"canReply":true},
          {"key":"k2","package":"com.whatsapp","app":"WhatsApp","title":"Ravi","text":"Sent the invoice, please check","time":${System.currentTimeMillis() - 900_000},"canReply":true},
          {"key":"k3","package":"com.google.android.gm","app":"Gmail","title":"Your receipt","text":"Thanks for your order","time":${System.currentTimeMillis() - 3_600_000},"canReply":false}]""")
        "calendar.list" -> JSONArray("""[
          {"id":1,"title":"Stand-up","startMs":${System.currentTimeMillis() + 3_600_000},"endMs":${System.currentTimeMillis() + 5_400_000},"location":"Meet"},
          {"id":2,"title":"Dinner with Amma","startMs":${System.currentTimeMillis() + 36_000_000},"allDay":false}]""")
        "reminder.list" -> JSONArray("""[{"id":"r1","at":${System.currentTimeMillis() + 7_200_000},"title":"Pick up the parcel"}]""")
        "perm.status" -> JSONObject("""{"permissions":{"mic":true,"notifications":true,"overlay":false,"live_updates":false,"accessibility":false,"notification-listener":true,"battery-optimisation-exempt":false}}""")
        "island.status" -> JSONObject("""{"overlayGranted":false,"promotedGranted":false,"cutout":{"left":480,"top":0,"right":600,"bottom":60},"sdk":35}""")
        "diag.status" -> JSONObject("""{"serviceRunning":true,"serviceMic":true,"overlayShown":false,"overlayGranted":false,"appForeground":true,"jsHeartbeatAgeMs":4000,"wakeEnabled":true,"wakeListening":true,"linkPaired":true,"linkConnected":true,"batteryExempt":false,"sdk":35,"manufacturer":"vivo"}""")
        "shizuku.status" -> JSONObject("""{"ok":true,"installed":true,"running":false,"permissionGranted":false,"canCreateDisplay":null}""")
        "contacts.search" -> JSONArray("""[{"name":"Amma","numbers":[{"number":"+91 98765 43210","type":"mobile"}]}]""")
        "audio.get" -> JSONObject("""{"volume":0.5}""")
        else -> JSONObject("""{"ok":true}""")
    }
}
