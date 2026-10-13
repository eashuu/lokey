import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ScheduledTask } from '@shared/voice'
import { dataDir } from '../settings'

// Routines the assistant was asked to run later ("open Netflix at 7"). Persisted, survive restarts, one timer to the
// next due task (no polling). A task that came due while the PC was off/asleep for more than MISSED_AFTER is not run
// silently: it is marked missed and the user is told.
const file = join(dataDir, 'tasks.json')
export const MISSED_AFTER_MS = 5 * 60_000
const MAX_TIMER = 2 ** 31 - 1

export class Scheduler extends EventEmitter {
  private tasks: ScheduledTask[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private now: () => number = Date.now) { super() }

  load() {
    try { this.tasks = JSON.parse(readFileSync(file, 'utf8')) as ScheduledTask[] } catch { this.tasks = [] }
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

  cancel(id: string) {
    const t = this.tasks.find(x => x.id === id && x.status === 'pending')
    if (t) { t.status = 'cancelled'; this.save(); this.arm() }
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
        if (now - at > MISSED_AFTER_MS) { t.status = 'missed'; this.save(); this.emit('missed', t) }
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
    this.save()
    this.emit('due', t)
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
    s.dispose()
    return 'scheduler ok'
  }
}
