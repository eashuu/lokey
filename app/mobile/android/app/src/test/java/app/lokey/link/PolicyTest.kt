package app.lokey.link

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PolicyTest {
    private fun d(enabled: Boolean = true, granted: Boolean = true, faces: Boolean = true, fg: Boolean = false, portrait: Boolean = true, locked: Boolean = false, approval: Boolean = false) =
        IslandPolicy.decide(enabled, granted, faces, fg, portrait, locked, approval)

    @Test fun showsWheneverTheAppIsNotInFrontWithoutAnyPageMessage() {
        assertTrue(d().show)                                            // the whole point: no JS involved
        assertFalse(d(fg = true).show)                                  // the in-app island covers the foreground
    }

    @Test fun decisionTable() {
        assertFalse(d(enabled = false).show); assertFalse(d(granted = false).show); assertFalse(d(faces = false).show); assertFalse(d(portrait = false).show)
        assertFalse(d(locked = true).show); assertTrue(d(locked = true, approval = true).show)                  // approvals still show on the lock screen
        assertTrue(d(enabled = false).reason.startsWith("off")); assertTrue(d(fg = true).reason.contains("foreground"))
        for (fg in listOf(true, false)) for (lock in listOf(true, false)) for (ap in listOf(true, false))                  // never shown while in front
            if (fg) assertFalse(d(fg = fg, locked = lock, approval = ap).show)
    }

    @Test fun pageFacesExpireButEndTimedOnesKeepRunning() {
        val now = 10_000_000L
        val plain = Face("v", "voice", "x")
        assertTrue(IslandPolicy.alive(plain, now - 60_000, now)); assertFalse(IslandPolicy.alive(plain, now - 121_000, now))     // 2 min TTL
        val timer = Face("t", "timer", "t", endAt = now + 600_000)
        assertTrue("a frozen page cannot kill a running timer", IslandPolicy.alive(timer, now - 3_600_000, now))
        assertTrue(IslandPolicy.alive(timer.copy(endAt = now - 20_000), now - 3_600_000, now))        // 30 s grace after the end
        assertFalse(IslandPolicy.alive(timer.copy(endAt = now - 40_000), now - 3_600_000, now))
        assertFalse(IslandPolicy.alive(timer, now - 9 * 3600_000L, now))                                  // 8 h cap
    }

    @Test fun nativeLinkFacesAreNotDuplicatedByThePage() {
        val page = listOf(Face("p1", "approval", "Run command", "ls -la"))
        val link = listOf(Face("link-1", "approval", "Run command", "ls -la"), Face("link-2", "approval", "Delete file", "x"))
        assertEquals(listOf("p1", "link-2"), IslandPolicy.mergeLink(page, link).map { it.id })
    }

    @Test fun wakeDecision() {
        assertTrue(WakePolicy.decide(true, false, true, 10_000, 0).startsWith("emit"))
        assertTrue(WakePolicy.decide(true, false, false, 10_000, 0).startsWith("launch"))           // app not in front: open it
        assertTrue(WakePolicy.decide(false, false, false, 10_000, 0).startsWith("ignore"))         // wake off or paused
        assertTrue(WakePolicy.decide(true, true, false, 10_000, 0).startsWith("ignore"))           // a voice session owns the microphone
        assertTrue(WakePolicy.decide(true, false, false, 10_000, 9_000).startsWith("ignore"))      // cooldown
    }

    @Test fun linkEventParsing() {
        val f = LinkParse.confirmFace(JSONObject("""{"id":"c9","title":"Run a command","detail":"rm -rf x\nsecond line"}"""))!!
        assertEquals("link-c9", f.id); assertEquals("approval", f.kind); assertEquals("rm -rf x", f.subtitle); assertEquals(listOf("deny", "allow"), f.actions.map { it.id })
        assertNull(LinkParse.confirmFace(JSONObject("""{"title":"no id"}""")))
        assertEquals("c9", LinkParse.cardId("link-c9")); assertNull(LinkParse.cardId("link-status")); assertNull(LinkParse.cardId("p1"))
        assertNull(LinkParse.statusFace(JSONObject("""{"agent":"idle"}""")))
        assertNotNull(LinkParse.statusFace(JSONObject("""{"agent":"working"}""")))
    }
}
