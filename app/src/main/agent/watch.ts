import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../settings'
import { excluded } from './activity'

// C7 learn by watching (teach by demonstration), built on the same foreground-window feed as the opt-in activity timeline.
// What "watching" records: only WHICH APP came to the front and stayed for 2+ seconds, in order. It never records keystrokes, clipboard,
// screen contents or window titles, so there is nothing to leak: passwords, banking pages and OTPs are simply not in the data. Apps and
// windows that look like password managers, banking, wallets or private browsing are skipped altogether (a gap, not a step).
// A recording becomes a named routine of plain tool steps (open_app ...) that the user can review, edit and delete in Desk, and replay goes through
// the normal classify/confirm path in tools.ts (a confirm card the first time and after any edit). Typed-text "slots" from the plan are NOT built:
// capturing typed text is exactly what must never be recorded.
const MAX_STEPS = 25
const MIN_DWELL_MS = 2000
export const MAX_WATCH_MS = 30 * 60_000
const SECRET = /keepass|bitwarden|1password|lastpass|dashlane|enpass|nordpass|proton ?pass|authenticator|password|passkey|vault|wallet|credential|log ?in|sign ?in|otp|2fa|verification code|bank|paypal|upi|paytm|phonepe|gpay|razorpay|card|netbanking|tax|private|incognito|inprivate|\.kdbx/i
const SYSTEM = /^(explorer|searchhost|searchapp|shellexperiencehost|startmenuexperiencehost|applicationframehost|lockapp|textinputhost|systemsettings|taskmgr|dwm|lokey|electron|lokey\.host|cmd|conhost|windowsterminal)$/i
export const REPLAYABLE = new Set(['open_app', 'open_url', 'switch_window', 'web_search', 'media', 'set_volume'])

export interface Step { tool: string; args: Record<string, string>; label: string }
export interface Routine { id: string; name: string; steps: Step[]; at: string; runs: number; approvedSig?: string }

/** keep only replayable tools with short string args; used on load, on edits from the UI and before every replay */
export function cleanSteps(steps: unknown): Step[] {
  if (!Array.isArray(steps)) return []
  const out: Step[] = []
  for (const s of steps.slice(0, MAX_STEPS)) {
    if (!s || typeof s !== 'object') continue
    const t = (s as Step)
    if (!REPLAYABLE.has(String(t.tool))) continue
    const args: Record<string, string> = {}
    for (const [k, v] of Object.entries(t.args ?? {})) if (typeof v === 'string' || typeof v === 'number') args[k.slice(0, 20)] = String(v).slice(0, 200)
    const label = String(t.label ?? '').slice(0, 80) || `${t.tool} ${Object.values(args)[0] ?? ''}`.trim()
    out.push({ tool: t.tool, args, label })
  }
  return out
}
export const stepsSig = (steps: Step[]) => JSON.stringify(steps.map(s => [s.tool, s.args]))
const appName = (exe: string) => exe.replace(/\.exe$/i, '').trim()

/** true when this foreground change must not be recorded */
export const skip = (exe: string, title: string) => !appName(exe) || SYSTEM.test(appName(exe)) || SECRET.test(exe) || SECRET.test(title) || excluded(exe, title)

export class Watcher {
  active = false
  name = ''
  startedAt = 0
  steps: Step[] = []
  private cand: { app: string; at: number } | null = null
  private lastApp = ''

  start(name: string, now = Date.now()) { this.active = true; this.name = name.trim().slice(0, 40) || 'My routine'; this.startedAt = now; this.steps = []; this.cand = null; this.lastApp = '' }
  private commit(until: number) {
    const c = this.cand
    this.cand = null
    if (!c || until - c.at < MIN_DWELL_MS || c.app.toLowerCase() === this.lastApp.toLowerCase() || this.steps.length >= MAX_STEPS) return null
    this.lastApp = c.app
    const step: Step = { tool: 'open_app', args: { name: c.app }, label: `Open ${c.app}` }
    this.steps.push(step)
    return step
  }
  /** feed a foreground change; returns the step it completed, if any */
  onForeground(exe: string, title: string, now = Date.now()): Step | null {
    if (!this.active) return null
    if (now - this.startedAt > MAX_WATCH_MS) { this.active = false; return null }
    const done = this.commit(now)
    // an unrecordable window leaves a gap in the chain: the next recordable one counts as new
    if (skip(exe, title)) { this.lastApp = ''; return done }
    this.cand = { app: appName(exe), at: now }
    return done
  }
  /** end the recording; the app in front right now counts if it stayed long enough */
  stop(now = Date.now()): Step[] {
    this.commit(now)
    this.active = false
    return this.steps
  }
}

