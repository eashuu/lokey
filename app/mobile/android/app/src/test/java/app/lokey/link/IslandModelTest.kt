package app.lokey.link

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class IslandModelTest {
    private val payload = """{"faces":[
        {"id":"a","kind":"timer","title":"Focus","endAt":1000000,"startAt":0,"priority":1,"actions":[{"id":"stop","label":"Stop","primary":true}]},
        {"id":"b","kind":"approval","title":"Allow?","subtitle":"Delete file","priority":9},
        {"id":"c","kind":"nonsense","title":"x","progress":1.7},
        {"id":"","kind":"voice","title":"dropped"},
        {"id":"a","kind":"job","title":"dup"}],"primary":"a","spirit":"data:image/png;base64,AAAA"}"""

    @Test fun parse() {
        val u = IslandModel.parse(JSONObject(payload))
        assertEquals(listOf("a", "b", "c"), u.faces.map { it.id })
        assertEquals("idle", u.faces[2].kind)          // unknown kinds become idle
        assertEquals(1.0, u.faces[2].progress!!, 0.0)   // progress is clamped
        assertEquals("a", u.primary); assertEquals(1, u.faces[0].actions.size)
    }

    @Test fun orderPrimaryThenPriority() {
        val u = IslandModel.parse(JSONObject(payload))
        assertEquals(listOf("a", "b", "c"), IslandModel.order(u.faces, "a").map { it.id })
        assertEquals(listOf("b", "a", "c"), IslandModel.order(u.faces, null).map { it.id })
    }

    @Test fun cycleWraps() {
        val o = IslandModel.parse(JSONObject(payload)).faces
        assertEquals("b", IslandModel.cycle(o, "a", 1)); assertEquals("c", IslandModel.cycle(o, "a", -1)); assertEquals("a", IslandModel.cycle(o, "c", 1))
        assertEquals("a", IslandModel.cycle(o, "gone", 1)); assertNull(IslandModel.cycle(emptyList(), "a", 1))
    }

    @Test fun countdown() {
        assertEquals("00:00", IslandModel.countdown(-5)); assertEquals("00:01", IslandModel.countdown(1)); assertEquals("01:05", IslandModel.countdown(65_000))
        assertEquals("25:00", IslandModel.countdown(25 * 60_000L)); assertEquals("1:02:05", IslandModel.countdown(3_725_000))
    }

    @Test fun progressAndDefaults() {
        val f = Face("t", "timer", "t", startAt = 0, endAt = 100)
        assertEquals(0.25, IslandModel.progressOf(f, 25)!!, 1e-9); assertNull(IslandModel.progressOf(Face("j", "job", "j"), 5))
        assertEquals(listOf("deny", "allow"), IslandModel.actionsOf(Face("x", "approval", "x")).map { it.id })
        assertEquals(listOf("toggle", "plus1", "stop"), IslandModel.defaultActions("timer").map { it.id })
    }

    @Test fun mergeAndVisible() {
        val m = Face("native-music", "music", "song")
        assertEquals(1, IslandModel.merge(emptyList(), m).size)
        assertEquals(1, IslandModel.merge(listOf(Face("p", "music", "page")), m).size)       // the page's own music face wins
        val idle = Face("i", "idle", "idle")
        assertEquals(0, IslandModel.visible(listOf(idle), false).size); assertEquals(1, IslandModel.visible(listOf(idle), true).size)
        assertEquals("Allow?", IslandModel.chip(Face("a", "approval", "x"))); assertEquals(7, IslandModel.chip(Face("v", "voice", "Listening now"))!!.length)
    }
}

class VivoMapTest {
    @Test fun mapping() {
        assertEquals(2, VivoMap.template("timer")); assertEquals(2, VivoMap.template("job")); assertEquals(1, VivoMap.template("approval")); assertEquals(4, VivoMap.template("voice"))
        assertEquals("HEALTH_REGISTER", VivoMap.scene("approval", emptyMap()))
        assertEquals("TRAIN", VivoMap.scene("approval", mapOf("approval" to "TRAIN"))); assertEquals("HEALTH_REGISTER", VivoMap.scene("approval", mapOf("approval" to "NOPE")))
    }
    @Test fun tenSecondLimit() {
        assertEquals(0, VivoMap.waitMs(0, 5000)); assertEquals(7000, VivoMap.waitMs(1000, 4000)); assertEquals(0, VivoMap.waitMs(1000, 20000))
    }
}
