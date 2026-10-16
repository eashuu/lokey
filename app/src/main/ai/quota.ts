import type { ProviderConfig } from '@shared/bridge'
import type { Usage } from '../brain/types'
import type { Db } from './db'

// The quota ledger: what each provider has been asked today, what it allows (our own daily limit and rpm, plus whatever its
// 429s taught us) and when an exhausted daily quota comes back. Free tiers are a budget that is planned, not discovered:
// a call that would exceed a known limit is skipped before it is sent, and background jobs (learning, summaries) may only use
// BG_SHARE of the day's budget so the rest stays for what the person asks for.
export const BG_SHARE = 0.3            // decision D4
const BG_RPM_SHARE = 0.7               // background work needs headroom in the minute window
export interface ProviderUsage { requests: number; in: number; out: number; errors: number; last?: string }
interface Day { day: string; requests: number; tin: number; tout: number; errors: number; bg: number; last?: string }

const dayKey = (now: number) => new Date(now).toDateString()
const PROBE_EVERY_MS = 15 * 60_000
const nextLocalMidnight = (now: number) => { const d = new Date(now); d.setHours(24, 0, 0, 0); return d.getTime() }

export class QuotaLedger {
  private days = new Map<string, Day>()
  private minute = new Map<string, number[]>()               // request times in the last minute
  private out = new Map<string, { until: number; why: string; probeAt: number }>()   // exhausted daily quota (probeAt: when it was last tried anyway)
  private learned = new Map<string, number>()                // daily limit learnt from a 429: the day's requests when it hit
  private learnedRpm = new Map<string, number>()             // per-minute limit learnt from error text (only ever tightened)
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = new Set<string>()

  constructor(private db: Db | null, private now: () => number = Date.now) {
    if (!db) return
    try {
      const d = dayKey(now())
      for (const r of db.all<Day & { tin: number; tout: number }>('select day, provider as id, requests, tin, tout, errors, bg, last from usage where day = ?', d) as unknown as (Day & { id: string })[]) this.days.set(r.id, r)
      for (const r of db.all<{ provider: string; used: number; lim: number; reset_at: number; source: string }>('select provider, used, lim, reset_at, source from quota where win = ?', 'rpd')) {
        if (r.reset_at > now() && r.source !== 'learned') this.out.set(r.provider, { until: r.reset_at, why: r.source, probeAt: 0 })
        if (r.lim > 0) this.learned.set(r.provider, r.lim)
      }
    } catch { /* an empty ledger is fine */ }
  }

  private d(id: string): Day {
    const k = dayKey(this.now())
    let x = this.days.get(id)
    if (!x || x.day !== k) { x = { day: k, requests: 0, tin: 0, tout: 0, errors: 0, bg: 0 }; this.days.set(id, x) }
    return x
  }

  /** limits we know for this provider: its configured ones, OpenRouter's published free-model rate, or what a 429 taught us */
  limits(c: ProviderConfig): { rpd: number; rpm: number } {
    const free = /openrouter/i.test(c.baseUrl) && /:free$/i.test(c.model)
    const own = c.rpm && c.rpm > 0 ? c.rpm : free ? 20 : 0
    const learnt = this.learnedRpm.get(c.id) ?? 0
    return { rpd: c.dailyLimit > 0 ? c.dailyLimit : (this.learned.get(c.id) ?? 0), rpm: own && learnt ? Math.min(own, learnt) : own || learnt }
  }

  /** the provider's error text named a per-minute limit: remember it (it can only get tighter, never looser) */
  learnRpm(id: string, n: number) {
    if (!(n >= 1 && n < 10_000)) return
    const old = this.learnedRpm.get(id)
    if (old === undefined || n < old) this.learnedRpm.set(id, Math.floor(n))
  }

  exhaustedUntil(id: string): number | null {
    const e = this.out.get(id)
    if (!e) return null
    if (e.until <= this.now()) { this.out.delete(id); return null }
    return e.until
  }
  /** an exhausted daily quota is half-open: once per 15 minutes one request may find out whether it came back early */
  probeDue(id: string): boolean {
    const e = this.out.get(id)
    return !!e && this.exhaustedUntil(id) !== null && this.now() - e.probeAt >= PROBE_EVERY_MS
  }
  /** when the next early probe of an exhausted quota is allowed */
  probeIn(id: string): number { const e = this.out.get(id); return e ? Math.min(e.until, e.probeAt + PROBE_EVERY_MS) : 0 }
  markProbe(id: string) { const e = this.out.get(id); if (e) e.probeAt = this.now() }
  /** the provider answered: the exhausted marker was wrong (the quota came back), clear it */
  clear(id: string) { this.out.delete(id); if (this.db) try { this.db.run('delete from quota where provider = ? and win = ? and source != ?', id, 'rpd', 'learned') } catch { /* in-memory only */ } }

