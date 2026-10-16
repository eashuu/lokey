package app.lokey.link.core

enum class TimerStatus { Idle, Running, Paused, Done }

/** the focus timer (renderer lib/focus.ts): [endsAt] is epoch ms while running, [remainingMs] the value while paused */
data class TimerState(val status: TimerStatus = TimerStatus.Idle, val totalMs: Long = 0, val remainingMs: Long = 0, val endsAt: Long = 0)

object FocusTimer {
    fun remaining(s: TimerState, now: Long): Long = when (s.status) {
        TimerStatus.Running -> (s.endsAt - now).coerceAtLeast(0)
        TimerStatus.Paused -> s.remainingMs
        else -> 0
    }

    /** 1.0 = full ring, 0.0 = empty; a done timer shows a full ring */
    fun ring(s: TimerState, now: Long): Float = when {
        s.status == TimerStatus.Done || s.status == TimerStatus.Idle -> 1f
        s.totalMs <= 0 -> 0f
        else -> (remaining(s, now).toFloat() / s.totalMs).coerceIn(0f, 1f)
    }

    /** start from idle/done with [minutes], or resume when paused */
    fun start(s: TimerState, minutes: Int, now: Long): TimerState {
        val resume = s.status == TimerStatus.Paused
        val total = if (resume) s.totalMs else maxOf(1, minutes) * 60_000L
        val left = if (resume) s.remainingMs else total
        return TimerState(TimerStatus.Running, total, left, now + left)
    }

    fun pause(s: TimerState, now: Long) = if (s.status == TimerStatus.Running) s.copy(status = TimerStatus.Paused, remainingMs = remaining(s, now)) else s

    fun reset(@Suppress("UNUSED_PARAMETER") s: TimerState) = TimerState()

    fun plusMinute(s: TimerState, now: Long): TimerState = when (s.status) {
        TimerStatus.Running -> s.copy(endsAt = s.endsAt + 60_000, totalMs = s.totalMs + 60_000, remainingMs = s.remainingMs + 60_000)
        TimerStatus.Paused -> s.copy(totalMs = s.totalMs + 60_000, remainingMs = s.remainingMs + 60_000)
        TimerStatus.Done -> start(TimerState(), 1, now)
        TimerStatus.Idle -> s
    }

    /** a running timer whose time is up becomes Done */
    fun tick(s: TimerState, now: Long): TimerState =
        if (s.status == TimerStatus.Running) { val r = s.endsAt - now; if (r <= 0) s.copy(status = TimerStatus.Done, remainingMs = 0) else s.copy(remainingMs = r) } else s

    /** 5:00, 0:07, 1:05:00 */
    fun clock(ms: Long): String {
        val s = (maxOf(0, ms) + 999) / 1000
        val h = s / 3600
        return (if (h > 0) "$h:" else "") + String.format(java.util.Locale.ROOT, "%02d:%02d", (s % 3600) / 60, s % 60)
    }
}

data class Battery(val present: Boolean, val pct: Double, val charging: Boolean)
/** a short banner on the island: [low] = low-battery warning, otherwise "plugged in" */
data class Flash(val text: String, val low: Boolean, val until: Long)

object ChargeFlash {
    /** phone/activities.ts: plugging in flashes the percentage; crossing 20, 10 or 5 % while unplugged flashes a warning */
    fun next(prev: Battery?, cur: Battery?, now: Long): Flash? {
        if (cur == null || prev == null || !cur.present || !prev.present) return null
        if (cur.charging && !prev.charging) return Flash("${Math.round(cur.pct)}%", false, now + 2800)
        if (!cur.charging) for (lvl in intArrayOf(20, 10, 5)) if (cur.pct <= lvl && prev.pct > lvl) return Flash("${Math.round(cur.pct)}% left", true, now + 3600)
        return null
    }
}
