package app.lokey.link.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreReducersTest {
    private fun j(s: String) = JSONObject(s)
    private fun feed(vararg ev: String) = ev.fold(ChatState()) { s, e -> ChatReducer.voice(s, j(e), 1_000) }

    @Test fun streamedReplyGrowsInPlaceUntilFinal() {
        val s = feed("""{"type":"reply","text":"Two","final":false}""", """{"type":"reply","text":"Two things","final":false}""", """{"type":"reply","text":"Two things.","final":true}""",
            """{"type":"reply","text":"Next","final":false}""")
        assertEquals(listOf("Two things.", "Next"), s.msgs.map { it.text })
        assertEquals(listOf(true, false), s.msgs.map { it.final })
        assertEquals("Next", s.assistant.caption)
    }

    @Test fun typedRequestIsNotShownTwiceWhenTheCoreEchoesIt() {
        var s = ChatReducer.typed(ChatState(), "play music", 1_000)
        s = ChatReducer.voice(s, j("""{"type":"said","text":"play music","final":true}"""), 2_000)
        assertEquals(1, s.msgs.size)
        s = ChatReducer.voice(s, j("""{"type":"said","text":"play music","final":true}"""), 9_000) // a real second request, much later
        assertEquals(2, s.msgs.size)
    }

    @Test fun dictationAndLassoTurnsAreNotChat() {
        val s = feed("""{"type":"state","state":"listening","kind":"dictation"}""", """{"type":"said","text":"hello world","final":false}""")
        assertTrue(s.msgs.isEmpty()); assertEquals(VoiceState.Listening, s.assistant.state)
    }

    @Test fun noticesErrorsAndBlankTextAndTheCap() {
        val s = feed("""{"type":"notice","text":"Offline","tone":"error"}""", """{"type":"notice","text":"  ","tone":"info"}""", """{"type":"convo","on":true}""")
        assertEquals(listOf(MsgKind.Error), s.msgs.map { it.kind }); assertTrue(s.assistant.convo)
        var many = ChatState()
        repeat(ChatReducer.MAX + 30) { many = ChatReducer.push(many, MsgKind.Notice, "n$it", true, it.toLong()) }
        assertEquals(ChatReducer.MAX, many.msgs.size); assertEquals("n${ChatReducer.MAX + 29}", many.msgs.last().text)
    }

    @Test fun dictationPhases() {
        var s = ChatState()
        for (e in listOf("""{"type":"start"}""", """{"type":"partial","text":"hel"}""", """{"type":"working"}""", """{"type":"clean","text":"Hello."}""")) s = ChatReducer.dictation(s, j(e))
        assertEquals(Dictation(DictPhase.Done, "hel", "Hello."), s.dictation)
        assertNull(ChatReducer.dictation(s, j("""{"type":"cancel"}""")).dictation)
    }

    @Test fun approvalsFromTheLocalAssistantAndThePc() {
        var l = ApprovalReducer.add(emptyList(), ApprovalReducer.local(j("""{"id":"a","title":"Send it","detail":"WhatsApp","tool":"send","timeoutMs":15000}""")))
        l = ApprovalReducer.link(l, "confirm", j("""{"id":"p","title":"Run build","detail":"pnpm build"}"""))
        assertEquals(listOf("a", "p"), l.map { it.id }); assertEquals(ApprovalSource.Pc, l[1].source); assertEquals(15000, l[0].timeoutMs)
        l = ApprovalReducer.link(l, "confirm", j("""{"id":"p","title":"Run build again"}""")) // same id: replaced, not duplicated
        assertEquals(listOf("a", "p"), l.map { it.id }); assertEquals("Run build again", l[1].title)
        assertEquals(listOf("a"), ApprovalReducer.link(l, "confirm-done", j("""{"id":"p"}""")).map { it.id })
        assertEquals(l, ApprovalReducer.link(l, "nudge", j("""{"id":"zz"}""")))
        assertEquals(l, ApprovalReducer.link(l, "confirm", null))
    }

    @Test fun faceIsTheHighestPriorityActivityAndHonoursSettings() {
        val appr = listOf(Approval("a", "Send it", ""))
        val job = listOf(Job("j", "agent", "Summarise", JobStatus.Running, "3 of 9"))
        val pc = PcStatus(paired = true, connected = true, name = "Studio")
        val busy = Assistant(VoiceState.Thinking)
        fun face(en: Set<String>?, a: List<Approval> = appr) = Activities.of(a, busy, null, job, Media(true, "Spotify", "Song", "Artist", true), emptyList(), pc, en).map { it.kind }
        assertEquals(listOf(ActivityKind.Approval, ActivityKind.Voice, ActivityKind.Job, ActivityKind.Music, ActivityKind.Pc), face(null))
        assertEquals(listOf(ActivityKind.Approval, ActivityKind.Pc), face(setOf("pc"))) // approvals are never hidden
        assertEquals(listOf(ActivityKind.Idle), Activities.of(emptyList(), Assistant(), null, emptyList(), null, emptyList(), PcStatus(), null).map { it.kind })
        assertEquals(ActivityKind.Voice, Activities.of(emptyList(), Assistant(), Dictation(DictPhase.Listening), emptyList(), null, emptyList(), PcStatus(), null).first().kind)
        assertEquals(listOf(ActivityKind.Idle), Activities.of(emptyList(), Assistant(), Dictation(DictPhase.Done, "", "x"), emptyList(), null, emptyList(), PcStatus(), null).map { it.kind })
    }

    @Test fun spiritFollowsTheVoiceState() {
        assertEquals(SoulMode.HEARING, spiritMode(VoiceState.Listening, null))
        assertEquals(SoulMode.HEARING, spiritMode(VoiceState.Connecting, null))
        assertEquals(SoulMode.THINKING, spiritMode(VoiceState.Thinking, null))
        assertEquals(SoulMode.TALKING, spiritMode(VoiceState.Speaking, null))
        assertEquals(SoulMode.LISTENING, spiritMode(VoiceState.Idle, null))
        assertEquals(SoulMode.WRITING, spiritMode(VoiceState.Idle, DictPhase.Working))
        assertEquals(SoulMode.HEARING, spiritMode(VoiceState.Idle, DictPhase.Listening))
    }

    @Test fun settingsSnapshotReadsThemeAccentSkinAndPhoneFlags() {
        val s = Parse.settings(j("""{"appearance":{"theme":"light","accent":"#8ED92F","reduceMotion":true},"loadout":{"soul":"drop"},"phone":{"spirit":"calm","haptics":false,"activities":["pc","job"]}}"""))
        assertEquals(false, s.dark); assertEquals(0xFF8ED92FL, s.accent); assertEquals("drop", s.skin)
        assertTrue(s.calmSpirit); assertEquals(false, s.haptics); assertTrue(s.reduceMotion); assertEquals(setOf("pc", "job"), s.activities)
        val d = Parse.settings(j("""{"appearance":{"theme":"auto","accent":"wallpaper"}}"""))
        assertNull(d.dark); assertEquals(0xFFFF7FB8L, d.accent); assertEquals("puff", d.skin); assertTrue(d.haptics); assertNull(d.activities)
    }

    @Test fun todayListsPendingTasksThenLoopsSoonestFirstUntimedLast() {
        val tasks = JSONArray("""[{"id":"1","title":"Late","runAt":"2026-10-16T18:00:00Z","status":"pending"},{"id":"2","title":"Done","runAt":"2026-10-16T08:00:00Z","status":"done"},{"id":"3","title":"Early","runAt":"2026-10-16T09:00:00Z","status":"pending","repeat":"daily"}]""")
        val loops = JSONArray("""[{"id":"x","what":"Reply to Ravi","who":"Ravi"},{"id":"y","what":"Pay rent","due":"2026-10-16T12:00:00Z"}]""")
        val t = Parse.today(tasks, loops)
        assertEquals(listOf("Early", "Pay rent", "Late", "Reply to Ravi"), t.map { it.title })
        assertEquals("daily", t[0].repeat); assertEquals("with Ravi", t[3].sub); assertNull(t[3].atMs)
        assertTrue(Parse.today(null, null).isEmpty())
    }

    @Test fun pcStatusMapsPairedConnectedAndNowPlaying() {
        val p = Parse.pc(j("""{"enabled":true,"devices":[{"name":"Studio PC"}]}"""), j("""{"pc":"Studio","agent":"busy","jobs":["build"],"nowPlaying":{"title":"Song","artist":"Band","playing":true}}"""))
        assertTrue(p.paired && p.connected); assertEquals("Studio", p.name); assertEquals(listOf("build"), p.jobs); assertEquals("Song - Band", p.playing)
        val off = Parse.pc(j("""{"enabled":true,"devices":[{"name":"Studio PC"}]}"""), null)
        assertTrue(off.paired); assertEquals(false, off.connected); assertEquals("Studio PC", off.name)
        assertEquals(false, Parse.pc(j("""{"enabled":false}"""), null).paired)
    }
}
