import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { activityEnabled, daySummary } from '../agent/activity'
import { trust } from '../agent/trust'
import { dataDir } from '../settings'
import { memory } from './memory'
import { allPromises, type Promise_ } from './memory/promises'

// C5 weekly review: a plain object (facts learned, promises kept/late, time per app, trust rules earned) the model can speak and
// Bond can show. Built on demand; on Sunday evening the daily loop also files a one-line version in the Bond journal.
export interface Review { from: string; facts: string[]; kept: string[]; late: string[]; apps: { app: string; minutes: number }[] | null; trustRules: string[] }
const DAY = 86_400_000

export function buildReview(now: number, facts: { text: string; created: number }[], promises: Promise_[], apps: Review['apps'], rules: string[]): Review {
  const since = now - 7 * DAY
  return {
    from: new Date(since).toISOString().slice(0, 10),
    facts: facts.filter(f => f.created > since).map(f => f.text).slice(0, 15),
    kept: promises.filter(p => p.status === 'done' && Date.parse(p.at) > since).map(p => p.what).slice(0, 10),
    late: promises.filter(p => p.status === 'open' && p.due && Date.parse(p.due) < now).map(p => p.what).slice(0, 10),
    apps, trustRules: rules.slice(0, 10),
  }
}

export function weeklyReview(now = Date.now()): Review {
  let apps: Review['apps'] = null
  if (activityEnabled()) {
    const by = new Map<string, number>()
    for (let i = 0; i < 7; i++) for (const r of daySummary(new Date(now - i * DAY))) by.set(r.app, (by.get(r.app) ?? 0) + r.minutes)
    apps = [...by].map(([app, minutes]) => ({ app, minutes })).sort((a, b) => b.minutes - a.minutes).slice(0, 6)
  }
  return buildReview(now, memory.list(), allPromises(), apps, trust.rules())
}

export const reviewLine = (r: Review) => [
  r.facts.length && `Learned ${r.facts.length} new thing${r.facts.length > 1 ? 's' : ''}`, r.kept.length && `${r.kept.length} promise${r.kept.length > 1 ? 's' : ''} kept`, r.late.length && `${r.late.length} late`,
  r.apps?.length && `most time in ${r.apps[0].app} (${r.apps[0].minutes} min)`, r.trustRules.length && `${r.trustRules.length} trusted action${r.trustRules.length > 1 ? 's' : ''}`,
].filter(Boolean).join(', ') || 'A quiet week.'

/** Sunday from 18:00, once per week: file the line in the Bond journal. Called from the daily memory loop. */
const stamp = join(dataDir, 'weekly.last')
export function weeklyTick(now = new Date()): void {
  if (now.getDay() !== 0 || now.getHours() < 18) return
  const key = now.toISOString().slice(0, 10)
  try { if (existsSync(stamp) && readFileSync(stamp, 'utf8') === key) return; writeFileSync(stamp, key) } catch { return }
  memory.setJournal(`${key} (week)`, 'Weekly review: ' + reviewLine(weeklyReview(+now)))
}

export function weeklySelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('weekly: ' + m) }
  const now = 10 * DAY, P = (what: string, status: Promise_['status'], at: number, due?: number): Promise_ => ({ id: what, what, status, at: new Date(at).toISOString(), due: due ? new Date(due).toISOString() : undefined })
  const r = buildReview(now, [{ text: 'new', created: now - DAY }, { text: 'old', created: 0 }], [P('a', 'done', now - DAY), P('b', 'open', now - 2 * DAY, now - DAY), P('c', 'done', 0)], [{ app: 'code', minutes: 90 }], ['open_app|chrome'])
  need(r.facts.join() === 'new' && r.kept.join() === 'a' && r.late.join() === 'b' && r.trustRules.length === 1, 'sections')
  need(/Learned 1 new thing, 1 promise kept, 1 late, most time in code \(90 min\), 1 trusted action/.test(reviewLine(r)), 'line ' + reviewLine(r))
  return 'ok'
}
