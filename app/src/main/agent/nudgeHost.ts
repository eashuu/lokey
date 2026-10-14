import type { Scheduler } from './scheduler'
import { nudge } from './nudge'
import { dueWork } from '../brain/memory/promises'
import { linkPush } from '../link/server'

// Glue: delivers nudges as caption notices and turns promises with a due time into scheduler reminders / "did you...?" nudges.
// ponytail: no focus-timer check (the timer lives in the renderer); pass focus=true here once main knows about it.
type Host = { notice: (text: string, tone?: 'info' | 'error') => void; scheduler: Scheduler }
export const sendNudge = (h: Host, kind: string, text: string, priority: number) => nudge(kind, text, priority, { now: new Date(), focus: false, deliver: (_k, t) => { h.notice(t, 'info'); linkPush('nudge', { text: t }) } })

export function startPromiseLoop(h: Host): NodeJS.Timeout {
  const tick = () => {
    const { remind, overdue } = dueWork()
    for (const p of remind) h.scheduler.add({ title: `Reminder: ${p.what}`, runAt: p.due!, steps: [], say: `Reminder: ${p.what}.`, approved: true })
    for (const p of overdue) sendNudge(h, 'promise', `Did you ${p.what.replace(/^(to )/i, '')}?`, 6)
  }
  setTimeout(tick, 5_000).unref?.()
  const t = setInterval(tick, 60_000); t.unref?.()
  return t
}
