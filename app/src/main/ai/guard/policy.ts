import { join } from 'node:path'
import { dataDir } from '../../settings'
import { getDb, readDoc, writeDoc } from '../db'
import { Strikes } from './strikes'
import { Taint, taint as sessionTaint } from './taint'

// The deterministic policy engine (plan 3.7, step 5). The model proposes, this decides. It runs for every tool call, after tools.ts has
// said what the call is worth on its own (safe / ask / deny), and can only make the outcome stricter:
//   1 kill switch / halted     -> refuse            5 Rule of Two (untrusted input + sensitive data + state change) -> card
//   2 protected list (classify) -> refuse           6 rate and budget caps per class -> refuse
//   3 origin rules (in tools.ts)                    7 anomaly flags (first recipient or domain, night hours, bulk) -> card
//   4 taint flow: an argument that came out of untrusted text -> card showing where
//   8 autonomy level and earned trust (in tools.ts; a card forced by 4-7 or by strikes cannot be skipped by either)
//   9 a typed confirmation card (send / buy / publish / delete / share-personal / credential / run)
export type SideClass = 'read' | 'local-write' | 'external-send' | 'destructive' | 'irreversible' | 'credential'
export type CardKind = 'send' | 'buy' | 'publish' | 'delete' | 'share-personal' | 'credential' | 'run'
export const CARD_LABEL: Record<CardKind, string> = { send: 'Send', buy: 'Purchase', publish: 'Publish', delete: 'Delete', 'share-personal': 'Share personal info', credential: 'Credential', run: 'Run' }

const READ = new Set(['get_context', 'read_selection', 'list_windows', 'find_files', 'briefing', 'list_tasks', 'recall', 'search_activity', 'day_summary', 'read_file', 'list_dir', 'web_fetch', 'web_research', 'see_screen', 'list_processes', 'get_settings', 'agent_status', 'weekly_review', 'triage_inbox', 'triage_calendar', 'draft_as_me', 'draft_reply', 'undo_setting_peek'])
const EGRESS = new Set(['web_fetch', 'download_file', 'open_url', 'web_search'])
const PROTECTED_TOOLS = new Set(['run_command', 'write_file', 'delete_file', 'move_file', 'copy_file', 'kill_process', 'power'])
const MCP_READ = /^(get|list|read|search|find|fetch|view|query|describe|show|lookup|check)([_-]|$)/i
const SEND = /send|reply|forward|respond|invite|rsvp|publish|(^|_)share|(^|_)post(_|$)|tweet/i
const SEND_LOOSE = /message|email|mail|sms/i
const DESTROY = /delete|remove|drop|destroy|purge|erase|wipe/i
const BUY = /buy|purchase|order|pay|checkout|book|subscribe/i
const RECIPIENT_KEYS = ['to', 'recipient', 'recipients', 'email', 'address', 'phone', 'number', 'channel', 'chat', 'contact']

export function classOf(name: string, a: Record<string, unknown>): SideClass {
  if (name.startsWith('mcp_')) {
    const t = name.split('__').slice(1).join('__') || name
    if (SEND.test(t)) return 'external-send'
    if (DESTROY.test(t)) return 'destructive'
    if (MCP_READ.test(t)) return 'read'
    return SEND_LOOSE.test(t) ? 'external-send' : 'local-write'
  }
  if (READ.has(name)) return 'read'
  if (name === 'delete_file' || name === 'kill_process' || name === 'forget' || name === 'close_app') return 'destructive'
  if (name === 'power') return String(a.action) === 'lock' ? 'local-write' : 'irreversible'
  if (name === 'run_command') return 'irreversible'
  return 'local-write'
}

export function cardKind(name: string, cls: SideClass): CardKind | null {
  const t = name.startsWith('mcp_') ? name.split('__').slice(1).join('__') : name
  if (cls === 'credential') return 'credential'
  if (cls === 'destructive') return 'delete'
  if (cls === 'irreversible') return 'run'
  if (cls === 'external-send') return /publish|post|tweet|(^|_)share/i.test(t) ? 'publish' : BUY.test(t) ? 'buy' : 'send'
  if (BUY.test(t)) return 'buy'
  return null
}

