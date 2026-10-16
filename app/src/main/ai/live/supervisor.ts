import { EventEmitter } from 'node:events'
import { AiError, type AiKind } from '../errors'
import type { Gateway } from '../gateway'
import { classifyClose, type GeminiSession } from './session'

// The Live supervisor (round-9 plan 3.5): owns the life of the Gemini Live connection so the agent only asks for "a session".
//  - resume, then fresh: a connection is first tried with the saved resumption handle; if that is refused, or the resumed session
//    dies within FRESH_WITHIN_MS, the handle is dropped and the next connection starts fresh (the agent seeds it from the transcript)
//  - close codes are understood (classifyClose): 1011/1006 reconnect, 1007 never retries the same way, 1008 and quota texts are typed
//  - goAway: the server will close soon; the connection is replaced between turns instead of in the middle of one
//  - a silent stall (nothing from the server after a turn was sent) is detected and the session replaced
//  - every connection and session is metered through the gateway (quota ledger, traces, health under the id "live")
//  - when Live cannot be used (quota, outage, circuit open, model refused) `degraded` says so and the agent answers through the
//    text path instead of failing
export const FRESH_WITHIN_MS = 10_000
/** the server no longer knows the resumption handle we sent (expired or from another model) */
export const STALE_HANDLE = /session (was )?not found|not found or expired|session.{0,20}expired|invalid.{0,20}(handle|session|resum)/i
/** our own earlier socket is still open on the server */
export const ALREADY_CONNECTED = /already connected|existing client/i
const delay = (ms: number) => new Promise<void>(r => { const t = setTimeout(r, ms); t.unref?.() })
const HANDLE_MAX_AGE_MS = 100 * 60_000
const GOAWAY_FORCE_MARGIN_MS = 3000

type Meter = Pick<Gateway, 'liveAllowed' | 'liveBegin' | 'liveConnect' | 'liveEnd' | 'liveRest' | 'liveRetire' | 'liveForgive'>
export interface Degraded { kind: AiKind; until: number; why: string }
/** `model` is the first choice; `alts` are other Live model ids tried, in order, when it keeps failing (voice ladder rung 1, docs/AI-FAILSAFE.md section 5) */
export interface SupervisorOpts { model: () => string; alts?: () => string[]; stallMs?: number; now?: () => number }

export declare interface LiveSupervisor {
  on(e: 'closed', f: (info: { kind: AiKind | null; code: number; reason: string; recoverable: boolean; midTurn: boolean }) => void): this
  on(e: 'stalled', f: () => void): this
  /** the server asked for a fresh connection and none is needed right now: the agent may drop the old one */
  on(e: 'refresh', f: () => void): this
  on(e: 'degraded', f: (d: Degraded) => void): this
  on(e: 'recovered', f: () => void): this
}

export class LiveSupervisor extends EventEmitter {
  handle: string | null = null
  private handleAt = 0
  session: GeminiSession | null = null
  private goAwayAt = 0            // when the server said it would close (0 = no goAway pending)
  private goAwayTimer: ReturnType<typeof setTimeout> | null = null
  private stallTimer: ReturnType<typeof setTimeout> | null = null
  private turnOpen = false
  private wasDegraded = false
  /** per model id: sessions in a row that the server closed with a refusal (1007) right after they started. First the tools are left out, then the system prompt is cut, after the third that model rests for a while and the next id is used. */
  private bad = new Map<string, number>()
  private rested = new Set<string>()
  /** the model the current/next session uses */
  active = ''
  private handleModel = ''
  /** the last refusal, for the notice: code + reason */
  lastRefusal = ''

  constructor(private make: (resume?: string, model?: string) => GeminiSession, private meter: Meter, private o: SupervisorOpts) { super(); this.active = o.model() }

  private now() { return (this.o.now ?? Date.now)() }

  /** the model ids in the order they are tried: the first choice, then the alternates */
  models(): string[] { return [...new Set([this.o.model(), ...(this.o.alts?.() ?? [])].filter(Boolean))] }
  /** the first model id that may be used now */
  private pick(): string | null { return this.models().find(m => this.meter.liveAllowed(m).ok) ?? null }
  /** a model other than the first choice is in use */
  get usingAlternate() { return this.active !== this.o.model() }

  /** Live is unusable right now (with every model id), and why; or null */
  get degraded(): Degraded | null {
    const ms = this.models()
    const blocks = ms.map(m => this.meter.liveAllowed(m)).filter((a): a is Extract<typeof a, { ok: false }> => !a.ok)
    if (!blocks.length || blocks.length < ms.length) return null
    const first = [...blocks].sort((a, b) => a.until - b.until)[0]
    const refused = this.lastRefusal && ms.some(m => this.rested.has(m))
    return refused ? { kind: 'BAD_REQUEST', until: first.until, why: `Gemini Live keeps refusing the session (${this.lastRefusal})` } : { kind: first.kind, until: first.until, why: first.why }
  }
  /** after one refusal the session is set up without tools (to find out whether they are what the server dislikes) */
  get noTools() { return (this.bad.get(this.active) ?? 0) >= 1 }
  /** after a second refusal the system prompt is cut to a few lines as well; after a third, this model rests and the next id (or the text voice) takes over */
  get bare() { return (this.bad.get(this.active) ?? 0) >= 2 }
  /** the person changed the key or the model: start from the full setup again */
  resetRefusals() { this.bad.clear(); this.rested.clear(); this.lastRefusal = ''; this.handle = null; this.meter.liveForgive(this.models()); this.active = this.o.model() }
  private validHandle() { return this.handle && (!this.handleModel || this.handleModel === this.active) && this.now() - this.handleAt < HANDLE_MAX_AGE_MS ? this.handle : undefined }
  dropHandle() { this.handle = null }
  /** the server wants this connection replaced (goAway) */
  get stale() { return this.goAwayAt > 0 }