  /** how close the provider is to its known limits, 0..1+ (>= 0.8 ranks it lower before the 429 arrives). `inflight` = requests being served right now. */
  pressure(c: ProviderConfig, inflight = 0): number {
    const { rpd, rpm } = this.limits(c)
    const t = this.now()
    const recent = (this.minute.get(c.id) ?? []).filter(x => t - x < 60_000).length + inflight
    return Math.max(rpd > 0 ? this.d(c.id).requests / rpd : 0, rpm > 0 ? recent / rpm : 0)
  }

  /** may a call go to this provider now? `background` calls are held to their share of the budget; a user-initiated call is never held back by that share. */
  canUse(c: ProviderConfig, background: boolean, opts: { inflight?: number } = {}): { ok: boolean; why?: string; until?: number } {
    const { rpd, rpm } = this.limits(c)
    const day = this.d(c.id)
    const t = this.now()
    const recentAll = (this.minute.get(c.id) ?? []).filter(x => t - x < 60_000)
    this.minute.set(c.id, recentAll)
    const recent = recentAll.length + (opts.inflight ?? 0)
    const nextMinute = recentAll.length ? Math.min(...recentAll) + 60_000 : t + 60_000
    if (c.dailyLimit > 0 && day.requests >= c.dailyLimit) return { ok: false, why: 'daily limit reached', until: nextLocalMidnight(t) }
    if (rpm > 0 && recent >= rpm) return { ok: false, why: 'minute limit reached', until: nextMinute }
    if (background) {
      if (rpd > 0 && day.bg >= Math.floor(rpd * BG_SHARE)) return { ok: false, why: 'background share used', until: nextLocalMidnight(t) }
      if (rpm > 0 && recent >= Math.floor(rpm * BG_RPM_SHARE)) return { ok: false, why: 'no headroom this minute', until: nextMinute }
    }
    return { ok: true }
  }

  record(id: string, u: Usage | undefined, background: boolean, failed = false) {
    const x = this.d(id)
    x.requests++
    if (background) x.bg++
    if (failed) x.errors++
    else if (u) { x.tin += u.in; x.tout += u.out }
    x.last = new Date(this.now()).toISOString()
    const m = this.minute.get(id) ?? []; m.push(this.now()); this.minute.set(id, m)
    this.dirty.add(id); this.save()
  }

  /** the provider said its daily quota is gone: skip it until `until`, and remember how many requests that took */
  exhaust(id: string, until: number, why = 'daily quota') {
    this.out.set(id, { until, why, probeAt: this.now() })
    const n = this.d(id).requests
    if (n >= 5) this.learned.set(id, n)
    if (this.db) try {
      this.db.run('insert into quota(provider, model, win, used, lim, reset_at, source) values(?, ?, ?, ?, ?, ?, ?) on conflict(provider, model, win) do update set used = excluded.used, lim = excluded.lim, reset_at = excluded.reset_at, source = excluded.source', id, '*', 'rpd', n, this.learned.get(id) ?? 0, until, why)
    } catch { /* the in-memory marker still works */ }
  }

  usage(): Record<string, ProviderUsage> {
    const o: Record<string, ProviderUsage> = {}
    const k = dayKey(this.now())
    for (const [id, x] of this.days) if (x.day === k) o[id] = { requests: x.requests, in: x.tin, out: x.tout, errors: x.errors, last: x.last }
    return o
  }
  backgroundUsed(id: string) { return this.d(id).bg }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.db) return
    try {
      for (const id of this.dirty) { const x = this.d(id); this.db.run('insert into usage(day, provider, requests, tin, tout, errors, bg, last) values(?, ?, ?, ?, ?, ?, ?, ?) on conflict(day, provider) do update set requests = excluded.requests, tin = excluded.tin, tout = excluded.tout, errors = excluded.errors, bg = excluded.bg, last = excluded.last', x.day, id, x.requests, x.tin, x.tout, x.errors, x.bg, x.last ?? null) }
      this.dirty.clear()
    } catch { /* the meter is a convenience */ }
  }
  private save() { if (!this.db || this.timer) return; this.timer = setTimeout(() => this.flush(), 1500); this.timer.unref?.() }
}
