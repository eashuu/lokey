package app.lokey.link

import app.lokey.link.VivoSuperX.Right
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pins the wire format of the vivo-full payload. Says nothing about what a phone does with it. */
class VivoSuperXTest {
    class Rec : VivoSuperX.Sink {
        val m = LinkedHashMap<String, Any?>()
        override fun child() = Rec()
        override fun putInt(k: String, v: Int) { m[k] = v }
        override fun putBoolean(k: String, v: Boolean) { m[k] = v }
        override fun putString(k: String, v: String) { m[k] = v }
        override fun putIntList(k: String, v: List<Int>) { m[k] = v }
        override fun putParcel(k: String, v: Any?) { m[k] = v }
        override fun putParcelList(k: String, v: List<Any>) { m[k] = v }
        override fun putBundle(k: String, v: VivoSuperX.Sink) { m[k] = v }
        fun b(k: String) = m[k] as Rec
    }

    private val icon = Any(); private val click = Any()
    private fun wire(f: Face, now: Long = 0) = Rec().also { VivoSuperX.write(VivoSuperX.plan(f, now), icon, click, it) }
    private fun right(r: Rec) = r.b("notification.superx.island").b("island.superx.rightInfo")

    @Test fun faceMapping() {
        fun r(kind: String, title: String = "x") = VivoSuperX.right(Face("a", kind, title))
        assertEquals(Right.RHYTHM, r("voice", "Listening...")); assertEquals(Right.LOADING, r("voice", "Thinking..."))
        assertEquals(Right.TEXT_ICON, r("voice", "Speaking...")); assertEquals(Right.PROGRESS, r("timer")); assertEquals(Right.PROGRESS, r("job"))
        assertEquals(Right.CAPSULE, r("approval")); assertEquals(Right.ICON_TEXT, r("pc")); assertEquals(Right.TEXT_ICON, r("reminder"))
    }

    @Test fun commonKeys() {
        val w = wire(Face("a", "approval", "Delete file", "Lokey wants to"))
        assertEquals(0, w.m["notification.superx.operation"]); assertEquals(true, w.m["notification.superx.showNotify"])
        assertEquals("TRAIN", w.m["notification.superx.scene"]); assertEquals(0, w.m["notification.superx.changedRecord"]); assertSame(click, w.m["notification.superx.clickResp"])
        assertEquals(1, w.m["notification.superx.template"])
        val base = w.b("notification.superx.baseInfos")
        assertEquals("Delete file", base.m["notification.superx.baseInfos.title"]); assertEquals("Lokey wants to", base.m["notification.superx.baseInfos.content"])
        val cap = w.b("notification.superx.capsule")
        assertEquals(1, cap.m["notification.superx.capsule.state"]); assertEquals("Delete file", cap.m["notification.superx.capsule.content"])
        val isl = w.b("notification.superx.island")
        assertEquals(1, isl.m["island.superx.leftTemplate"]); assertEquals(6, isl.m["island.superx.rightTemplate"])
        assertEquals("Delete file", isl.b("island.superx.leftInfo").m["island.superx.leftInfo.content"])
        // one Icon instance everywhere
        listOf(base.m["notification.superx.baseInfos.icon"], cap.m["notification.superx.capsule.icon"], w.b("notification.superx.infos").m["notification.superx.infos.image"],
            w.b("notification.superx.shortInfos").m["notification.superx.shortInfos.image"], isl.b("island.superx.leftInfo").m["island.superx.leftInfo.icon"]).forEach { assertSame(icon, it) }
        assertEquals("Delete file", w.b("notification.superx.infos").m["notification.superx.infos.describe"])
        assertEquals("Lokey wants to", w.b("notification.superx.shortInfos").m["notification.superx.shortInfos.coreInfoShort"])
    }

    @Test fun capsuleApprove() { assertEquals("Approve?", right(wire(Face("a", "approval", "t"))).m["island.superx.rightInfo.capsuleContent"]); assertTrue(right(wire(Face("a", "approval", "t"))).m.containsKey("island.superx.rightInfo.capsuleBgColor")) }

    @Test fun rhythm() { val r = right(wire(Face("a", "voice", "Listening...")))
        assertEquals(1, wire(Face("a", "voice", "Listening...")).b("notification.superx.island").m["island.superx.rightTemplate"]); assertEquals(1, r.m["island.superx.rightInfo.waveState"]); assertEquals(1, (r.m["island.superx.rightInfo.waveColor"] as List<*>).size) }

    @Test fun loading() { val w = wire(Face("a", "voice", "Thinking...")); assertEquals(3, w.b("notification.superx.island").m["island.superx.rightTemplate"]); assertTrue(right(w).m.containsKey("island.superx.rightInfo.loadingColor")) }

    @Test fun speakingAndReminderText() {
        val s = right(wire(Face("a", "voice", "Speaking...", "It is 14 degrees and sunny, take a coat")))
        assertEquals("It is 14 degrees and sun", s.m["island.superx.rightInfo.content"]); assertSame(icon, s.m["island.superx.rightInfo.icon"])   // short reply, 24 chars
        val rem = wire(Face("a", "reminder", "Call mum", "6 pm"))
        assertEquals(4, rem.b("notification.superx.island").m["island.superx.rightTemplate"]); assertEquals("Call mum", right(rem).m["island.superx.rightInfo.content"])
    }