  private inflight: Promise<GeminiSession> | null = null
  /** the last socket we closed or gave up on: a new connect waits until it is really closed */
  private closing: GeminiSession | null = null

  /** a connected session: resumed from the saved handle when there is one, fresh otherwise. Throws an AiError when Live is unusable.
   *  One connect at a time (two callers share it) and never while an earlier socket of ours is still closing: the server allows one socket per session. */
  connect(): Promise<GeminiSession> {
    this.inflight ??= this.connectSerial().finally(() => { this.inflight = null })
    return this.inflight
  }
  private async connectSerial(): Promise<GeminiSession> {
    if (this.session) this.closeSession('replaced')
    const c = this.closing
    if (c) { this.closing = null; await c.whenClosed() }
    let last: AiError | null = null
    // a model that is gone, over its own quota or refused is skipped for the next id in the same call; a network or key problem is not helped by another id
    for (let tries = 0; tries < Math.max(1, this.models().length); tries++) {
      const m = this.pick()
      if (!m) break
      if (m !== this.active) { this.active = m; this.handle = null }
      try { return await this.connectWith(m) } catch (e) {
        const err = e instanceof AiError ? e : new AiError('NETWORK', e instanceof Error ? e.message : String(e))
        last = err
        if (err.kind === 'BAD_REQUEST' && /not found|not supported|unknown|is not available|invalid model|no longer/i.test(err.message)) { this.meter.liveRetire(m, err.message.slice(0, 80)); continue }
        if (err.kind === 'QUOTA_DAY' || err.kind === 'RATE_MINUTE') continue
        throw err
      }
    }
    const d = this.degraded
    if (d) { this.noteDegraded(d); throw new AiError(d.kind, d.why) }
    throw last ?? new AiError('NO_PROVIDER', 'no Live model is set up')
  }

  private async connectWith(model: string): Promise<GeminiSession> {
    this.meter.liveBegin(model)
    let resume = this.validHandle()
    let busyRetried = false, staleRetried = false
    for (;;) {
      const t0 = this.now()
      const s = this.attach(this.make(resume, model), !!resume, model)
      try { await s.connect() } catch (e) {
        const err = e instanceof AiError ? e : new AiError('NETWORK', e instanceof Error ? e.message : String(e))
        this.closing = s
        // an expired / unknown handle is not a failure: drop it and connect fresh at once (the transcript seeds the context)
        if (resume && !staleRetried && STALE_HANDLE.test(err.message)) { staleRetried = true; this.handle = null; resume = undefined; continue }
        // our own earlier socket is still open on the server: wait until it is really closed, then try once more
        if (!busyRetried && ALREADY_CONNECTED.test(err.message)) { busyRetried = true; await s.whenClosed(); await delay(400); continue }
        return this.connectFailed(model, s, resume, err, t0)
      }
      this.meter.liveConnect({ model, ms: this.now() - t0, resumed: !!resume, note: staleRetried ? 'fresh after the handle expired' : undefined })
      return this.adopt(s, model)
    }
  }

  private async connectFailed(model: string, _s: GeminiSession, resume: string | undefined, err: AiError, t0: number): Promise<GeminiSession> {
    {
      this.meter.liveConnect({ model, ms: this.now() - t0, resumed: !!resume, kind: err.kind, resetAt: err.resetAt, note: err.message.slice(0, 120) })
      // a refused handle (expired, rejected) is not a reason to give up: one fresh try, the transcript seeds the context instead
      if (!resume || err.kind === 'AUTH' || err.kind === 'RATE_MINUTE' || err.kind === 'QUOTA_DAY') throw err
      this.handle = null
      const t1 = this.now()
      const s = this.attach(this.make(undefined, model), false, model)
      try { await s.connect() } catch (e2) {
        const err2 = e2 instanceof AiError ? e2 : new AiError('NETWORK', e2 instanceof Error ? e2.message : String(e2))
        this.meter.liveConnect({ model, ms: this.now() - t1, resumed: false, kind: err2.kind, resetAt: err2.resetAt, note: err2.message.slice(0, 120) })
        throw err2
      }
      this.meter.liveConnect({ model, ms: this.now() - t1, resumed: false, note: 'fresh after the handle was refused' })
      return this.adopt(s, model)
    }
  }