export class RoutineBook {
  rows: Routine[] = []
  constructor(private save: (r: Routine[]) => void = () => {}) {}
  load(d: unknown) { this.rows = Array.isArray(d) ? d.filter(r => r && typeof r.id === 'string').map(r => ({ ...r, name: String(r.name ?? '').slice(0, 40), steps: cleanSteps(r.steps), runs: Number(r.runs) || 0 })) : [] }
  list() { return this.rows }
  find(q: string) { const n = q.trim().toLowerCase(); return this.rows.find(r => r.id === q) ?? this.rows.find(r => r.name.toLowerCase() === n) ?? (n.length >= 3 ? this.rows.find(r => r.name.toLowerCase().includes(n) || n.includes(r.name.toLowerCase())) : undefined) }
  add(name: string, steps: Step[]): Routine {
    const r: Routine = { id: Math.random().toString(36).slice(2, 8), name: name.trim().slice(0, 40) || 'My routine', steps: cleanSteps(steps), at: new Date().toISOString(), runs: 0 }
    this.rows.push(r); this.save(this.rows)
    return r
  }
  update(id: string, patch: { name?: string; steps?: unknown }): boolean {
    const r = this.rows.find(x => x.id === id)
    if (!r) return false
    if (typeof patch.name === 'string' && patch.name.trim()) r.name = patch.name.trim().slice(0, 40)
    if (patch.steps !== undefined) r.steps = cleanSteps(patch.steps) // an edit changes the signature, so the next replay asks again
    this.save(this.rows)
    return true
  }
  remove(id: string) { const n = this.rows.length; this.rows = this.rows.filter(r => r.id !== id); this.save(this.rows); return this.rows.length < n }
  approved(r: Routine) { return r.approvedSig === stepsSig(r.steps) }
  markRun(r: Routine) { r.approvedSig = stepsSig(r.steps); r.runs++; this.save(this.rows) }
}

const file = join(dataDir, 'routines.json')
export const book = new RoutineBook(r => { try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, JSON.stringify(r)) } catch { /* in memory only */ } })
try { book.load(JSON.parse(readFileSync(file, 'utf8'))) } catch { /* none yet */ }
export const watcher = new Watcher()

/** hooks the app sets so the recording is always visible: tray label, caption, glow */
export const watchUi: { changed: () => void; notice: (t: string) => void } = { changed: () => undefined, notice: () => undefined }
let timer: ReturnType<typeof setTimeout> | null = null

export function startWatching(name: string): void {
  watcher.start(name)
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { if (watcher.active) { stopWatching(); watchUi.notice('Stopped watching after 30 minutes.') } }, MAX_WATCH_MS)
  timer.unref?.()
  watchUi.changed()
  watchUi.notice(`Watching which apps you open for "${watcher.name}". Say or click stop when you are done.`)
}
export function stopWatching(): Routine | null {
  if (timer) { clearTimeout(timer); timer = null }
  if (!watcher.active) return null
  const name = watcher.name, steps = watcher.stop()
  const r = steps.length ? book.add(name, steps) : null
  watchUi.changed()
  watchUi.notice(r ? `Saved "${r.name}" with ${r.steps.length} step${r.steps.length === 1 ? '' : 's'}. Review it in Desk.` : 'Stopped watching. I saw nothing worth saving.')
  return r
}
/** called from the foreground feed */
export function watchForeground(exe: string, title: string) {
  const s = watcher.onForeground(exe, title)
  if (s) watchUi.notice(`Noted: ${s.label}`)
  if (!watcher.active && timer) { clearTimeout(timer); timer = null; watchUi.changed(); watchUi.notice('Stopped watching (time limit).') }
}

