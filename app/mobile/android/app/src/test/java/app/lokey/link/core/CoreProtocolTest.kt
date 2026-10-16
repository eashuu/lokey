package app.lokey.link.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreProtocolTest {
    @Test fun callEncodesPathIdAndArgsIncludingNullAndJson() {
        val o = JSONObject(HostCodec.call(7, "bridge.voice.say", listOf("hi", null, 3, true, JSONObject().put("a", 1))))
        assertEquals("call", o.getString("t")); assertEquals(7, o.getInt("id")); assertEquals("bridge.voice.say", o.getString("path"))
        val a = o.getJSONArray("args")
        assertEquals(5, a.length()); assertEquals("hi", a.getString(0)); assertTrue(a.isNull(1)); assertEquals(3, a.getInt(2)); assertEquals(1, a.getJSONObject(4).getInt("a"))
    }

    @Test fun subAndUnsub() {
        val s = JSONObject(HostCodec.sub(2, "bridge.on", listOf("media.changed")))
        assertEquals("sub", s.getString("t")); assertEquals("media.changed", s.getJSONArray("args").getString(0))
        assertEquals(2, JSONObject(HostCodec.unsub(2)).getInt("sid"))
    }

    @Test fun decodesResultsEventsAndReady() {
        val ok = HostCodec.decode("""{"t":"res","id":4,"ok":true,"v":{"x":1}}""") as HostMsg.Res
        assertTrue(ok.ok); assertEquals(1, (ok.value as JSONObject).getInt("x"))
        val nul = HostCodec.decode("""{"t":"res","id":5,"ok":true,"v":null}""") as HostMsg.Res
        assertNull(nul.value)
        val bad = HostCodec.decode("""{"t":"res","id":6,"ok":false,"err":"no such member"}""") as HostMsg.Res
        assertEquals("no such member", bad.error)
        assertEquals(JSONArray("[1,2]").toString(), ((HostCodec.decode("""{"t":"ev","sid":3,"v":[1,2]}""") as HostMsg.Ev).value as JSONArray).toString())
        assertEquals(HostMsg.Ready(true, "android", null), HostCodec.decode("""{"t":"ready","ok":true,"kind":"android"}"""))
        assertEquals("boom", (HostCodec.decode("""{"t":"ready","ok":false,"error":"boom"}""") as HostMsg.Ready).error)
    }

    @Test fun malformedInputIsNullNotAnException() {
        listOf("", "nope", "[]", """{"t":"res"}""", """{"t":"ev"}""", """{"t":"other"}""").forEach { assertNull(it, HostCodec.decode(it)) }
    }
}