  private adopt(s: GeminiSession, model: string) {
    this.session = s
    this.active = model
    this.goAwayAt = 0
    if (this.wasDegraded) { this.wasDegraded = false; this.emit('recovered') }
    return s
  }

  private noteDegraded(d: Degraded) { if (!this.wasDegraded) { this.wasDegraded = true; this.emit('degraded', d) } }

  private attach(s: GeminiSession, resumed: boolean, model: string): GeminiSession {
    const startedAt = this.now()
    s.on('handle', h => { this.handle = h; this.handleAt = this.now(); this.handleModel = model })
    s.on('rx', () => { if (this.stallTimer) this.armStall() })
    s.on('goAway', ms => {
      this.goAwayAt = this.now()
      if (this.goAwayTimer) clearTimeout(this.goAwayTimer)
      // if no turn is open, replace the connection now; otherwise when the turn ends, or just before the server cuts it
      if (!this.turnOpen) this.emit('refresh')
      else {
        this.goAwayTimer = setTimeout(() => this.emit('refresh'), Math.max(500, (ms || 30_000) - GOAWAY_FORCE_MARGIN_MS))
        this.goAwayTimer.unref?.()
      }
    })
    s.on('closed', (reason, code, kind0) => {
      let kind = kind0
      const up = this.now() - startedAt
      this.clearStall()
      const stale = resumed && STALE_HANDLE.test(reason)
      const c = stale ? { kind: null, recoverable: true } : classifyClose(code, reason)
      if (stale) kind = null
      // a resumed session that died at once poisons the handle
      if (resumed && up < FRESH_WITHIN_MS && c.kind) this.handle = null
      if (c.kind === 'BAD_REQUEST') this.handle = null
      if (this.session === s) this.session = null
      const refusal = (kind ?? c.kind) === 'BAD_REQUEST'
      const early = this.now() - (s.openedAt || startedAt) < 8000
      if (refusal && early) {
        const n = (this.bad.get(model) ?? 0) + 1
        this.bad.set(model, n); this.lastRefusal = `${code}: ${reason.slice(0, 80) || 'no reason given'}`
        if (n >= 3) { this.meter.liveRest(model, 10 * 60_000, this.lastRefusal); this.rested.add(model); this.bad.delete(model) }   // the next id (or the text voice) takes over
      } else if (!refusal && this.now() - (s.openedAt || startedAt) >= 8000) this.bad.delete(model)
      this.meter.liveEnd({ model, ms: up, audioInSec: s.audioInSec, audioOutSec: s.audioOutSec, kind: kind ?? c.kind, code, note: `${reason.slice(0, 120)} | ${s.diagnostics()}` })
      const midTurn = this.turnOpen
      this.turnOpen = false
      this.emit('closed', { kind: kind ?? c.kind, code, reason, recoverable: c.recoverable, midTurn })
      if (this.degraded) this.noteDegraded(this.degraded as Degraded)
    })
    return s
  }

  /** the agent closed the session itself (idle, mode change): meter it as a normal end */
  closeSession(why = 'idle') {
    const s = this.session
    this.session = null
    this.clearStall()
    if (!s) return
    s.removeAllListeners('closed')
    this.meter.liveEnd({ model: this.active, ms: this.now() - (s.openedAt || this.now()), audioInSec: s.audioInSec, audioOutSec: s.audioOutSec, note: why })
    this.closing = s
    s.close(why)
  }

  // ---- turns and stalls ---------------------------------------------------------------------------------------------------------
  /** a turn was sent to the model: from here on it must show signs of life */
  turnSent() { this.turnOpen = true; this.armStall() }
  /** the turn ended; if the server asked for a new connection meanwhile, now is the time */
  turnEnded() {
    this.turnOpen = false
    this.clearStall()
    if (this.goAwayTimer) { clearTimeout(this.goAwayTimer); this.goAwayTimer = null }
    if (this.goAwayAt) this.emit('refresh')
  }
  private armStall() {
    this.clearStall(false)
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null
      if (!this.turnOpen) return
      this.emit('stalled')
    }, this.o.stallMs ?? 15_000)
    this.stallTimer.unref?.()
  }
  private clearStall(close = true) { if (this.stallTimer) { clearTimeout(this.stallTimer); this.stallTimer = null } void close }
  /** a stalled session is dropped and counted as a failure of the "live" provider */
  replaceStalled() {
    const s = this.session
    this.session = null
    this.turnOpen = false
    if (s && this.now() - (s.openedAt || 0) < FRESH_WITHIN_MS) this.handle = null   // a young session that went quiet: do not resume into it again
    if (s) {
      s.removeAllListeners('closed')
      this.meter.liveEnd({ model: this.active, ms: this.now() - (s.openedAt || this.now()), audioInSec: s.audioInSec, audioOutSec: s.audioOutSec, kind: 'OVERLOADED', note: 'no reply: the session stalled' })
      this.closing = s
      s.close('stalled')
    }
  }

  dispose() { this.clearStall(); if (this.goAwayTimer) clearTimeout(this.goAwayTimer); this.closeSession('shutdown') }
}