    @Test fun pcIconText() { val w = wire(Face("a", "pc", "My PC", "Connected")); assertEquals(5, w.b("notification.superx.island").m["island.superx.rightTemplate"]); assertEquals("Connected", right(w).m["island.superx.rightInfo.content"]) }

    @Test fun progressTemplate() {
        val w = wire(Face("a", "timer", "Focus", progress = 0.4))
        assertEquals(2, w.m["notification.superx.template"]); assertEquals(2, w.b("notification.superx.island").m["island.superx.rightTemplate"])
        val r = right(w); assertEquals(40, r.m["island.superx.rightInfo.progressValue"]); assertEquals(0, r.m["island.superx.rightInfo.progressState"])
        val inf = w.b("notification.superx.infos")
        assertEquals(40, inf.m["notification.superx.infos.progress"]); assertEquals(2, (inf.m["notification.superx.infos.nodeIcon"] as List<*>).size)
        assertSame(icon, inf.m["notification.superx.infos.indicatorIcon"]); assertEquals(1, inf.m["notification.superx.infos.indicatorLoc"])
        assertFalse(inf.m.containsKey("notification.superx.infos.describe"))
    }

    @Test fun progressEdgesFallBackToBaseTemplate() {
        assertEquals(1, wire(Face("a", "job", "Job")).m["notification.superx.template"])               // no progress yet -> 0 %
        assertEquals(1, wire(Face("a", "job", "Job", progress = 1.0)).m["notification.superx.template"])
        assertEquals(3, VivoSuperX.plan(Face("a", "timer", "T", startAt = 0, endAt = 100_000), 30_000).percent!! / 10)   // derived from start / end
    }

    @Test fun endIsOnlyOperation2() { val e = Rec().also { VivoSuperX.writeEnd(it) }; assertEquals(mapOf<String, Any?>("notification.superx.operation" to 2), e.m) }

    @Test fun overlayHiddenOnlyWhenUserConfirmed() {
        assertFalse(VivoSuperX.hideOverlay("system", "")); assertFalse(VivoSuperX.hideOverlay("system", "no")); assertFalse(VivoSuperX.hideOverlay("both", "yes"))
        assertFalse(VivoSuperX.hideOverlay("overlay", "yes")); assertTrue(VivoSuperX.hideOverlay("system", "yes"))
    }

    @Test fun throttle() { assertEquals(0, VivoMap.waitMs(0, 5)); assertEquals(7_000, VivoMap.waitMs(1_000, 4_000)); assertNull(null) }

    @Test fun routeDefaults() {
        assertEquals("full", VivoSuperX.routeOf(null, true)); assertEquals("subset", VivoSuperX.routeOf(null, false))
        assertEquals("subset", VivoSuperX.routeOf("subset", true)); assertEquals("full", VivoSuperX.routeOf("full", false)); assertEquals("full", VivoSuperX.routeOf("junk", true))
    }

    @Test fun islandCheckDue() {
        assertTrue(VivoSuperX.needsCheck(true, "", ""))                  // existing install, prefs unset
        assertFalse(VivoSuperX.needsCheck(false, "", ""))                // non-vivo skips it
        assertFalse(VivoSuperX.needsCheck(true, "done", ""))             // answered in the check
        assertFalse(VivoSuperX.needsCheck(true, "", "yes")); assertFalse(VivoSuperX.needsCheck(true, "", "no"))   // answered earlier in the probe UI
    }

    @Test fun coalescerBudget() {
        val c = VivoSuperX.Coalescer()
        assertEquals(0, c.decide("a", 1_000)); c.sent("a", 1_000)
        assertEquals(-1, c.decide("a", 2_000))                           // same wire content: nothing to send
        assertEquals(9_000, c.decide("b", 2_000))                        // changed: trailing update when the 10 s are over
        assertEquals(0, c.decide("b", 11_000)); c.sent("b", 11_000)
        assertEquals(-1, c.decide("b", 12_000)); assertEquals(0, c.decide("a", 21_000))
        c.reset(); assertEquals(0, c.decide("b", 11_500))                // after an end the next create is immediate
    }

    @Test fun voiceStatesCostOneUpdateEach() {
        fun sig(t: String, sub: String) = VivoSuperX.sig(VivoSuperX.plan(Face("v", "voice", t, sub), 0))
        assertEquals(sig("Listening...", ""), sig("Listening...", "partial transcript that keeps changing"))   // RHYTHM text is state-only
        assertEquals(sig("Thinking...", "a"), sig("Thinking...", "b"))
        assertFalse(sig("Listening...", "") == sig("Thinking...", ""))
        assertFalse(sig("Speaking...", "one") == sig("Speaking...", "two"))                                      // TEXT_ICON carries the reply
    }

    @Test fun musicAndCharging() {
        assertEquals(Right.TEXT_ICON, VivoSuperX.right(Face("m", "music", "Song", "Artist")))
        assertEquals("Artist", VivoSuperX.plan(Face("m", "music", "Song", "Artist", progress = 0.3), 0).rightText)
        assertEquals(Right.ICON_TEXT, VivoSuperX.right(Face("c", "charging", "80%", "Charging")))
        assertEquals(VivoSuperX.sig(VivoSuperX.plan(Face("m", "music", "S", "A", progress = 0.1), 0)), VivoSuperX.sig(VivoSuperX.plan(Face("m", "music", "S", "A", progress = 0.9), 0)))   // position ticks are free
    }
}
