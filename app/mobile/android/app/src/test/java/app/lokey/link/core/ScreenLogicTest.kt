package app.lokey.link.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class ScreenLogicTest {
    private fun j(s: String) = JSONObject(s)

    // ---- timer ----
    @Test fun timerStartPauseResumeAndDone() {
        var t = FocusTimer.start(TimerState(), 5, 1_000)
        assertEquals(TimerStatus.Running, t.status); assertEquals(300_000, FocusTimer.remaining(t, 1_000)); assertEquals(301_000, t.endsAt)
        t = FocusTimer.pause(t, 61_000)
        assertEquals(TimerStatus.Paused, t.status); assertEquals(240_000, t.remainingMs); assertEquals(240_000, FocusTimer.remaining(t, 999_999))
        t = FocusTimer.start(t, 99, 100_000) // resume ignores the minutes
        assertEquals(TimerStatus.Running, t.status); assertEquals(340_000, t.endsAt); assertEquals(300_000, t.totalMs)
        assertEquals(TimerStatus.Running, FocusTimer.tick(t, 339_999).status)
        val done = FocusTimer.tick(t, 340_000)
        assertEquals(TimerStatus.Done, done.status); assertEquals(0, done.remainingMs); assertEquals(1f, FocusTimer.ring(done, 0), 0f)
        assertEquals(TimerState(), FocusTimer.reset(done))
    }

    @Test fun plusMinuteInEveryState() {
        val run = FocusTimer.start(TimerState(), 1, 0)
        assertEquals(120_000, FocusTimer.remaining(FocusTimer.plusMinute(run, 0), 0)); assertEquals(120_000, FocusTimer.plusMinute(run, 0).totalMs)
        val paused = FocusTimer.pause(run, 10_000)
        assertEquals(110_000, FocusTimer.plusMinute(paused, 20_000).remainingMs)
        val restarted = FocusTimer.plusMinute(FocusTimer.tick(run, 70_000), 70_000) // done -> one more minute
        assertEquals(TimerStatus.Running, restarted.status); assertEquals(60_000, FocusTimer.remaining(restarted, 70_000))
        assertEquals(TimerState(), FocusTimer.plusMinute(TimerState(), 0))
    }

    @Test fun timerRingAndClock() {
        val t = FocusTimer.start(TimerState(), 10, 0)
        assertEquals(0.5f, FocusTimer.ring(t, 300_000), 0.001f)
        assertEquals("5:00".padStart(5, '0'), FocusTimer.clock(300_000)); assertEquals("00:01", FocusTimer.clock(1)); assertEquals("1:05:00", FocusTimer.clock(3_900_000)); assertEquals("00:00", FocusTimer.clock(-5))
    }

    // ---- charging flash ----
    @Test fun chargingFlashOnPlugInAndLowCrossings() {
        val un = Battery(true, 50.0, false)
        assertEquals(Flash("50%", false, 12_800), ChargeFlash.next(un, Battery(true, 50.0, true), 10_000))
        assertNull(ChargeFlash.next(Battery(true, 50.0, true), Battery(true, 51.0, true), 0)) // already charging
        assertEquals(Flash("20% left", true, 3_600), ChargeFlash.next(Battery(true, 21.0, false), Battery(true, 20.0, false), 0))
        assertEquals("10% left", ChargeFlash.next(Battery(true, 11.0, false), Battery(true, 9.6, false), 0)?.text)
        assertNull(ChargeFlash.next(Battery(true, 19.0, false), Battery(true, 18.0, false), 0)) // no level crossed
        assertNull(ChargeFlash.next(null, Battery(true, 5.0, false), 0)); assertNull(ChargeFlash.next(un, Battery(false, 5.0, false), 0))
    }

    // ---- island faces ----
    private fun faces(kinds: List<ActivityKind>, timer: TimerState = TimerState(), media: Media? = null, approvals: List<Approval> = emptyList()) =
        IslandFaces.build(kinds, approvals, Assistant(VoiceState.Thinking), "hello", timer, listOf(Job("j", "agent", "Summarise", JobStatus.Running, "3 of 9")), media,
            listOf(TodayItem("rem:1", "Call mum", TodayKind.Reminder, 0)), PcStatus(true, true, "Studio"), Flash("85%", false, 0), 100_000)

    @Test fun facesCarryTheNativeContract() {
        val t = FocusTimer.start(TimerState(), 10, 100_000)
        val m = Media(true, "Spotify", "Song", "Band", true, 60_000, 240_000, 100_000, true, true)
        val u = faces(listOf(ActivityKind.Approval, ActivityKind.Timer, ActivityKind.Music, ActivityKind.Job, ActivityKind.Reminder, ActivityKind.Pc, ActivityKind.Charging), t, m, listOf(Approval("a", "Send it", "WhatsApp")))
        assertEquals("approval", u.primary); assertEquals(7, u.faces.size)
        val byId = u.faces.associateBy { it.getString("id") }
        assertEquals("Send it", byId.getValue("approval").getString("title")); assertEquals(100, byId.getValue("approval").getInt("priority"))
        val timer = byId.getValue("timer")
        assertEquals(700_000L, timer.getLong("endAt")); assertEquals(0.0, timer.getDouble("progress"), 0.001)
        assertEquals("Pause", timer.getJSONArray("actions").getJSONObject(0).getString("label"))
        val music = byId.getValue("music")
        assertEquals(0.25, music.getDouble("progress"), 0.001); assertEquals(100_000L + 180_000L, music.getLong("endAt")); assertEquals("music", music.getString("icon"))
        assertEquals(3, music.getJSONArray("actions").length())
        assertEquals("Thinking...", faces(listOf(ActivityKind.Voice)).faces[0].getString("title"))
        assertNull(faces(listOf(ActivityKind.Idle)).primary); assertTrue(faces(listOf(ActivityKind.Idle)).faces.isEmpty())
    }

    @Test fun faceKeyIgnoresTheSecondsThatTickByButNotRealChanges() {
        val a = FocusTimer.start(TimerState(), 10, 0)
        val k1 = faces(listOf(ActivityKind.Timer), a).key()
        val k2 = IslandFaces.build(listOf(ActivityKind.Timer), emptyList(), Assistant(), "", a, emptyList(), null, emptyList(), PcStatus(), null, 100).key()
        assertEquals(k1.substringBefore("~"), k2.substringBefore("~"))
        val paused = FocusTimer.pause(a, 50_000)
        assertFalse(k1 == faces(listOf(ActivityKind.Timer), paused).key())
    }

    // ---- face actions ----
    @Test fun faceActionsRunTheSameHandlersAsTheCards() {
        val core = FakeCore()
        assertEquals(1, core.approvals.value.size)
        FaceActions.run(core, "approval", "allow"); assertTrue(core.approvals.value.isEmpty())
        assertEquals(TimerStatus.Running, core.timer.value.status)
        FaceActions.run(core, "timer", "toggle"); assertEquals(TimerStatus.Paused, core.timer.value.status)
        FaceActions.run(core, "timer", "toggle"); assertEquals(TimerStatus.Running, core.timer.value.status)
        FaceActions.run(core, "timer", "stop"); assertEquals(TimerStatus.Idle, core.timer.value.status)
        assertTrue(core.media.value!!.playing); FaceActions.run(core, "music", "toggle"); assertFalse(core.media.value!!.playing)
        FaceActions.run(core, "job", "stop"); assertTrue(core.jobs.value.isEmpty())
        assertEquals(1, core.due.value.size); FaceActions.run(core, "reminder", "done"); assertTrue(core.due.value.isEmpty())
    }

    @Test fun anAskedQuestionNeverReachesTheTranscriptAndAnsweringEndsIt() {
        val core = object : StateCore() {
            init { _status.value = CoreStatus.Ready("t") }
            fun feed(json: String) = onVoice(JSONObject(json))
            override fun say(text: String) {}
            override fun hold(on: Boolean) {}
            override fun toggleConversation() {}
            override fun stopAll() {}
            override fun stopJob(id: String) {}
            override fun answerApproval(a: Approval, allow: Boolean) {}
            override fun dismissDictation() {}
            override fun retry() {}
            override fun mediaControl(action: String) {}
            override fun mediaSeek(positionMs: Long) {}
            override suspend fun call(path: String, vararg args: Any?): Any? = null
            override fun subscribe(path: String, vararg args: Any?, onEvent: (Any?) -> Unit) = AutoCloseable { }
            override suspend fun askSend(prompt: String) { feed("""{"type":"said","text":"ignored","final":true}"""); feed("""{"type":"reply","text":"Draft: on my way","final":false}"""); feed("""{"type":"reply","text":"Draft: on my way","final":true}""") }
        }
        val answer = kotlinx.coroutines.runBlocking { core.ask("draft a reply") }
        assertEquals("Draft: on my way", answer); assertTrue(core.messages.value.isEmpty())
        core.feed("""{"type":"reply","text":"normal again","final":true}""")
        assertEquals(1, core.messages.value.size)
    }

    // ---- notifications ----
    @Test fun notificationsGroupByAppNewestFirstAndBuildPrompts() {
        val list = Notifs.parse(JSONArray("""[{"key":"1","package":"a","app":"WhatsApp","title":"Amma","text":"dinner?","time":100,"canReply":true},{"key":"2","package":"b","app":"Gmail","title":"Receipt","text":"ok","time":300},{"key":"3","package":"a","app":"WhatsApp","title":"Ravi","text":"invoice","time":200}]"""))
        val g = Notifs.group(list)
        assertEquals(listOf("Gmail", "WhatsApp"), g.map { it.app }); assertEquals(listOf("Ravi", "Amma"), g[1].items.map { it.title })
        assertTrue(Notifs.summaryPrompt("WhatsApp", g[1].items).contains("- Ravi: invoice\n- Amma: dinner?"))
        assertTrue(Notifs.replyPrompt(list[0]).contains("\"Amma\"")); assertTrue(list[0].canReply); assertFalse(list[1].canReply)
        assertEquals("pkg", Notifs.group(listOf(Notif("k", "pkg", "", "t", "x", 1, false))).first().app)
    }

    @Test fun inboxExplainsWhyItIsEmpty() {
        assertNull(Notifs.blocked(JSONArray()))
        assertEquals("notification-listener", Notifs.blocked(j("""{"ok":false,"reason":"permission needed: notification-listener (perm.request notification-listener)"}""")))
        assertEquals("notification-listener", Notifs.blocked(j("""{"ok":false,"reason":"the listener is not enabled"}""")))
        assertEquals("other:boom", Notifs.blocked(j("""{"ok":false,"reason":"boom"}""")))
    }

    // ---- native results and permissions ----
    @Test fun nativeFailuresAreValues() {
        val r = j("""{"ok":false,"reason":"permission needed: contacts (perm.request contacts)"}""")
        assertTrue(NativeResult.failed(r)); assertEquals("contacts", NativeResult.needsPerm(r)); assertFalse(NativeResult.failed(j("""{"ok":true}""")))
        assertNull(NativeResult.needsPerm(j("""{"ok":false,"reason":"nope"}""")))
        assertFalse(NativeResult.failed(JSONArray()))
    }

    @Test fun permissionStatusAnswersInEveryShape() {
        val all = j("""{"permissions":{"mic":true,"overlay":false,"battery-optimisation-exempt":true,"x":{"granted":true}}}""")
        assertTrue(Perm.granted(all, "mic")); assertFalse(Perm.granted(all, "overlay")); assertTrue(Perm.granted(all, "battery")) // battery = battery-optimisation-exempt
        assertTrue(NativeResult.granted(all, "x")!!); assertNull(NativeResult.granted(all, "missing"))
        assertTrue(Perm.granted(j("""{"name":"mic","granted":true}"""), "mic")); assertFalse(Perm.granted(null, "mic"))
        assertTrue(needsRestrictedHint("accessibility", false)); assertFalse(needsRestrictedHint("mic", false)); assertFalse(needsRestrictedHint("accessibility", true))
        assertTrue(Perm.Core.any { it.name == "mic" } && Perm.Core.none { it.name == "microphone" || it.name == "notification_listener" })
    }

    // ---- health ----
    @Test fun backgroundHealthInPlainWords() {
        val now = 1_000_000L
        val rows = Health.rows(j("""{"serviceRunning":true,"serviceMic":true,"overlayGranted":false,"jsHeartbeatAgeMs":4000,"wakeEnabled":true,"wakeListening":true,"wakeLastEventAt":${now - 120_000},"linkPaired":true,"linkConnected":false,"linkLastEventAt":${now - 7_200_000},"batteryExempt":false,"manufacturer":"vivo"}"""), now).associateBy { it.title }
        assertEquals(Level.Ok, rows.getValue("Background service").level); assertEquals("Running, microphone allowed.", rows.getValue("Background service").text)
        assertEquals(Level.Bad, rows.getValue("Island over other apps").level); assertEquals("overlay", rows.getValue("Island over other apps").fixPerm)
        assertEquals(Level.Ok, rows.getValue("The app page").level)
        assertEquals("Listening. Last heard 2 min ago.", rows.getValue("Wake-up").text)
        assertEquals(Level.Warn, rows.getValue("Link to your PC").level); assertEquals("Not connected. Last news 2 h ago.", rows.getValue("Link to your PC").text)
        assertEquals(Level.Warn, rows.getValue("Battery").level); assertNotNull(rows["Autostart (vivo)"])
        assertNull(Health.rows(j("""{"manufacturer":"samsung"}"""), now).firstOrNull { it.title.startsWith("Autostart") })
        assertEquals(Level.Warn, Health.rows(j("""{}"""), now).first { it.title == "The app page" }.level)
    }

    // ---- formatting ----
    @Test fun relativeTimes() {
        assertEquals("now", Fmt.ago(100_000, 70_000)); assertEquals("5 min", Fmt.ago(400_000, 100_000)); assertEquals("3 h", Fmt.ago(10_900_000, 100_000)); assertEquals("2 d", Fmt.ago(173_000_000, 100_000))
        val z = ZoneId.of("UTC")
        val now = ZonedDateTime.of(2026, 10, 16, 22, 0, 0, 0, z).toInstant().toEpochMilli()
        fun at(d: Int, h: Int) = ZonedDateTime.of(2026, 10, d, h, 0, 0, 0, z).toInstant().toEpochMilli()
        assertEquals("Today", Fmt.dayWord(at(16, 23), now, z)); assertEquals("Tomorrow", Fmt.dayWord(at(17, 1), now, z)); assertEquals("Yesterday", Fmt.dayWord(at(15, 23), now, z))
        assertTrue(Fmt.dayWord(at(23, 9), now, z).startsWith("23")) // a week out is a date
        assertFalse(Fmt.dayWord(at(19, 9), now, z).first().isDigit()) // three days out is a weekday name
        assertEquals("84% (charging)", Fmt.battery(j("""{"pct":84.2,"charging":true}"""))); assertEquals("40%", Fmt.battery(40)); assertNull(Fmt.battery(null))
    }

    // ---- settings helpers ----
    @Test fun settingsPatchesAndChoices() {
        assertEquals("""{"voice":{"speakReplies":true}}""", Patch.of(listOf("voice", "speakReplies"), true).toString())
        val v = Lang.Tanglish.patch().getJSONObject("voice")
        assertEquals("ta", v.getString("language")); assertEquals("roman", v.getString("dictationScript"))
        assertEquals(Lang.Tanglish, Lang.of("ta", "roman")); assertEquals(Lang.Tamil, Lang.of("ta", "mixed")); assertEquals(Lang.English, Lang.of("en", "english")); assertEquals(Lang.Auto, Lang.of("auto", "mixed"))
        assertTrue(Accent.valid("#d9b556")); assertFalse(Accent.valid("d9b556")); assertFalse(Accent.valid("#fff")); assertEquals("wallpaper", Accent.value(null))
        assertEquals(1.0, Wake.sliderToSens(Wake.sensToSlider(1.0)), 0.001); assertEquals(0.82, Wake.sliderToConf(Wake.confToSlider(0.82)), 0.01); assertEquals(0f, Wake.sensToSlider(0.1), 0f)
        assertEquals(setOf("voice", "timer", "approval"), IslandKinds.toggle(setOf("voice", "timer", "approval", "pc"), "pc", false).toSet())
        assertTrue("charging" in IslandKinds.toggle(null, "charging", true)); assertFalse("job" in IslandKinds.toggle(null, "job", false))
    }

    @Test fun shizukuStepsFollowTheStatus() {
        val st = j("""{"ok":true,"installed":true,"running":true,"permissionGranted":false,"canCreateDisplay":null}""")
        assertEquals(listOf(true, true, false), Shizuku.steps(st).map { it.done }); assertEquals(listOf(false, false, false), Shizuku.steps(null).map { it.done })
        assertEquals("Ready.", Shizuku.status(st)); assertEquals("Checking...", Shizuku.status(null))
        assertEquals("Shizuku works, but a second screen could not be created.", Shizuku.status(j("""{"canCreateDisplay":false}""")))
        assertEquals("not running", Shizuku.status(j("""{"reason":"not running"}""")))
    }

    @Test fun mediaPositionExtrapolatesWhilePlayingAndSkinAccentFollowsTheSpirit() {
        val m = Media(true, "S", "T", "A", true, 10_000, 100_000, 1_000)
        assertEquals(15_000, m.positionAt(6_000)); assertEquals(100_000, m.positionAt(1_000_000)); assertEquals(10_000, m.copy(playing = false).positionAt(6_000))
        assertEquals(Parse.hex("#FF7FB8"), Parse.settings(j("""{"appearance":{"accent":"wallpaper"},"loadout":{"soul":"puff"}}""")).accent)
        assertEquals(Parse.hex("#d9b556"), Parse.settings(j("""{"appearance":{"accent":"#d9b556"},"loadout":{"soul":"puff"}}""")).accent)
        assertEquals(listOf("hey lokey" to "listen"), Parse.settings(j("""{"wake":{"list":[{"text":"hey lokey","action":"listen"}]}}""")).wakeList)
    }
}