export interface Check {
  name: string; args: Record<string, unknown>
  /** what classify() said on its own */
  base: 'safe' | 'ask' | 'deny'
  origin?: string; scheduled?: boolean; approved?: boolean
  /** the MCP tool's definition changed since the person approved it */
  pinChanged?: boolean
  /** the window the action lands in is a banking or payment window */
  watch?: boolean
}
export interface Verdict {
  action: 'deny' | 'run' | 'ask'
  /** a card forced by the policy: neither earned trust nor full control may skip it */
  forced: boolean
  reasons: string[]
  cls: SideClass
  card: CardKind | null
  /** the lines to add to the card: where the data came from and what cannot be undone */
  note: string
  delayMs: number
}

// rate and budget caps per hour (plan: external sends 10, deletes 20, shell 30, downloads 5)
const CAPS: { test: (n: string, c: SideClass) => boolean; max: number; label: string }[] = [
  { test: (_n, c) => c === 'external-send', max: 10, label: 'messages and posts' },
  { test: (_n, c) => c === 'destructive', max: 20, label: 'deletions' },
  { test: n => n === 'run_command', max: 30, label: 'shell commands' },
  { test: n => n === 'download_file', max: 5, label: 'downloads' },
]
const HOUR = 3_600_000
const BULK = 25

export class Guard {
  readonly strikes = new Strikes()
  paused = false
  private hits = new Map<string, number[]>()
  private seen = new Set<string>()
  private loaded = false
  private file = join(dataDir, 'guard-seen.json')

  constructor(readonly taint: Taint = sessionTaint, private now: () => number = Date.now, private persist = true) {}

  private load() {
    if (this.loaded) return
    this.loaded = true
    if (!this.persist || !getDb()) return
    const d = readDoc<string[]>('guard.seen', this.file)
    if (Array.isArray(d)) this.seen = new Set(d.slice(-500))
  }

  /** a new spoken or typed request from the person */
  newTurn() { this.paused = false; this.strikes.newTurn() }
  /** the kill switch */
  halt() { this.paused = true }

  private recipients(a: Record<string, unknown>): string[] {
    const out: string[] = []
    for (const k of RECIPIENT_KEYS) { const v = a[k]; if (typeof v === 'string' && v.trim()) out.push(`r:${v.trim().toLowerCase()}`); else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(`r:${x.trim().toLowerCase()}`) }
    return out
  }
  private domain(a: Record<string, unknown>): string | null { try { return typeof a.url === 'string' ? `d:${new URL(a.url).hostname.toLowerCase()}` : null } catch { return null } }
  private bulk(v: unknown, depth = 0): boolean { return Array.isArray(v) ? v.length > BULK || (depth < 2 && v.some(x => this.bulk(x, depth + 1))) : v && typeof v === 'object' && depth < 2 ? Object.values(v).some(x => this.bulk(x, depth + 1)) : false }