export function watchSelfCheck(): string {
  const need = (c: unknown, m: string) => { if (!c) throw new Error('watch: ' + m) }
  const T = 1_000_000
  const w = new Watcher()
  need(w.onForeground('excel.exe', 'Q3.xlsx', T) === null, 'inactive watcher records nothing')
  w.start('Month end', T)
  w.onForeground('EXCEL.EXE', 'Q3 report.xlsx - Excel', T)
  w.onForeground('chrome.exe', 'Inbox - Gmail', T + 5000)         // excel stayed 5 s -> step
  w.onForeground('KeePassXC.exe', 'Database unlocked', T + 9000)  // chrome stayed 4 s -> step; keepass is skipped
  w.onForeground('notepad.exe', 'Untitled', T + 9500)             // gap
  w.onForeground('chrome.exe', 'Netbanking - HDFC', T + 11000)    // notepad only 1.5 s -> dropped; banking skipped
  w.onForeground('chrome.exe', 'Docs', T + 12000)                 // not committed yet
  w.onForeground('Code.exe', 'main.ts', T + 13000)                // chrome 1 s -> dropped (too short)
  w.onForeground('Code.exe', 'main.ts', T + 20000)                // same app again, Code is the candidate already
  const steps = w.stop(T + 25000)
  need(steps.map(s => s.args.name).join() === 'EXCEL,chrome,Code', `steps are only apps that stayed: ${steps.map(s => s.args.name)}`)
  need(!JSON.stringify(steps).match(/Gmail|Q3|xlsx|HDFC|Netbanking|KeePass|Database|Untitled/i), 'no window titles and nothing from secret windows are stored')
  need(steps.every(s => s.tool === 'open_app'), 'steps are plain tool calls')
  need(skip('chrome.exe', 'Sign in to your account') && skip('msedge.exe', 'InPrivate browsing') && skip('Bitwarden.exe', 'x') && skip('PhonePe.exe', 'x') && skip('chrome.exe', 'Enter OTP') && skip('explorer.exe', 'Documents') && !skip('Code.exe', 'main.ts'), 'secret and system windows are skipped')
  const w2 = new Watcher(); w2.start('x', T)
  w2.onForeground('a.exe', 't', T); w2.onForeground('b.exe', 't', T + 3000)
  need(w2.onForeground('c.exe', 't', T + MAX_WATCH_MS + 5000) === null && !w2.active, 'recording ends itself after 30 minutes')
  const w3 = new Watcher(); w3.start('cap', T)
  for (let i = 0; i < 40; i++) w3.onForeground(`app${i}.exe`, 't', T + i * 3000)
  need(w3.stop(T + 200_000).length === MAX_STEPS, 'step cap')
  // the book: review / edit / delete, and an edit asks again
  let saved = 0
  const b = new RoutineBook(() => { saved++ })
  const r = b.add('  Month end ', steps)
  need(r.name === 'Month end' && r.steps.length === 3 && saved === 1, 'saved')
  need(b.find('month')?.id === r.id && b.find('zzz') === undefined, 'find by name')
  need(!b.approved(r), 'a new routine is not approved yet')
  b.markRun(r)
  need(b.approved(r) && r.runs === 1, 'first run approves the exact steps')
  need(b.update(r.id, { name: 'Close the books', steps: [...r.steps, { tool: 'run_command', args: { command: 'del *' }, label: 'x' }, { tool: 'open_app', args: { name: 'Teams' }, label: 'Open Teams' }] }), 'edit')
  need(r.name === 'Close the books' && r.steps.length === 4 && r.steps.every(s => REPLAYABLE.has(s.tool)), 'edit keeps only replayable tools (a smuggled run_command is dropped)')
  need(!b.approved(r), 'an edit asks again')
  need(b.remove(r.id) && b.list().length === 0, 'delete')
  return 'ok'
}
