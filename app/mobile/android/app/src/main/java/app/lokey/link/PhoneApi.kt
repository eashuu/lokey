package app.lokey.link

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.SearchManager
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.net.Uri
import android.os.Build
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Telephony
import android.telephony.SmsManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.TimeZone

/** What the voice agent does on the phone: intents, reminders, torch, contacts, SMS, call log, calendar, notifications. */
object PhoneApi {
    private val ctx get() = App.ctx

    fun methods(): Map<String, H> = mapOf(
        "intent.open" h { openUri(it.need("url")) },
        "intent.app" h { openApp(it.str("package"), it.str("name")) },
        "intent.timer" h { timer(it) },
        "intent.alarm" h { alarm(it) },
        "intent.maps" h { maps(it) },
        "intent.dial" h { go(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(it.need("number"))))) },
        "intent.sms" h { go(Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(it.str("number")))).putExtra("sms_body", it.str("text"))) },
        "intent.share" h { share(it) },
        "intent.play" h { play(it.need("query"), it.str("package")) },
        "intent.camera" h { go(Intent(if (it.bool("video")) MediaStore.INTENT_ACTION_VIDEO_CAMERA else MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)) },
        "intent.settings" h { Perms.openPage(it.str("page", "main")) },
        "intent.start" h { generic(it) },

        "reminder.set" h { Reminders.set(it) },
        "reminder.cancel" h { Reminders.cancel(it.need("id")) },
        "reminder.list" h { arr(Reminders.all().map { r -> r }) },

        "flashlight.set" h { Torch.set(it.bool("on", true)) },
        "contacts.search" h { contacts(it.str("query"), it.int("limit", 10)) },
        "sms.list" h { smsList(it) },
        "sms.send" h { smsSend(it.need("number"), it.need("text")) },
        "calllog.list" h { callLog(it.int("limit", 20), it.str("type")) },
        "calendar.list" h { calList(it) },
        "calendar.insert" h { calInsert(it) },

        "notifications.list" h { LokeyNotifs.list(it.int("limit", 30)) },
        "notifications.reply" h { LokeyNotifs.reply(it.need("key"), it.need("text")) },
        "notifications.dismiss" h { LokeyNotifs.dismiss(it.need("key")) },
        "notify.show" h { Notif.info(ctx, it.str("title", "Lokey"), it.str("text"), it.str("id")); ok() },
        "notify.confirm" h { Notif.confirm(ctx, it); ok() },
        "notify.progress" h { Notif.progress(ctx, it); ok() },
        "notify.cancel" h { Notif.cancel(ctx, it.need("id")); ok() },
    )

    private fun denied(perm: String, name: String): JSONObject? = if (Perms.has(perm)) null else fail("permission needed: $name (perm.request $name)")

    // ---- intents --------------------------------------------------------------------------------------------------
    /** starts an activity. From the background Android may silently refuse it unless the overlay permission is granted, which is reported. */
    private fun go(i: Intent): JSONObject {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            ctx.startActivity(i)
            if (App.foreground || Perms.granted("overlay")) ok() else ok("warning" to "Lokey was in the background; Android may have blocked the new screen (grant overlay access)")
        } catch (e: android.content.ActivityNotFoundException) { fail("no app can handle that") }
    }

    fun openUri(u: String): JSONObject {
        val uri = when {
            u.startsWith("/") -> runCatching { androidx.core.content.FileProvider.getUriForFile(ctx, "${App.pkg}.fileprovider", File(u)) }.getOrNull() ?: return fail("that path is not shareable")
            else -> Uri.parse(u)
        }
        return go(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }

    private fun openApp(pkg: String, name: String): JSONObject {
        var p = pkg
        if (p.isEmpty()) {
            val hits = Apps.search(name)
            if (hits.length() == 0) return fail("no app named \"$name\"")
            val exact = (0 until hits.length()).map { hits.getJSONObject(it) }.let { l -> l.firstOrNull { it.getString("name").equals(name, true) } ?: l[0] }
            p = exact.getString("id")
        }
        return Apps.launch(p)
    }

    private fun timer(p: JSONObject): JSONObject {
        val i = Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, p.int("seconds").coerceIn(1, 86400)).putExtra(AlarmClock.EXTRA_MESSAGE, p.str("label"))
            .putExtra(AlarmClock.EXTRA_SKIP_UI, p.bool("skipUi", true))
        return go(i)
    }

    private fun alarm(p: JSONObject): JSONObject {
        val i = Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR, p.int("hour")).putExtra(AlarmClock.EXTRA_MINUTES, p.int("minute"))
            .putExtra(AlarmClock.EXTRA_MESSAGE, p.str("label")).putExtra(AlarmClock.EXTRA_SKIP_UI, p.bool("skipUi", true))
        p.optJSONArray("days")?.let { d -> i.putExtra(AlarmClock.EXTRA_DAYS, ArrayList((0 until d.length()).map { d.getInt(it) })) }   // 1 = Sunday .. 7 = Saturday
        return go(i)
    }

    private fun maps(p: JSONObject): JSONObject {
        val q = Uri.encode(p.str("query"))
        val u = when {
            p.has("lat") && p.has("lng") -> "geo:${p.num("lat")},${p.num("lng")}?q=${p.num("lat")},${p.num("lng")}"
            p.bool("navigate") -> "google.navigation:q=$q"
            else -> "geo:0,0?q=$q"
        }
        val r = go(Intent(Intent.ACTION_VIEW, Uri.parse(u)))
        return if (r.optBoolean("ok")) r else go(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/search/?api=1&query=$q")))
    }

    private fun share(p: JSONObject): JSONObject {
        val i = Intent(Intent.ACTION_SEND).setType(p.str("type", "text/plain")).putExtra(Intent.EXTRA_TEXT, p.str("text")).putExtra(Intent.EXTRA_SUBJECT, p.str("subject"))
        return go(Intent.createChooser(i, null))
    }

    private fun play(q: String, pkg: String): JSONObject {
        val i = Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).putExtra(SearchManager.QUERY, q).putExtra(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
        if (pkg.isNotEmpty()) i.setPackage(pkg)
        val r = go(i)
        return if (r.optBoolean("ok")) r else go(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(q))))
    }

    /** any intent: {action, data, type, package, component:"pkg/cls", extras:{k:v}, categories:[..]} */
    private fun generic(p: JSONObject): JSONObject {
        val i = Intent(p.str("action", Intent.ACTION_VIEW))
        val d = p.str("data"); val t = p.str("type")
        if (d.isNotEmpty() && t.isNotEmpty()) i.setDataAndType(Uri.parse(d), t) else if (d.isNotEmpty()) i.data = Uri.parse(d) else if (t.isNotEmpty()) i.type = t
        p.str("package").takeIf { it.isNotEmpty() }?.let { i.setPackage(it) }
        p.str("component").takeIf { it.contains('/') }?.let { c -> i.setClassName(c.substringBefore('/'), c.substringAfter('/').let { s -> if (s.startsWith(".")) c.substringBefore('/') + s else s }) }
        p.optJSONArray("categories")?.strings()?.forEach { i.addCategory(it) }
        p.optJSONObject("extras")?.let { e -> e.keys().forEach { k -> when (val v = e.get(k)) { is Boolean -> i.putExtra(k, v); is Int -> i.putExtra(k, v); is Long -> i.putExtra(k, v); is Double -> i.putExtra(k, v); else -> i.putExtra(k, v.toString()) } } }
        return go(i)
    }

    // ---- contacts / sms / call log / calendar ---------------------------------------------------------------------
    private fun contacts(q: String, limit: Int): Any {
        denied(android.Manifest.permission.READ_CONTACTS, "contacts")?.let { return it }
        val out = LinkedHashMap<String, JSONObject>()
        val like = "%$q%"
        ctx.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER, ContactsContract.CommonDataKinds.Phone.TYPE, ContactsContract.CommonDataKinds.Phone.CONTACT_ID),
            if (q.isBlank()) null else "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ? OR ${ContactsContract.CommonDataKinds.Phone.NUMBER} LIKE ?", if (q.isBlank()) null else arrayOf(like, like),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} COLLATE NOCASE ASC")?.use { c ->
            while (c.moveToNext() && out.size < limit * 3) {
                val id = c.getString(3); val num = c.getString(1) ?: continue
                val o = out.getOrPut(id) { obj("name" to c.getString(0), "numbers" to JSONArray()) }
                o.getJSONArray("numbers").put(obj("number" to num, "type" to ContactsContract.CommonDataKinds.Phone.getTypeLabel(ctx.resources, c.getInt(2), "").toString()))
            }
        }
        return arr(out.values.take(limit))
    }

    private fun smsList(p: JSONObject): Any {
        denied(android.Manifest.permission.READ_SMS, "sms")?.let { return it }
        val box = if (p.str("box", "inbox") == "sent") Telephony.Sms.Sent.CONTENT_URI else Telephony.Sms.Inbox.CONTENT_URI
        val sel = ArrayList<String>(); val args = ArrayList<String>()
        p.str("address").takeIf { it.isNotEmpty() }?.let { sel += "${Telephony.Sms.ADDRESS} LIKE ?"; args += "%$it%" }
        p.str("query").takeIf { it.isNotEmpty() }?.let { sel += "${Telephony.Sms.BODY} LIKE ?"; args += "%$it%" }
        val out = ArrayList<JSONObject>(); val limit = p.int("limit", 10)
        ctx.contentResolver.query(box, arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.READ),
            sel.joinToString(" AND ").ifEmpty { null }, args.toTypedArray().takeIf { it.isNotEmpty() }, "${Telephony.Sms.DATE} DESC")?.use { c ->
            while (c.moveToNext() && out.size < limit) out += obj("id" to c.getLong(0), "address" to c.getString(1), "body" to c.getString(2), "date" to c.getLong(3), "read" to (c.getInt(4) == 1))
        }
        return arr(out)
    }

    /** sends for real (no composer): the caller (trust layer) must have the user's OK first */
    private fun smsSend(number: String, text: String): JSONObject {
        denied(android.Manifest.permission.SEND_SMS, "sms")?.let { return it }
        val sm = if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
        val parts = sm.divideMessage(text)
        sm.sendMultipartTextMessage(number, null, parts, null, null)
        return ok("parts" to parts.size)
    }

    private fun callLog(limit: Int, type: String): Any {
        denied(android.Manifest.permission.READ_CALL_LOG, "calllog")?.let { return it }
        val t = when (type) { "missed" -> CallLog.Calls.MISSED_TYPE; "incoming" -> CallLog.Calls.INCOMING_TYPE; "outgoing" -> CallLog.Calls.OUTGOING_TYPE; else -> -1 }
        val out = ArrayList<JSONObject>()
        ctx.contentResolver.query(CallLog.Calls.CONTENT_URI, arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION),
            if (t >= 0) "${CallLog.Calls.TYPE} = ?" else null, if (t >= 0) arrayOf(t.toString()) else null, "${CallLog.Calls.DATE} DESC")?.use { c ->
            while (c.moveToNext() && out.size < limit) out += obj("number" to c.getString(0), "name" to c.getString(1),
                "type" to when (c.getInt(2)) { CallLog.Calls.MISSED_TYPE -> "missed"; CallLog.Calls.INCOMING_TYPE -> "incoming"; CallLog.Calls.OUTGOING_TYPE -> "outgoing"; else -> "other" }, "date" to c.getLong(3), "durationSec" to c.getLong(4))
        }
        return arr(out)
    }

    private fun calList(p: JSONObject): Any {
        denied(android.Manifest.permission.READ_CALENDAR, "calendar")?.let { return it }
        val from = p.long("fromMs", System.currentTimeMillis()); val to = p.long("toMs", from + 7 * 86400_000L)
        val out = ArrayList<JSONObject>(); val limit = p.int("limit", 30)
        val b = CalendarContract.Instances.CONTENT_URI.buildUpon(); ContentUris.appendId(b, from); ContentUris.appendId(b, to)
        ctx.contentResolver.query(b.build(), arrayOf(CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END,
            CalendarContract.Instances.EVENT_LOCATION, CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.DESCRIPTION), null, null, "${CalendarContract.Instances.BEGIN} ASC")?.use { c ->
            while (c.moveToNext() && out.size < limit) out += obj("id" to c.getLong(0), "title" to c.getString(1), "startMs" to c.getLong(2), "endMs" to c.getLong(3), "location" to c.getString(4), "allDay" to (c.getInt(5) == 1), "description" to c.getString(6)?.take(300))
        }
        return arr(out)
    }

    /** {title, startMs, endMs?, description?, location?, allDay?, silent?}: silent=false opens the calendar's own editor, true inserts directly (WRITE_CALENDAR) */
    private fun calInsert(p: JSONObject): JSONObject {
        val start = p.long("startMs"); val end = p.long("endMs", start + 3600_000L)
        if (!p.bool("silent")) return go(Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI).putExtra(CalendarContract.Events.TITLE, p.str("title")).putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end).putExtra(CalendarContract.Events.DESCRIPTION, p.str("description")).putExtra(CalendarContract.Events.EVENT_LOCATION, p.str("location")).putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, p.bool("allDay")))
        denied(android.Manifest.permission.WRITE_CALENDAR, "calendar")?.let { return it }
        var cal = -1L
        ctx.contentResolver.query(CalendarContract.Calendars.CONTENT_URI, arrayOf(CalendarContract.Calendars._ID), "${CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL} >= ? AND ${CalendarContract.Calendars.VISIBLE} = 1",
            arrayOf(CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR.toString()), "${CalendarContract.Calendars.IS_PRIMARY} DESC")?.use { if (it.moveToFirst()) cal = it.getLong(0) }
        if (cal < 0) return fail("no writable calendar on this phone")
        val v = ContentValues().apply {
            put(CalendarContract.Events.CALENDAR_ID, cal); put(CalendarContract.Events.TITLE, p.str("title")); put(CalendarContract.Events.DTSTART, start); put(CalendarContract.Events.DTEND, end)
            put(CalendarContract.Events.DESCRIPTION, p.str("description")); put(CalendarContract.Events.EVENT_LOCATION, p.str("location")); put(CalendarContract.Events.ALL_DAY, if (p.bool("allDay")) 1 else 0)
            put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().id)
        }
        val u = ctx.contentResolver.insert(CalendarContract.Events.CONTENT_URI, v) ?: return fail("the calendar refused the event")
        return ok("id" to ContentUris.parseId(u))
    }
}

