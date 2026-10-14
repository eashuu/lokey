import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../settings'

// Activity timeline (text only, opt-in): which app and window title was in front, and when. Off unless the file
// %LOCALAPPDATA%\Lokey\activity.on exists (ponytail: a marker file, because the settings schema is owned elsewhere; swap for a setting later).
const log = join(dataDir, 'activity.jsonl'), flag = join(dataDir, 'activity.on')
const KEEP_DAYS = 90
const PRIVATE = /keepass|bitwarden|1password|lastpass|dashlane|password|bank|banking|paypal|netbanking|upi|private (browsing|window)|incognito|inprivate/i
export interface Seg { at: string; app: string; title: string }

export const activityEnabled = () => existsSync(flag)
export const excluded = (app: string, title: string) => PRIVATE.test(app) || PRIVATE.test(title)

export function logForeground(exe: string, title: string, now = new Date()) {
  if (!activityEnabled()) return
  const app = exe.replace(/\.exe$/i, '')
  if (!app || excluded(app, title)) return
  try { mkdirSync(dataDir, { recursive: true }); appendFileSync(log, JSON.stringify({ at: now.toISOString(), app, title: title.slice(0, 120) }) + '\n') } catch { /* optional */ }
}
function read(): Seg[] {
  try {
    const cut = Date.now() - KEEP_DAYS * 86_400_000
    const rows = readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Seg)
    const keep = rows.filter(r => Date.parse(r.at) >= cut)
    if (keep.length < rows.length) writeFileSync(log, keep.map(r => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : '')) // retention
    return keep
  } catch { return [] }
}
export const searchActivity = (q: string, rows: Seg[] = read()) => { const n = q.toLowerCase(); return rows.filter(r => r.app.toLowerCase().includes(n) || r.title.toLowerCase().includes(n)).slice(-15).reverse() }
/** minutes per app for one day (a segment lasts until the next one, capped at 30 min) */
export function daySummary(day: Date, rows: Seg[] = read()): { app: string; minutes: number }[] {
  const d = day.toDateString(), by = new Map<string, number>()
  const today = rows.filter(r => new Date(r.at).toDateString() === d)
  today.forEach((r, i) => { const end = today[i + 1] ? Date.parse(today[i + 1].at) : Date.parse(r.at) + 60_000; by.set(r.app, (by.get(r.app) ?? 0) + Math.min(end - Date.parse(r.at), 30 * 60_000)) })
  return [...by].map(([app, ms]) => ({ app, minutes: Math.round(ms / 60_000) })).filter(x => x.minutes > 0).sort((a, b) => b.minutes - a.minutes).slice(0, 8)
}

export function activitySelfCheck(): string {
  if (!excluded('chrome', 'Netbanking - HDFC') || !excluded('KeePassXC', 'x') || !excluded('msedge', 'InPrivate browsing') || excluded('code', 'index.ts')) throw new Error('exclusions')
  const t = new Date(2026, 0, 5, 9)
  const rows: Seg[] = [{ at: t.toISOString(), app: 'code', title: 'a.ts' }, { at: new Date(+t + 10 * 60_000).toISOString(), app: 'chrome', title: 'docs' }, { at: new Date(+t + 15 * 60_000).toISOString(), app: 'code', title: 'b.ts' }]
  const s = daySummary(t, rows)
  if (s[0].app !== 'code' || s[0].minutes !== 11 || s[1].minutes !== 5) throw new Error('summary ' + JSON.stringify(s))
  if (searchActivity('docs', rows).length !== 1) throw new Error('search')
  return 'ok'
}
