package app.lokey.link.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * Kotlin side of the core message channel (src/mobile/hostProtocol.ts, docs/NATIVE-APP.md "Core protocol"):
 * one JSON object per message. Out: call / sub / unsub. In: res / ev / ready.
 */
sealed interface HostMsg {
    data class Res(val id: Int, val ok: Boolean, val value: Any?, val error: String?) : HostMsg
    data class Ev(val sid: Int, val value: Any?) : HostMsg
    data class Ready(val ok: Boolean, val kind: String?, val error: String?) : HostMsg
}

object HostCodec {
    /** org.json's null marker -> Kotlin null, recursively left alone (callers read through [str], [obj]...) */
    fun unNull(v: Any?): Any? = if (v === JSONObject.NULL) null else v

    private fun args(a: List<Any?>) = JSONArray().also { arr -> a.forEach { arr.put(JSONObject.wrap(it) ?: JSONObject.NULL) } }

    fun call(id: Int, path: String, a: List<Any?>): String =
        JSONObject().put("t", "call").put("id", id).put("path", path).put("args", args(a)).toString()

    fun sub(sid: Int, path: String, a: List<Any?>): String =
        JSONObject().put("t", "sub").put("sid", sid).put("path", path).put("args", args(a)).toString()

    fun unsub(sid: Int): String = JSONObject().put("t", "unsub").put("sid", sid).toString()

    /** null for anything that is not a well-formed message (the channel never throws on bad input) */
    fun decode(json: String): HostMsg? = try {
        val o = JSONObject(json)
        when (o.optString("t")) {
            "res" -> if (!o.has("id")) null else HostMsg.Res(o.getInt("id"), o.optBoolean("ok"), unNull(o.opt("v")), if (o.has("err")) o.optString("err") else null)
            "ev" -> if (!o.has("sid")) null else HostMsg.Ev(o.getInt("sid"), unNull(o.opt("v")))
            "ready" -> HostMsg.Ready(o.optBoolean("ok"), if (o.has("kind")) o.optString("kind") else null, if (o.has("error")) o.optString("error") else null)
            else -> null
        }
    } catch (_: Exception) { null }
}

/** safe readers for the loosely typed JSON the core sends */
fun Any?.obj(): JSONObject? = this as? JSONObject
fun Any?.arr(): JSONArray? = this as? JSONArray
fun JSONObject.str(k: String, d: String = ""): String = if (isNull(k)) d else optString(k, d)
fun JSONObject.strOrNull(k: String): String? = if (isNull(k)) null else optString(k).takeIf { it.isNotEmpty() }
fun JSONObject.long(k: String, d: Long = 0): Long = if (isNull(k)) d else optLong(k, d)
fun JSONObject.bool(k: String, d: Boolean = false): Boolean = if (isNull(k)) d else optBoolean(k, d)
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