object Torch {
    fun set(on: Boolean): JSONObject {
        val cm = App.ctx.getSystemService(CameraManager::class.java)
        val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).let { c -> c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true && c.get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK } }
            ?: return fail("this phone has no flashlight")
        cm.setTorchMode(id, on)
        return ok("on" to on)
    }
}

/** Reminders: AlarmManager + a receiver that posts a heads-up notification and tells the page. They survive a reboot (BootReceiver re-arms them). */
object Reminders {
    private const val KEY = "reminders"
    private val ctx get() = App.ctx

    @Synchronized fun all(): List<JSONObject> = JSONArray(App.prefs.getString(KEY, "[]")).let { a -> List(a.length()) { a.getJSONObject(it) } }
    @Synchronized private fun save(l: List<JSONObject>) { App.prefs.edit().putString(KEY, JSONArray(l).toString()).apply() }

    private fun pi(id: String) = PendingIntent.getBroadcast(ctx, id.hashCode(), Intent(ctx, ReminderReceiver::class.java).setAction("app.lokey.link.REMIND").putExtra("id", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun arm(r: JSONObject): String {
        val am = ctx.getSystemService(AlarmManager::class.java); val at = r.getLong("at"); val id = r.getString("id")
        return if (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()) { am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi(id)); "exact" }
        else { am.setAlarmClock(AlarmManager.AlarmClockInfo(at, pi(id)), pi(id)); "alarm-clock" }
    }

    /** {id?, at (epoch ms) | inMs, title, text} */
    fun set(p: JSONObject): JSONObject {
        val at = if (p.has("at")) p.long("at") else System.currentTimeMillis() + p.long("inMs", 60_000)
        if (at < System.currentTimeMillis() - 1000) return fail("that time has passed")
        val r = obj("id" to p.str("id").ifEmpty { "r" + java.lang.Long.toString(System.nanoTime(), 36) }, "at" to at, "title" to p.str("title", "Reminder"), "text" to p.str("text"))
        save(all().filter { it.getString("id") != r.getString("id") } + r)
        val mode = arm(r); Island.nativeChanged()
        return ok("id" to r.getString("id"), "at" to at, "mode" to mode)
    }

    fun cancel(id: String): JSONObject {
        ctx.getSystemService(AlarmManager::class.java).cancel(pi(id))
        App.ui.post { Island.nativeChanged() }
        save(all().filter { it.getString("id") != id })
        return ok()
    }

    fun fired(id: String) {
        val r = all().firstOrNull { it.getString("id") == id } ?: return
        save(all().filter { it.getString("id") != id })
        saveDue(due() + r)
        Notif.reminder(ctx, r.optString("title"), r.optString("text"))
        Island.nativeChanged()
        Events.emit("reminder.fired", r, durable = true)
    }

    fun rearm() = all().forEach { r -> if (r.getLong("at") > System.currentTimeMillis()) arm(r) else fired(r.getString("id")) }

    // ---- island faces: a countdown for reminders due within 15 minutes, and "due" cards that stay until Done / Snooze ----
    private const val DUE = "reminders_due"
    private fun due(): List<JSONObject> = JSONArray(App.prefs.getString(DUE, "[]")).let { a -> List(a.length()) { a.getJSONObject(it) } }
    private fun saveDue(l: List<JSONObject>) { App.prefs.edit().putString(DUE, JSONArray(l).toString()).apply() }

    fun faces(now: Long): List<Face> =
        due().map { Face("rem-" + it.getString("id"), "reminder", it.optString("title", "Reminder"), it.optString("text").ifEmpty { "Due now" }, priority = 80,
            actions = listOf(FaceAction("snooze", "Snooze"), FaceAction("done", "Done", true))) } +
        all().filter { it.getLong("at") in now..(now + 15 * 60_000L) }.map { Face("rem-" + it.getString("id"), "timer", it.optString("title", "Reminder"), "Reminder", endAt = it.getLong("at"), priority = 30,
            actions = listOf(FaceAction("done", "Cancel", true))) }

    /** Done / Snooze (5 min) / Cancel on an island or notification card */
    fun act(id: String, action: String) {
        val r = due().firstOrNull { it.getString("id") == id } ?: all().firstOrNull { it.getString("id") == id }
        saveDue(due().filter { it.getString("id") != id })
        cancel(id)
        if (action == "snooze" && r != null) set(obj("id" to id, "inMs" to 5 * 60_000L, "title" to r.optString("title"), "text" to r.optString("text")))
        else Island.nativeChanged()
    }
}
