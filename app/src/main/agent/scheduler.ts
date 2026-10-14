import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ScheduledTask } from '@shared/voice'
import { app, powerMonitor } from 'electron'
import { dataDir } from '../settings'

// Routines the assistant was asked to run later ("open Netflix at 7"). Persisted, survive restarts, one timer to the
// next due task (no polling). A task that came due while the PC was off/asleep for more than MISSED_AFTER is not run
// silently: it is marked missed and the user is told.
const file = join(dataDir, 'tasks.json')
export const MISSED_AFTER_MS = 5 * 60_000
const MAX_TIMER = 2 ** 31 - 1

/** the next occurrence of a routine after `now`, at the same local time of day */
export function nextRun(runAt: string, repeat: NonNullable<ScheduledTask['repeat']>, now: number): string {
  const d = new Date(runAt)
  for (let i = 0; i < 400; i++) {
    d.setDate(d.getDate() + (repeat === 'weekly' ? 7 : 1))
    const day = d.getDay()
    if (repeat === 'weekdays' && (day === 0 || day === 6)) continue
    if (d.getTime() > now) break
  }
  return d.toISOString()
}

export class Scheduler extends EventEmitter {
  private tasks: ScheduledTask[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private now: () => number = Date.now) { super() }

  load() {
    try { this.tasks = JSON.parse(readFileSync(file, 'utf8')) as ScheduledTask[] } catch (e) {
      this.tasks = []
      // a file that exists but does not parse is kept for rescue instead of being overwritten by the next save
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') try { renameSync(file, file + '.bad') } catch { /* nothing to keep */ }
    }
    // a long sleep stalls setTimeout: re-plan from the wall clock when the PC wakes
    if (app.isReady()) powerMonitor.on('resume', () => this.arm())
    return this
  }

  private save() {
    try {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(file + '.tmp', JSON.stringify(this.tasks, null, 2))
      renameSync(file + '.tmp', file)
    } catch { /* keep in memory */ }
    this.emit('changed', this.list())
  }

  list() { return this.tasks.filter(t => t.status === 'pending' || this.now() - Date.parse(t.runAt) < 24 * 3_600_000).slice(-60) }

  add(t: Omit<ScheduledTask, 'id' | 'status' | 'createdAt'>): ScheduledTask {
    const task: ScheduledTask = { ...t, id: Math.random().toString(36).slice(2, 10), status: 'pending', createdAt: new Date(this.now()).toISOString() }
    this.tasks.push(task)
    this.save()
    this.arm()
    return task
  }

  /** cancels the task and, when it is part of a flow ("open A, an hour later open B"), the rest of that flow */
  cancel(id: string) {
    const t = this.tasks.find(x => x.id === id && x.status === 'pending')
    if (t) {
      for (const x of this.tasks) if (x.status === 'pending' && (x === t || (t.flowId && x.flowId === t.flowId))) x.status = 'cancelled'
      this.save(); this.arm()
    }
    return this.list()
  }

  /** Called at start-up and whenever the list changes: run what is due, mark what was missed, arm the timer. */
  arm() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const now = this.now()
    let next = Infinity
    for (const t of this.tasks) {
      if (t.status !== 'pending') continue
      const at = Date.parse(t.runAt)
      if (at <= now) {
        if (now - at > MISSED_AFTER_MS) { t.status = 'missed'; this.again(t); this.save(); this.emit('missed', t) }
        else this.fire(t)
      } else next = Math.min(next, at)
    }
    if (next < Infinity) this.timer = setTimeout(() => this.arm(), Math.min(MAX_TIMER, next - now + 20))
    this.timer?.unref?.()
  }

  runNow(id: string) {
    const t = this.tasks.find(x => x.id === id && (x.status === 'pending' || x.status === 'missed'))
    if (t) this.fire(t)
    return this.list()
  }

  private fire(t: ScheduledTask) {
    t.status = 'done'
    this.again(t)
    this.save()
    this.emit('due', t)
  }

  /** routines: queue the next occurrence (the loop in arm() skips it because it is in the future) */
  private again(t: ScheduledTask) {
    if (!t.repeat) return
    this.tasks.push({ ...t, id: Math.random().toString(36).slice(2, 10), status: 'pending', runAt: nextRun(t.runAt, t.repeat, this.now()), createdAt: new Date(this.now()).toISOString() })
  }

  dispose() { if (this.timer) clearTimeout(this.timer); this.timer = null }

  /** Self-check with a fake clock: due, not yet due, missed after sleep, cancel. Returns a description or throws. */
  static selfCheck(): string {
    let t = Date.parse('2026-01-01T10:00:00')
    const s = new Scheduler(() => t)
    const log: string[] = []
    s.save = () => undefined as never
    s.on('due', (x: ScheduledTask) => log.push('due:' + x.title)).on('missed', (x: ScheduledTask) => log.push('missed:' + x.title))
    const mk = (title: string, min: number) => s.add({ title, runAt: new Date(t + min * 60_000).toISOString(), steps: [], say: title })
    const a = mk('a', 30); mk('b', 60); const c = mk('c', 90)
    if (log.length) throw new Error('nothing is due yet')
    t += 31 * 60_000; s.arm()
    if (log.join() !== 'due:a') throw new Error('a should be due: ' + log.join())
    s.cancel(c.id)
    t += 4 * 3_600_000; s.arm() // the PC slept for 4 hours: b was due 3h ago -> missed, c is cancelled
    if (log.join() !== 'due:a,missed:b') throw new Error('b should be missed: ' + log.join())
    if (a.status !== 'done') throw new Error('a status')
    const f1 = s.add({ title: 'f1', runAt: new Date(t + 20 * 60_000).toISOString(), steps: [], say: '', flowId: 'F', seq: 0 })
    s.add({ title: 'f2', runAt: new Date(t + 80 * 60_000).toISOString(), steps: [], say: '', flowId: 'F', seq: 1 })
    s.cancel(f1.id)
    if (s.list().some(x => x.flowId === 'F' && x.status === 'pending')) throw new Error('cancelling a flow step cancels the whole flow')
    // a daily routine: runs, then the next one is queued for tomorrow at the same time
    const r = s.add({ title: 'r', runAt: new Date(t + 10 * 60_000).toISOString(), steps: [], say: 'r', repeat: 'daily' })
    t += 11 * 60_000; s.arm()
    const nxt = s.list().find(x => x.title === 'r' && x.status === 'pending')
    if (r.status !== 'done' || !nxt || Date.parse(nxt.runAt) - Date.parse(r.runAt) !== 86_400_000) throw new Error('routine should queue tomorrow')
    if (nextRun('2026-01-02T08:00:00', 'weekdays', Date.parse('2026-01-02T09:00:00')).slice(0, 10) === '2026-01-03') throw new Error('weekdays skip the weekend')
    s.dispose()
    return 'scheduler ok'
  }
}
