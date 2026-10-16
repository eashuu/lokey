import type { Db } from './db'

// Per-model health (round-9 plan 3.3): a circuit breaker so a dead provider is not asked again and again, and demerits so a
// model that keeps producing bad tool calls sinks below its healthier neighbours. Both persist, so a restart does not forget.
const COOLDOWNS = [30_000, 60_000, 120_000, 300_000, 900_000]   // grows with each trip
const HALF_LIFE_MS = 24 * 3_600_000
const WINDOW = 20

interface Rec {
  results: boolean[]            // last WINDOW outcomes, true = ok
  consecutive: number
  trips: number
  openUntil: number             // breaker open until
  coolUntil: number             // rate-limit cooldown (not a breaker trip)
  coolAt: number                // when that cooldown began
  coolGuess: boolean            // the cooldown length was our guess (no Retry-After): re-probed early
  trial: boolean                // a half-open trial is in flight
  ewmaMs: number
  demerits: { pts: number; at: number; why: string }[]
  note: string
}
/** a guessed cooldown may be tested again after this long with one cheap request */
export const EARLY_PROBE_MS = 15_000
const fresh = (): Rec => ({ results: [], consecutive: 0, trips: 0, openUntil: 0, coolUntil: 0, coolAt: 0, coolGuess: false, trial: false, ewmaMs: 0, demerits: [], note: '' })

export type Breaker = 'closed' | 'open' | 'half'
/** demerits at which a model drops below healthy neighbours / is rested from main and ground for a day */
export const SINK_AT = 5, REST_AT = 10

export class Health {
  private m = new Map<string, Rec>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = new Set<string>()

  constructor(private db: Db | null, private now: () => number = Date.now) {
    if (!db) return
    try { for (const r of db.all<{ provider: string; json: string }>('select provider, json from health')) { const x = { ...fresh(), ...JSON.parse(r.json) } as Rec; x.trial = false; this.m.set(r.provider, x) } } catch { /* start clean */ }
  }

  private r(id: string) { let x = this.m.get(id); if (!x) { x = fresh(); this.m.set(id, x) } return x }

  state(id: string): Breaker {
    const x = this.r(id), t = this.now()
    if (x.openUntil > t) return 'open'
    return x.openUntil > 0 ? 'half' : 'closed'
  }

  /** may a request go to this model now? A half-open breaker lets exactly one trial through. */
  allow(id: string): boolean {
    const x = this.r(id), t = this.now()
    // a cooldown we only guessed at is tested early: one trial request gets through after EARLY_PROBE_MS
    if (x.coolUntil > t && !(x.coolGuess && t - x.coolAt >= EARLY_PROBE_MS && !x.trial)) return false
    const s = this.state(id)
    if (s === 'closed') return true
    if (s === 'open') return false
    return !x.trial
  }
  /** call right before sending (marks the half-open trial as taken) */
  begin(id: string) { const x = this.r(id); if (this.state(id) === 'half' || (x.coolUntil > this.now() && x.coolGuess)) x.trial = true }

  ok(id: string, ms: number) {
    const x = this.r(id)
    x.results.push(true); if (x.results.length > WINDOW) x.results.shift()
    x.consecutive = 0; x.trial = false
    x.coolUntil = 0; x.coolGuess = false                          // it answered, so whatever limit it had is over
    if (x.openUntil > 0) { x.openUntil = 0; x.trips = 0 }       // the half-open trial worked: closed again
    x.ewmaMs = x.ewmaMs ? x.ewmaMs * 0.8 + ms * 0.2 : ms
    x.note = ''
    this.touch(id)
  }

  /** a real failure of the model or its host (not a quota, not the person's abort) */
  fail(id: string, why = '') {
    const x = this.r(id), t = this.now()
    x.results.push(false); if (x.results.length > WINDOW) x.results.shift()
    x.consecutive++
    const wasTrial = x.trial
    x.trial = false
    const errRate = x.results.filter(v => !v).length / x.results.length
    if (wasTrial || x.consecutive >= 3 || (x.results.length >= 6 && errRate > 0.5)) {
      x.trips++
      x.openUntil = t + COOLDOWNS[Math.min(x.trips - 1, COOLDOWNS.length - 1)]
      x.consecutive = 0
      x.note = why || 'kept failing'
    }
    this.touch(id)
  }

  /** a rate limit: rest it for a while, without counting it against the breaker */
  cool(id: string, ms: number, guess = false) { const x = this.r(id); x.coolUntil = this.now() + Math.max(1000, ms); x.coolAt = this.now(); x.coolGuess = guess; x.trial = false; this.touch(id) }
  /** is it cooling right now, until when, and was that length only our guess */
  coolInfo(id: string): { until: number; guess: boolean } | null { const x = this.r(id); return x.coolUntil > this.now() ? { until: x.coolUntil, guess: x.coolGuess } : null }
  /** forget a rest after the person fixed something (a new key, a Test that worked) */
  reset(id: string) { const x = this.r(id); x.coolUntil = 0; x.coolGuess = false; x.openUntil = 0; x.trips = 0; x.consecutive = 0; x.trial = false; this.touch(id) }

  penalize(id: string, pts: number, why: string) {
    if (pts <= 0) return
    const x = this.r(id)
    x.demerits.push({ pts, at: this.now(), why })
    x.demerits = x.demerits.filter(d => this.decayed(d) > 0.05).slice(-40)
    if (this.score(id) >= REST_AT) x.note = `${why}; resting it until it recovers`
    this.touch(id)
  }
  private decayed(d: { pts: number; at: number }) { return d.pts * Math.pow(0.5, (this.now() - d.at) / HALF_LIFE_MS) }
  score(id: string): number { return Math.round(this.r(id).demerits.reduce((n, d) => n + this.decayed(d), 0) * 100) / 100 }
  /** removed from main/ground for the day (>= REST_AT active demerits) */
  rested(id: string) { return this.score(id) >= REST_AT }

  openUntil(id: string) { const x = this.r(id); return Math.max(x.openUntil, x.coolUntil) }
  info(id: string) { const x = this.r(id); return { breaker: this.state(id), restingUntil: Math.max(x.openUntil, x.coolUntil) > this.now() ? Math.max(x.openUntil, x.coolUntil) : null, demerits: this.score(id), note: x.note, ewmaMs: Math.round(x.ewmaMs) } }

  private touch(id: string) { this.dirty.add(id); if (this.db && !this.timer) { this.timer = setTimeout(() => this.flush(), 1500); this.timer.unref?.() } }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.db) return
    try { for (const id of this.dirty) this.db.run('insert into health(provider, json) values(?, ?) on conflict(provider) do update set json = excluded.json', id, JSON.stringify(this.r(id))); this.dirty.clear() } catch { /* convenience */ }
  }
}