  check(c: Check): Verdict {
    this.load()
    const cls = classOf(c.name, c.args)
    const isC = cls !== 'read'
    const card = cardKind(c.name, cls)
    const reasons: string[] = []
    const lvl = this.strikes.level
    const v = (action: Verdict['action'], forced = false, note = ''): Verdict => ({ action, forced, reasons, cls, card, note, delayMs: lvl === 1 && action !== 'deny' ? 1500 : 0 })

    if (this.paused) { reasons.push('stopped'); return v('deny') }
    if (this.strikes.halted) { reasons.push('halted after repeated refusals'); return v('deny') }
    if (c.base === 'deny') {
      reasons.push('refused by the protected list or an origin rule')
      this.strikes.hit()
      if (PROTECTED_TOOLS.has(c.name)) this.strikes.incident(`a protected action was attempted (${c.name})`)
      return v('deny')
    }
    const flow = this.taint.flows(c.args)
    const where = this.taint.source()
    const notes: string[] = []
    let forced = false
    if (flow) { forced = true; reasons.push(`taint-flow: "${flow.token.slice(0, 60)}" came from ${flow.src}`); notes.push(`This ${flow.token.startsWith('http') || flow.token.includes('.') ? 'address or name' : 'value'} came from ${flow.src}, not from you.`) }
    if (!isC && !EGRESS.has(c.name)) return v(flow ? 'ask' : 'run', forced, notes.join(' '))
    if (!isC) return v(flow ? 'ask' : 'run', forced, notes.join(' '))

    // ---- [C]: a state change or something leaving the PC
    const unattended = c.scheduled && c.approved
    if (c.pinChanged) { forced = true; reasons.push('the tool definition changed since it was approved') }
    if (lvl >= 2) { forced = true; reasons.push('too many refusals this session: asking about every action') }
    if (this.taint.hostile) { forced = true; reasons.push('untrusted content was flagged as an injection attempt'); notes.push('Content read earlier was flagged as an attempt to give me orders.') }
    if (this.taint.ruleOfTwo() && !unattended) { forced = true; reasons.push(`rule of two: untrusted input (${where}) + your data + a state change`); notes.push(`I read something from ${where} just before this, and it is not you.`) }
    const hr = new Date(this.now()).getHours()
    if (hr < 5 && (cls === 'external-send' || cls === 'destructive' || cls === 'irreversible')) { forced = true; reasons.push('unusual hour'); notes.push('It is the middle of the night.') }
    if (this.bulk(c.args)) { forced = true; reasons.push(`bulk operation (over ${BULK} items)`); notes.push(`This touches more than ${BULK} items.`) }
    const firsts = [...this.recipients(c.args), ...(c.name === 'download_file' ? [this.domain(c.args) ?? ''] : [])].filter(x => x && !this.seen.has(x))
    if (firsts.length && (cls === 'external-send' || c.name === 'download_file')) { forced = true; reasons.push(`first time: ${firsts[0].slice(2, 50)}`); notes.push(`First time ${firsts[0].startsWith('d:') ? 'downloading from' : 'sending to'} ${firsts[0].slice(2, 50)}.`) }
    if (c.watch) { forced = true; reasons.push('banking or payment window: each step is confirmed'); notes.push('This is a banking or payment window.') }

    // ---- caps
    const t = this.now()
    for (const cap of CAPS) {
      if (!cap.test(c.name, cls)) continue
      const n = (this.hits.get(cap.label) ?? []).filter(x => t - x < HOUR).length
      if (n >= cap.max) { reasons.push(`limit reached: ${cap.max} ${cap.label} an hour`); this.strikes.hit(); return v('deny') }
    }
    if (cls === 'irreversible' || cls === 'destructive') notes.push('This cannot be undone.')
    if (forced) return v('ask', true, notes.join(' '))
    return v(c.base === 'ask' ? 'ask' : 'run', false, notes.join(' '))
  }

  /** the call is going ahead: count it against the caps and remember its recipients and domains */
  commit(name: string, args: Record<string, unknown>) {
    this.load()
    const cls = classOf(name, args), t = this.now()
    for (const cap of CAPS) if (cap.test(name, cls)) { const l = (this.hits.get(cap.label) ?? []).filter(x => t - x < HOUR); l.push(t); this.hits.set(cap.label, l) }
    let changed = false
    for (const k of [...this.recipients(args), this.domain(args) ?? '']) if (k && !this.seen.has(k)) { this.seen.add(k); changed = true }
    if (changed && this.persist && getDb()) writeDoc('guard.seen', [...this.seen].slice(-500), this.file)
    this.strikes.ok()
  }

  /** the person answered a card */
  answered(v: Verdict, approved: boolean) {
    if (approved) { this.strikes.ok(); return }
    this.strikes.hit()
    if (v.reasons.some(r => r.startsWith('taint-flow'))) this.strikes.incident('the person refused an action built from untrusted content')
  }
  /** test helper */
  forget() { this.seen.clear(); this.hits.clear() }
  known(k: string) { this.seen.add(k) }
}

export const guard = new Guard()
