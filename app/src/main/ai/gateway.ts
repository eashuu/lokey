import type { BrainRole, BrainStatus, ModelPreset, ProviderConfig, TraceRow } from '@shared/bridge'
import { settings } from '../settings'
import { defaultSettings } from '@shared/bridge'
import { getSecret } from '../agent/keystore'
import type { ChatRequest, ChatResponse, LlmProvider, Usage } from '../brain/types'
import { GeminiProvider } from './adapters/gemini'
import { OpenAiProvider } from './adapters/openai'
import { listLiveModels } from './adapters/gemini'
import { capsOf, hostOf, isRouter, keysOf, MAX_ATTEMPTS, MAX_CANDIDATES, meets, needOf, roughTokens, ROLE_DEADLINE_MS, ROLE_FALLBACK, ROUTER_DEADLINE_MS, type Need } from './catalog'
import { getDb, type Db } from './db'
import { AiError, classifyThrown, dailyReset, isWait, SETTINGS_WHERE, shortWhy, userMessage, type AiKind, type Failure } from './errors'
import { Health, SINK_AT } from './health'
import { QuotaLedger, type ProviderUsage } from './quota'
import { Tracer, type TraceFilter } from './trace'
import { parseJsonAnswer, validate as checkSchema, type Schema } from './runtime/schema'

// THE gateway: the one entry point for every model call Lokey makes (dictation, summaries, embeddings, search, the agent loop,
// learning, the screen operator). A call names a ROLE and what the request needs (tools, pictures, audio...); the gateway builds a CHAIN of every
// model that can do that (the ticked ones first, then any other capable one), tries them in order of health, and on a failure does what the
// error KIND says (errors.ts): wait, retry once, repair, or move to the next. Models that are resting, cooling, over quota or whose key was
// rejected are not dropped: they form a last-resort TAIL tried once each, soonest-back first, so a request is never refused while some model
// might still answer. If nothing answers, the error that comes out says WHEN to try again (`until`): callers wait or park instead of failing
// (docs/AI-FAILSAFE.md). Every attempt leaves a trace row (trace.ts). Nothing else in the app talks to a model provider (scripts/check-gateway.mjs).
export interface CallOpts {
  /** learning, summaries, consolidation: may only use the background share of the free budget */
  background?: boolean
  signal?: AbortSignal
  /** what this call is, for the trace ('chat' by default) */
  op?: string
  /** one attempt's time limit; the role's default otherwise */
  deadlineMs?: number
  /** the whole call's wall-clock budget (all attempts); twice the attempt limit (at least 30 s) by default */
  totalMs?: number
  /** an empty answer is a valid answer (transcribing silence) */
  allowEmpty?: boolean
}

export interface GatewayOpts {
  db?: Db | null
  build?: (c: ProviderConfig, key: () => string | null) => LlmProvider
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  rand?: () => number
  log?: (m: string) => void
  /** is the internet reachable? (default: a tiny request to a connectivity-check address). Tests pass their own. */
  probe?: () => Promise<boolean>
  /** the admission gate (plan 3.11): when on, a model that is not stock must be listed in `admitted` (`id|model|role`) before it serves main or ground */
  admission?: () => boolean
  admitted?: () => string[]
  /** the ordering preset and the offline-local switch (settings by default) */
  preset?: () => ModelPreset
  offlineLocal?: () => boolean
}

/** a line the person should see once per episode (not once per attempt) */
export interface Notice { id: string; kind: 'fallback' | 'auth' | 'info'; text: string }

interface Ctx { boost: number; temp?: number; hint: string; /** text that arrived before a stream dropped: the next model continues from it */ prefix: string }
type Verdict = { act: 'retry'; wait: number } | { act: 'next' } | { act: 'key' } | { act: 'stop' }
interface Cand { c: ProviderConfig; keys: string[]; tail: boolean; /** epoch ms it is expected to be usable (tail only) */ back: number }
interface Blocked { c: ProviderConfig; kind: AiKind; until: number }
interface Plan { list: Cand[]; head: Cand[]; tail: Cand[]; blocked: Blocked[]; /** providers able to serve the request at all */ configured: number }
export type KeyState = { ref: string; state: 'ok' | 'resting' | 'rejected' | 'limit'; until?: number; note?: string }

export const WEB_TOOLS = new Set(['web_fetch', 'web_research', 'web_search', 'download_file'])
const keyPrint = (k: string | null) => (k ? `${k.length}:${k.slice(-4)}` : '')
const BAD_TOOL_PTS = 1, INVENTED_TOOL_PTS = 2
const PROBE_TTL_MS = 10 * 60_000        // a failed tool-call probe is forgotten after this long (or on the next Test)
const REPROBE_MS = 15 * 60_000          // a rejected key / a spent day is tried once in a while anyway
const WAIT_IN_GATEWAY_MS = 20_000       // an interactive call waits this long for the only usable model before giving up
const NOTICE_TTL_MS = 10 * 60_000
const CONTINUE = 'Your last answer was cut off by a connection problem after the text above. Continue exactly from where it stopped, without repeating anything and without any preamble.'

/** the part of a half-written answer that is safe to continue from (the last word may be cut in the middle: it is dropped) */
export function resumePrefix(partial: string): string {
  const p = partial.replace(/\s+$/, m => m)
  if (p.length < 20) return ''
  if (/[\s.!?,;:)\]"'’”]$/.test(p)) return p
  const i = p.search(/\s\S*$/)
  return i > 10 ? p.slice(0, i) : ''
}
/** the continuation glued to the text that was already there */
export const joinResumed = (prefix: string, cont: string) => (!prefix ? cont : !cont ? prefix : /\s$/.test(prefix) || /^[\s.,;:!?)\]]/.test(cont) ? prefix + cont : prefix + ' ' + cont)

export class Gateway {
  private opts: GatewayOpts
  private _p?: { db: Db | null; quota: QuotaLedger; health: Health; tracer: Tracer }
  private built = new Map<string, { sig: string; p: LlmProvider }>()
  private authOff = new Map<string, { fp: string; at: number }>()   // `${provider}|${key ref}` -> the key fingerprint it was rejected with, and when
  private probes = new Map<string, { ok: boolean; at: number }>()    // provider id -> passed the tool-call probe
  private inflight = new Map<string, number>()                       // provider id -> requests being served right now
  private offline = false
  private offlineCbs: ((off: boolean) => void)[] = []
  private noticeCbs: ((n: Notice) => void)[] = []
  private changeCbs: (() => void)[] = []
  private noticed = new Map<string, number>()
  private liveSeen = new Set<string>()
  private recover: ReturnType<typeof setInterval> | null = null
  private logger: (m: string) => void = () => undefined

  /** `cfg` and `key` are functions so tests can stand in for settings and the key store. `o === false` = no database (old call style). */
  constructor(private cfg: () => ProviderConfig[] = () => settings.value.brain.providers, private key: (ref: string) => string | null = getSecret, o: GatewayOpts | boolean = {}) {
    this.opts = typeof o === 'boolean' ? { db: null } : o
    if (this.opts.log) this.logger = this.opts.log
  }

  setLogger(f: (m: string) => void) { this.logger = f }
  private now() { return (this.opts.now ?? Date.now)() }
  private sleep(ms: number) { return (this.opts.sleep ?? ((n: number) => new Promise<void>(r => setTimeout(r, n))))(ms) }
  private rand() { return (this.opts.rand ?? Math.random)() }
  private preset(): ModelPreset { return this.opts.preset?.() ?? settings.value.brain.preset ?? 'quality' }
  private offlineLocal() { return this.opts.offlineLocal?.() ?? settings.value.brain.offlineLocal !== false }

  private get p() {
    if (!this._p) {
      const db = this.opts.db !== undefined ? this.opts.db : getDb()
      const now = () => this.now()
      this._p = { db, quota: new QuotaLedger(db, now), health: new Health(db, now), tracer: new Tracer(db, now) }
    }
    return this._p
  }
  get quota() { return this.p.quota }
  get health() { return this.p.health }
  get tracer() { return this.p.tracer }

  // ---- listeners: notices (once per episode), state changes (the Models page) --------------------------------------------------------
  onNotice(cb: (n: Notice) => void) { this.noticeCbs.push(cb); return () => { this.noticeCbs = this.noticeCbs.filter(x => x !== cb) } }
  onChange(cb: () => void) { this.changeCbs.push(cb); return () => { this.changeCbs = this.changeCbs.filter(x => x !== cb) } }
  emitChange() { for (const cb of this.changeCbs) { try { cb() } catch { /* a listener must not break the gateway */ } } }
  private notify(n: Notice) {
    const t = this.now(), last = this.noticed.get(n.id)
    if (last !== undefined && t - last < (n.kind === 'auth' ? 30 * 60_000 : NOTICE_TTL_MS)) return
    this.noticed.set(n.id, t)
    if (this.noticed.size > 100) for (const [k, v] of this.noticed) if (t - v > 3_600_000) this.noticed.delete(k)
    for (const cb of this.noticeCbs) { try { cb(n) } catch { /* ignore */ } }
  }

  // ---- providers and their keys -----------------------------------------------------------------------------------------------------
  /** the provider for one key of a config (each key has its own client, so two requests can use two keys at once) */
  private build(c: ProviderConfig, ref: string): LlmProvider {
    const sig = JSON.stringify([c.kind, c.baseUrl, c.model])
    const id = `${c.id}|${ref}`
    const hit = this.built.get(id)
    if (hit && hit.sig === sig) return hit.p
    const key = () => this.key(ref)
    const p = this.opts.build ? this.opts.build(c, key) : c.kind === 'gemini' ? new GeminiProvider(c.id, c.name, c.model, key) : new OpenAiProvider(c.id, c.name, c.model, c.baseUrl, key)
    this.built.set(id, { sig, p })
    return p
  }
  /** the keys that can be used: those with a saved secret (a keyless endpoint such as Ollama uses its first ref) */
  private refsOf(c: ProviderConfig): string[] {
    const have = keysOf(c).filter(r => this.key(r))
    return have.length ? have : c.kind === 'gemini' ? [] : [keysOf(c)[0]]
  }
  private multi(c: ProviderConfig) { return keysOf(c).length > 1 }
  /** health / cooldown id of one key: the provider's own id when it has a single key */
  private kid(c: ProviderConfig, ref: string) { return this.multi(c) ? `${c.id}@${ref}` : c.id }
  /** quota id: chat has its own pool, speech-to-text, search and embeddings have theirs (Flash's chat quota must not block its transcribing); a shared pool for providers that share one */
  private qid(c: ProviderConfig, role: BrainRole, ref: string) {
    const pool = c.kind === 'openai' && /openrouter\.ai/i.test(c.baseUrl) && /:free$/i.test(c.model) ? 'openrouter::free' : c.id
    const sub = role === 'search' || role === 'transcribe' || role === 'embed' ? `${pool}#${role}` : pool
    return this.multi(c) ? `${sub}@${ref}` : sub
  }
  private ready(c: ProviderConfig): boolean {
    if (!c.enabled || !c.model.trim()) return false
    if (c.kind === 'gemini' && !this.refsOf(c).length) return false
    if (c.kind === 'openai' && !c.baseUrl.trim()) return false
    return true
  }
  private authId(c: ProviderConfig, ref: string) { return `${c.id}|${ref}` }
  /** has this key been rejected (and is it still the same key)? */
  private authState(c: ProviderConfig, ref: string): { at: number } | null {
    const was = this.authOff.get(this.authId(c, ref))
    if (!was) return null
    if (was.fp !== keyPrint(this.key(ref))) { this.authOff.delete(this.authId(c, ref)); return null }
    return was
  }
  /** every key of this provider was rejected */
  private authBlocked(c: ProviderConfig): boolean { const r = this.refsOf(c); return r.length > 0 && r.every(x => !!this.authState(c, x)) }

  /** why one key cannot be used right now (null = it can) */
  private keyBlock(c: ProviderConfig, ref: string, role: BrainRole): { kind: 'auth' | 'quota' | 'cool'; until: number; probe: boolean } | null {
    const t = this.now()
    const a = this.authState(c, ref)
    if (a) return { kind: 'auth', until: a.at + REPROBE_MS, probe: t - a.at >= REPROBE_MS }
    const q = this.qid(c, role, ref)
    const u = this.p.quota.exhaustedUntil(q)
    if (u) return { kind: 'quota', until: this.p.quota.probeIn(q), probe: this.p.quota.probeDue(q) }
    if (this.multi(c)) {
      const kid = this.kid(c, ref), ci = this.p.health.coolInfo(kid)
      if (ci && !this.p.health.allow(kid)) return { kind: 'cool', until: ci.until, probe: false }
    }
    return null
  }

  // ---- the chain ----------------------------------------------------------------------------------------------------------------------
  /** every model that can serve the request, best first, plus the last-resort tail (see the file header) */
  private plan(role: BrainRole, need: Need, background: boolean, req?: ChatRequest): Plan {
    const all = this.cfg()
    const t = this.now()
    const size = req ? roughTokens(req) : 0
    const head: (Cand & { k: number[] })[] = [], tail: Cand[] = [], blocked: Blocked[] = []
    let configured = 0
    const preset = this.preset()
    const usage = preset === 'save' ? this.p.quota.usage() : {}
    all.forEach((c, order) => {
      if (!this.ready(c)) return
      const local = this.isLocal(c)
      if (this.offline && (this.offlineLocal() ? !local : local)) return    // offline: remote models are not even tried (or, with the local switch off, local ones are not)
      if (role !== 'embed' && /embed/i.test(c.model)) return                // an embedding model cannot chat
      const caps = capsOf(c)
      if (!meets(caps, need) || size > caps.ctx * 0.9) return
      configured++
      // the person's own limits (a daily cap they set, the minute window) are not for breaking, not even as a last resort
      const lim = this.p.quota.canUse(c, background, { inflight: this.inflight.get(c.id) ?? 0 })
      if (!lim.ok) { blocked.push({ c, kind: /daily|share/.test(lim.why ?? '') ? 'QUOTA_DAY' : 'RATE_MINUTE', until: lim.until ?? t + 60_000 }); return }
      const soft: number[] = []
      const mainish = role === 'main' || role === 'ground'
      const pr = this.probes.get(c.id)
      if (mainish && pr && !pr.ok) { if (t - pr.at >= PROBE_TTL_MS) this.probes.delete(c.id); else soft.push(pr.at + PROBE_TTL_MS) }
      if (mainish && this.p.health.rested(c.id)) soft.push(t + 30 * 60_000)
      if (!this.p.health.allow(c.id)) soft.push(this.p.health.openUntil(c.id))
      const usable: string[] = [], kb: { ref: string; kind: 'auth' | 'quota' | 'cool'; until: number; probe: boolean }[] = []
      for (const ref of this.refsOf(c)) { const b = this.keyBlock(c, ref, role); if (b) kb.push({ ref, ...b }); else usable.push(ref) }
      if (!soft.length && usable.length) {
        const h = this.p.health
        const press = this.p.quota.pressure(c, this.inflight.get(c.id) ?? 0) >= 0.8 ? 1 : 0     // close to its known limits: rank lower before the 429 arrives
        const group = Math.max(0, ROLE_FALLBACK[role].findIndex(r => c.roles.includes(r)))
        const ticked = ROLE_FALLBACK[role].some(r => c.roles.includes(r)) ? 0 : 1
        const pk = preset === 'fast' ? Math.round((h.info(c.id).ewmaMs || 4000) / 250) : preset === 'save' ? Math.floor((usage[c.id]?.requests ?? 0) / 5) : 0
        head.push({ c, keys: this.orderKeys(c, usable), tail: false, back: 0, k: [h.score(c.id) >= SINK_AT ? 1 : 0, this.isAdmitted(c, role) ? 0 : 1, press, ticked, group, pk, order] })
        return
      }
      // known dead (rejected key, spent day) and not due for a re-check: not even a last resort
      const keysDead = !usable.length
      if (!soft.length && kb.length && kb.every(b => (b.kind === 'auth' || b.kind === 'quota') && !b.probe)) {
        blocked.push({ c, kind: kb.every(b => b.kind === 'auth') ? 'AUTH' : 'QUOTA_DAY', until: Math.min(...kb.map(b => b.until)) })
        return
      }
      const back = Math.max(t, ...soft, keysDead ? Math.min(...kb.map(b => b.until)) : 0)
      const keys = usable.length ? this.orderKeys(c, usable) : [...kb].sort((a, b) => Number(b.probe) - Number(a.probe) || a.until - b.until).map(b => b.ref)
      tail.push({ c, keys, tail: true, back: kb.some(b => b.kind === 'auth') && keysDead ? back + 3_600_000 : back })
    })
    head.sort((a, b) => { for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i]; return 0 })
    tail.sort((a, b) => a.back - b.back)
    const headTake = Math.min(head.length, tail.length ? MAX_CANDIDATES - 1 : MAX_CANDIDATES)     // one slot is kept for the tail
    const tailTake = Math.min(tail.length, MAX_CANDIDATES - headTake)
    return { list: [...head.slice(0, headTake), ...tail.slice(0, tailTake)], head, tail, blocked, configured }
  }
  /** keys of one provider: the least used today first (a cooling key is already left out) */
  private orderKeys(c: ProviderConfig, refs: string[]): string[] {
    if (refs.length < 2) return refs
    const u = this.p.quota.usage()
    return [...refs].sort((a, b) => (u[this.kid(c, a)]?.requests ?? 0) - (u[this.kid(c, b)]?.requests ?? 0))
  }

  // ---- offline mode: when the internet is unreachable only local models (Ollama and other localhost endpoints) are used, web tools are hidden,
  // and the gateway checks every 30 s whether the network is back ---------------------------------------------------------------------
  /** runs on this PC or LAN. A local ROUTER (FreeLLMAPI) forwards to the internet, so it is not local unless the person marked it. */
  isLocal(c: ProviderConfig): boolean {
    if (c.local !== undefined) return c.local
    return c.kind === 'openai' && !isRouter(c) && /^(https?:\/\/)?(localhost|127\.|\[::1\]|192\.168\.|10\.)/i.test(c.baseUrl.trim())
  }
  isOffline() { return this.offline }
  onOffline(cb: (off: boolean) => void) { this.offlineCbs.push(cb); return () => { this.offlineCbs = this.offlineCbs.filter(x => x !== cb) } }
  private setOffline(v: boolean) {
    if (this.offline === v) return
    this.offline = v
    this.logger(`ai ${v ? 'went offline: using local models only' : 'is back online'}`)
    for (const cb of this.offlineCbs) { try { cb(v) } catch { /* a listener must not break the gateway */ } }
    this.emitChange()
    if (v && !this.recover && !this.opts.probe) { this.recover = setInterval(() => void this.checkOnline(), 30_000); this.recover.unref?.() }
    if (!v && this.recover) { clearInterval(this.recover); this.recover = null }
  }
  /** is the internet reachable now? Coming back online switches the remote models on again. */
  async checkOnline(): Promise<boolean> {
    let ok = false
    try { ok = await (this.opts.probe ? this.opts.probe() : fetch('https://www.gstatic.com/generate_204', { signal: AbortSignal.timeout(4000) }).then(r => r.status === 204 || r.ok)) } catch { ok = false }
    if (ok) this.setOffline(false)
    return ok
  }
  /** tools that need the internet are not offered while offline */
  visibleTools<T extends { name: string }>(decls: T[]): T[] { return this.offline ? decls.filter(t => !WEB_TOOLS.has(t.name)) : decls }

  /** has this model earned the main / screen role? Stock models are trusted; others have to pass the eval set (brain/roleEval.ts) once. */
  isAdmitted(c: ProviderConfig, role: BrainRole): boolean {
    if (!(this.opts.admission?.() ?? false) || (role !== 'main' && role !== 'ground')) return true
    if (c.model.trim() && defaultSettings.brain.providers.some(p => p.id === c.id && p.model === c.model)) return true
    return (this.opts.admitted?.() ?? []).includes(`${c.id}|${c.model}|${role}`)
  }
  /** the configured, ready providers for a role in the person's order, with no quota, health or admission filtering (what the eval scores) */
  candidatesRaw(role: BrainRole): ProviderConfig[] {
    const out: ProviderConfig[] = []
    for (const r of ROLE_FALLBACK[role]) for (const c of this.cfg()) if (c.roles.includes(r) && this.ready(c) && !out.includes(c)) out.push(c)
    return out
  }

  /** why a configured provider cannot be used at all right now, in words ('' = it can) */
  whyNot(c: ProviderConfig): string {
    if (!c.enabled) return 'switched off'
    if (!c.model.trim()) return 'no model name (type one in Settings > Brain; Test lists what the server offers)'
    if (c.kind === 'gemini' && !this.refsOf(c).length) return 'no key saved'
    if (c.kind === 'openai' && !c.baseUrl.trim()) return 'no address'
    return ''
  }
  private noCandidate(role: BrainRole, op: string, plan: Plan): never {
    const t = this.now()
    let err: AiError
    const b = plan.blocked
    if (this.offline && !plan.configured) err = new AiError('NETWORK', `You are offline and no local model is set up for "${role}". Add Ollama (or another local endpoint) in ${SETTINGS_WHERE}.`, 0, { until: t + 30_000 })
    else if (b.length) {
      const until = Math.min(...b.map(x => x.until))
      const auth = b.every(x => x.kind === 'AUTH')
      const day = b.some(x => x.kind === 'QUOTA_DAY')
      err = auth ? new AiError('AUTH', userMessage(new AiError('AUTH', ''), b[0].c.name), 0, { until }) : day ? new AiError('QUOTA_DAY', userMessage(new AiError('QUOTA_DAY', '', 0, { resetAt: until }), b.length > 1 ? 'The free tier' : b[0].c.name), 429, { resetAt: until, until }) : new AiError('RATE_MINUTE', 'The models are busy for a moment.', 429, { retryAfterMs: Math.max(0, until - t), until })
    } else {
      const reasons = this.cfg().map(c => ({ c, why: this.whyNot(c) })).filter(x => x.why).map(x => `${x.c.name}: ${x.why}`)
      err = plan.configured
        ? new AiError('NO_PROVIDER', `No model can take this "${role}" request (it needs an ability none of them has). See ${SETTINGS_WHERE}.`)
        : new AiError('NO_PROVIDER', `No model is set up for "${role}". Add a Gemini key or enable a provider in ${SETTINGS_WHERE}.${reasons.length ? ` (${reasons.join('; ')})` : ''}`)
    }
    if (b.length) err.failures = this.failuresOf([], b)
    this.p.tracer.record({ op, role, provider: '-', model: '-', ok: false, kind: err.kind, attempt: 0, ms: 0, note: err.message })
    this.logger(`ai ${op} could not start: ${err.kind} role=${role} ${err.message}`)
    this.emitChange()
    throw err
  }

  /** providers that can serve the role right now (for tests and the settings page) */
  candidates(role: BrainRole): ProviderConfig[] { return this.plan(role, needOf(role), false).head.map(h => h.c) }

  // ---- the engine -------------------------------------------------------------------------------------------------------------
  private verdict(err: AiError, c: ProviderConfig, ref: string, attempt: number, maxAttempts: number, ctx: Ctx, safetyHits: number, role: BrainRole, req: ChatRequest | undefined): Verdict {
    const { quota, health } = this.p
    const kid = this.kid(c, ref)
    const multi = this.multi(c)
    switch (err.kind) {
      case 'RATE_MINUTE': {
        const w = err.retryAfterMs
        const n = /(\d{1,5})\s*(?:requests?|calls|rpm)\s*(?:per|\/|a)\s*min/i.exec(err.message) ?? /limit[^.\d]{0,20}(\d{1,5})[^.]{0,40}per minute/i.exec(err.message)
        if (n) quota.learnRpm(c.id, Number(n[1]))
        if (w !== undefined && w <= 8000 && attempt < maxAttempts) return { act: 'retry', wait: w + Math.floor(this.rand() * 250) }
        health.cool(kid, w ?? 60_000, err.source === 'heuristic' || w === undefined)
        return multi ? { act: 'key' } : { act: 'next' }
      }
      case 'QUOTA_DAY': quota.exhaust(this.qid(c, role, ref), err.resetAt ?? dailyReset(c.kind, this.now()), 'daily quota'); return multi ? { act: 'key' } : { act: 'next' }
      case 'OVERLOADED': health.fail(c.id, 'overloaded'); return attempt < maxAttempts ? { act: 'retry', wait: 300 + Math.floor(this.rand() * 600) } : { act: 'next' }
      case 'NETWORK': health.fail(c.id, 'unreachable'); return attempt < maxAttempts ? { act: 'retry', wait: 400 } : { act: 'next' }
      case 'TIMEOUT': health.fail(c.id, 'timed out'); health.penalize(c.id, 0.5, 'timeouts'); return { act: 'next' }
      case 'STREAM_DROP': {
        health.fail(c.id, 'stream dropped')
        // keep what arrived: a request nobody is watching live is continued from it by the next model (a streaming caller restarts cleanly instead)
        if (req && !req.onText && !req.tools?.length && !req.json && err.partialText) { const p = resumePrefix(ctx.prefix ? joinResumed(ctx.prefix, err.partialText) : err.partialText); if (p) ctx.prefix = p }
        return { act: 'next' }
      }
      case 'AUTH': {
        this.authOff.set(this.authId(c, ref), { fp: keyPrint(this.key(ref)), at: this.now() })
        this.notify({ id: `auth:${this.authId(c, ref)}:${keyPrint(this.key(ref))}`, kind: 'auth', text: userMessage(err, c.name) })
        return { act: 'key' }
      }
      case 'SAFETY_BLOCK': return safetyHits >= 2 ? { act: 'stop' } : { act: 'next' }
      case 'RECITATION': if (attempt < maxAttempts) { ctx.temp = 0.9; ctx.hint = 'Answer in your own words; do not quote the source.'; return { act: 'retry', wait: 0 } } return { act: 'next' }
      case 'MALFORMED_TOOL':
        health.fail(c.id, 'bad tool call'); health.penalize(c.id, err.pts || BAD_TOOL_PTS, 'malformed tool calls')
        if (attempt < maxAttempts) { ctx.hint = `Your last reply was rejected: ${err.message}. Fix exactly that and answer again (only the tools you were given, with every required argument, or the format asked for).`; return { act: 'retry', wait: 0 } }
        return { act: 'next' }
      case 'EMPTY': health.fail(c.id, 'empty reply'); health.penalize(c.id, 0.5, 'empty replies'); return attempt < maxAttempts ? { act: 'retry', wait: 0 } : { act: 'next' }
      case 'TRUNCATED': if (attempt < maxAttempts) { ctx.boost = 2; return { act: 'retry', wait: 0 } } return { act: 'stop' }
      case 'BAD_REQUEST': health.penalize(c.id, err.status === 404 ? 5 : 2, err.status === 404 ? 'the model name is not found' : 'rejected the request'); return { act: 'next' }   // a dead model id must stop being first
      default: return { act: 'next' }    // CONTEXT_OVERFLOW, NO_PROVIDER
    }
  }

  /** a failure of the whole host (not just one model on it): the other models there are skipped for the rest of this request */
  private hostDown(err: AiError) { return err.kind === 'NETWORK' || err.kind === 'TIMEOUT' || (err.kind === 'OVERLOADED' && [500, 502, 504].includes(err.status)) }

  /** the error to hand back when nothing answered: one that says to try again later wins over one that says the request itself was bad */
  private pickError(errs: AiError[]): AiError {
    const later = errs.filter(e => isWait(e) && e.kind !== 'AUTH')
    if (later.length) return later[later.length - 1]
    const auth = errs.filter(e => e.kind === 'AUTH')
    return auth.length ? auth[auth.length - 1] : errs[errs.length - 1]
  }
  /** when it is next worth trying: the soonest a model not in use right now is expected back */
  private comeback(role: BrainRole, need: Need, background: boolean, req: ChatRequest | undefined): number {
    const t = this.now(), p = this.plan(role, need, background, req)
    if (p.head.length) return t + 1500
    const ts = [...p.tail.map(x => x.back), ...p.blocked.map(b => b.until)]
    return ts.length ? Math.max(t + 500, Math.min(...ts)) : t + 30_000
  }

  private async run<T extends { usage: Usage }>(
    role: BrainRole, op: string, need: Need, o: CallOpts, req: ChatRequest | undefined,
    invoke: (p: LlmProvider, c: ProviderConfig, ctx: Ctx, signal: AbortSignal | undefined) => Promise<T>,
    check?: (r: T) => AiError | null,
  ): Promise<{ r: T; c: ProviderConfig; prefix: string }> {
    const bg = !!o.background
    const perAttempt = o.deadlineMs ?? ROLE_DEADLINE_MS[role]
    const budget = o.totalMs ?? Math.max(perAttempt * 2, 30_000)
    const started = this.now()
    const chain: string[] = []
    const errs: AiError[] = []
    const hostBad = new Set<string>()
    const shared = { prefix: '' }
    let safetyHits = 0, firstFail: { c: ProviderConfig; e: AiError } | null = null, sole = false
    const remoteTried = new Set<string>(), remoteNet = new Set<string>()
    let lastBlocked: Blocked[] = []
    for (let round = 0; ; round++) {
      const picked = this.plan(role, need, bg, req)
      lastBlocked = picked.blocked
      if (!picked.list.length) { if (!errs.length) this.noCandidate(role, op, picked); break }
      sole = picked.configured === 1
      let tried = 0
      for (const cand of picked.list) {
        const c = cand.c
        if (hostBad.has(hostOf(c))) continue
        if (tried >= MAX_CANDIDATES || (tried > 0 && this.now() - started > budget)) break
        tried++
        const ctx: Ctx = { boost: 1, hint: '', prefix: shared.prefix }
        const behind = picked.list.length - tried > 0
        const maxAttempts = cand.tail ? 1 : MAX_ATTEMPTS
        keys: for (const ref of cand.keys) {
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (o.signal?.aborted) throw new AiError('ABORTED', 'stopped')
            if (!this.isLocal(c)) remoteTried.add(c.id)
            const kid = this.kid(c, ref)
            this.p.health.begin(kid)
            if (kid !== c.id) this.p.health.begin(c.id)
            if (cand.tail) { const q = this.qid(c, role, ref); this.p.quota.markProbe(q); const a = this.authOff.get(this.authId(c, ref)); if (a) a.at = this.now() }
            // with another model waiting behind this one, a slow one gets 25 s, not a minute (a free 550B model that never answers must not hold a request up)
            const base = isRouter(c) ? Math.max(perAttempt, ROUTER_DEADLINE_MS) : perAttempt
            const dl = behind && role !== 'heavy' && !o.deadlineMs ? Math.min(base, isRouter(c) ? ROUTER_DEADLINE_MS : 25_000) : base
            const signal = dl > 0 ? (o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(dl)]) : AbortSignal.timeout(dl)) : o.signal
            const t0 = this.now()
            this.inflight.set(c.id, (this.inflight.get(c.id) ?? 0) + 1)
            try {
              const r = await invoke(this.build(c, ref), c, ctx, signal)
              let bad = check ? check(r) : null
              if (bad && bad.kind === 'EMPTY' && o.allowEmpty) bad = null
              if (bad) throw bad
              const ms = this.now() - t0
              this.p.health.ok(c.id, ms)
              if (kid !== c.id) this.p.health.ok(kid, ms)
              this.p.quota.record(c.id, r.usage, bg)
              if (kid !== c.id) this.p.quota.record(kid, r.usage, bg)
              const q = this.qid(c, role, ref)
              if (this.p.quota.exhaustedUntil(q)) this.p.quota.clear(q)     // the day's quota came back early
              this.authOff.delete(this.authId(c, ref))
              this.p.tracer.record({ op, role, provider: c.id, model: c.model, ok: true, kind: 'OK', attempt, ms, tin: r.usage.in, tout: r.usage.out, cached: r.usage.cached, chain: chain.join(' > ') })
              if (!this.isLocal(c)) this.setOffline(false)
              else if (remoteTried.size > 0 && remoteNet.size === remoteTried.size) this.setOffline(true)   // the remote models all failed on the network and a local one answered
              if (firstFail && firstFail.c.id !== c.id) this.notify({ id: `fb:${firstFail.c.id}:${firstFail.e.kind}`, kind: 'fallback', text: `Using ${c.name}: ${firstFail.c.name} ${shortWhy(firstFail.e.kind, firstFail.e.source)}.` })
              this.emitChange()
              return { r, c, prefix: ctx.prefix }
            } catch (e) {
              if (o.signal?.aborted) throw new AiError('ABORTED', 'stopped')   // the person's stop is never a provider failure
              const err = classifyThrown(e)
              if (err.kind === 'ABORTED') throw err
              err.provider = c.name   // the name the person gave it, for the message
              if (err.kind === 'TRUNCATED' && attempt >= maxAttempts && err.partial) {
                // still cut off after asking for more room: hand back what there is
                this.p.quota.record(c.id, (err.partial as { usage: Usage }).usage, bg)
                this.p.tracer.record({ op, role, provider: c.id, model: c.model, ok: true, kind: 'TRUNCATED', attempt, ms: this.now() - t0, chain: chain.join(' > '), note: 'accepted a cut-off answer' })
                return { r: err.partial as T, c, prefix: ctx.prefix }
              }
              errs.push(err)
              if (!firstFail) firstFail = { c, e: err }
              if (err.kind === 'SAFETY_BLOCK') safetyHits++
              if (err.kind === 'NETWORK' && !this.isLocal(c)) remoteNet.add(c.id)
              this.p.quota.record(c.id, undefined, bg, true)
              this.p.tracer.record({ op, role, provider: c.id, model: c.model, ok: false, kind: err.kind, attempt, ms: this.now() - t0, chain: chain.join(' > '), note: err.message })
              this.logger(`ai ${op} failed: ${err.kind} role=${role} provider=${c.id} model=${c.model} attempt=${attempt} status=${err.status}`)
              chain.push(`${c.id}:${err.kind}`)
              const v = this.verdict(err, c, ref, attempt, maxAttempts, ctx, safetyHits, role, req)
              shared.prefix = ctx.prefix
              if (err.kind === 'STREAM_DROP') req?.onText?.('')    // a streaming caller shows the next model's text instead of the cut-off one
              this.emitChange()
              if (v.act === 'stop') throw this.finish(err, chain, role, need, bg, req, errs, lastBlocked)
              if (v.act === 'retry') { if (v.wait > 0) await this.sleep(v.wait); continue }
              if (v.act === 'key') continue keys
              if (this.hostDown(err)) hostBad.add(hostOf(c))
              break keys
            } finally { this.inflight.set(c.id, Math.max(0, (this.inflight.get(c.id) ?? 1) - 1)) }
          }
          // attempts on this key are used up (retry exhausted): the next key, if any, gets its turn
        }
      }
      // everything failed. An interactive call with a single usable model waits out a short cooldown right here instead of failing.
      const err = this.pickError(errs)
      const back = this.comeback(role, need, bg, req)
      const wait = back - this.now()
      if (round === 0 && !bg && sole && (err.kind === 'RATE_MINUTE' || err.kind === 'OVERLOADED') && wait <= WAIT_IN_GATEWAY_MS && this.now() - started + wait < budget && !o.signal?.aborted) { await this.sleep(Math.max(0, wait) + Math.floor(this.rand() * 250)); continue }
      break
    }
    if (remoteTried.size > 0 && remoteNet.size === remoteTried.size) this.setOffline(true)
    throw this.finish(errs.length ? this.pickError(errs) : new AiError('NO_PROVIDER', 'no attempt was made'), chain, role, need, bg, req, errs, lastBlocked)
  }

  /** the error that leaves the gateway: a sentence for the person (the provider's words are kept in `detail`), when to try again, and the fallback chain */
  private finish(err: AiError, chain: string[], role: BrainRole, need: Need, bg: boolean, req: ChatRequest | undefined, errs: AiError[] = [], blocked: Blocked[] = []): AiError {
    err.failures = this.failuresOf(errs, blocked)
    if (err.kind !== 'NO_PROVIDER' && err.kind !== 'ABORTED' && !err.detail) { err.detail = err.message; err.message = userMessage(err, err.provider) }
    err.until ??= isWait(err) ? this.comeback(role, need, bg, req) : undefined
    return Object.assign(err, { chain: chain.join(' > ') })
  }
  /** one entry per provider that failed this request (the last thing it said) or was known to be unusable, in the order tried */
  private failuresOf(errs: AiError[], blocked: Blocked[]): Failure[] {
    const by = new Map<string, Failure>()
    for (const e of errs) { const n = e.provider ?? 'a model'; by.set(n, { provider: n, kind: e.kind, why: shortWhy(e.kind, e.source) }) }
    for (const b of blocked) if (!by.has(b.c.name)) by.set(b.c.name, { provider: b.c.name, kind: b.kind, why: shortWhy(b.kind) })
    return [...by.values()]
  }

  // ---- chat --------------------------------------------------------------------------------------------------------------------
  /** a reply is only used if it is a real one: not blocked, not empty, with tool calls that exist and carry their required arguments */
  private validate(r: ChatResponse, req: ChatRequest): AiError | null {
    if (r.finish === 'safety') return new AiError('SAFETY_BLOCK', 'blocked by the provider\'s safety filter')
    if (r.finish === 'recitation') return new AiError('RECITATION', 'the answer was cut for quoting a source')
    if (r.finish === 'malformed' || r.malformed) return new AiError('MALFORMED_TOOL', r.malformed ?? 'the function call was malformed', 0, { pts: BAD_TOOL_PTS })
    const offered = new Map((req.tools ?? []).map(t => [t.name, t]))
    const known = new Set([...offered.keys(), ...(req.knownTools ?? [])])
    for (const c of r.toolCalls) {
      if (!known.has(c.name)) return new AiError('MALFORMED_TOOL', `there is no tool called "${c.name}"`, 0, { pts: INVENTED_TOOL_PTS })
      const need = (offered.get(c.name)?.parameters as { required?: string[] } | undefined)?.required ?? []
      const miss = need.filter(k => c.args[k] === undefined || c.args[k] === null)
      if (miss.length) return new AiError('MALFORMED_TOOL', `${c.name} is missing ${miss.join(', ')}`, 0, { pts: BAD_TOOL_PTS })
    }
    if (!r.text && !r.toolCalls.length) return new AiError('EMPTY', 'the model returned nothing')
    if (r.finish === 'length') return Object.assign(new AiError('TRUNCATED', 'the answer was cut off'), { partial: r })
    return null
  }

  /** ask a model by role */
  async call(role: BrainRole, req: ChatRequest, o: CallOpts = {}): Promise<ChatResponse> {
    const signal = req.signal ?? o.signal
    const { r, prefix } = await this.run<ChatResponse>(role, o.op ?? 'chat', needOf(role, req), { ...o, signal }, req,
      (p, _c, ctx, sig) => p.chat({
        ...req, signal: sig,
        messages: ctx.prefix ? [...req.messages, { role: 'assistant', text: ctx.prefix }, { role: 'user', text: CONTINUE }] : req.messages,
        system: ctx.hint ? `${req.system}\n\n(${ctx.hint})` : req.system,
        temperature: ctx.temp ?? req.temperature,
        maxTokens: req.maxTokens !== undefined ? req.maxTokens * ctx.boost : ctx.boost > 1 ? 2048 * ctx.boost : undefined,
      }),
      r => this.validate(r, req))
    return prefix && r.text ? { ...r, text: joinResumed(prefix, r.text) } : r
  }
  /** a JSON answer that must match `schema`: parsed and checked; a bad answer is repaired once (the error goes back to the model), then the next model */
  async callJson(role: BrainRole, req: ChatRequest, schema: Schema, o: CallOpts = {}): Promise<unknown> {
    const signal = req.signal ?? o.signal
    let value: unknown
    await this.run<ChatResponse>(role, o.op ?? 'json', needOf(role, { ...req, tools: undefined }), { ...o, signal }, req,
      (p, _c, ctx, sig) => p.chat({ ...req, json: true, signal: sig, system: ctx.hint ? `${req.system}\n\n(${ctx.hint})` : req.system, maxTokens: req.maxTokens !== undefined ? req.maxTokens * ctx.boost : undefined }),
      r => {
        const base = this.validate(r, { ...req, tools: undefined })
        if (base) return base
        try { value = parseJsonAnswer(r.text) } catch (e) { return new AiError('MALFORMED_TOOL', `your answer was not valid JSON (${e instanceof Error ? e.message : 'parse error'})`, 0, { pts: 0.5 }) }
        const bad = checkSchema(value, schema)
        return bad ? new AiError('MALFORMED_TOOL', `your JSON does not match what was asked: ${bad}`, 0, { pts: 0.5 }) : null
      })
    return value
  }
  /** same as `call` (the name the old router had) */
  chat(role: BrainRole, req: ChatRequest, o: CallOpts = {}) { return this.call(role, req, o) }

  /** vectors for texts, or null when no embedding model can answer (memory then falls back to word matching) */
  async embed(texts: string[], kind: 'doc' | 'query' = 'doc', o: CallOpts & { dims?: number } = {}): Promise<number[][] | null> {
    if (!texts.length) return null
    try {
      const { r } = await this.run<{ vectors: number[][]; usage: Usage }>('embed', 'embed', needOf('embed'), { background: kind === 'doc', ...o }, undefined,
        async (p, _c, _x, sig) => { if (!p.embed) throw new AiError('BAD_REQUEST', 'this provider has no embedding endpoint'); return p.embed(texts, kind, o.dims ?? 256, sig) },
        r => (r.vectors.length === texts.length && r.vectors.every(v => v.length >= 8) ? null : new AiError('EMPTY', 'the embedding answer did not match the request')))
      return r.vectors
    } catch { return null }
  }

  /** a web-grounded answer (Google Search through Gemini) */
  async search(question: string, o: CallOpts = {}): Promise<{ text: string; sources: { title: string; url: string }[] }> {
    const { r } = await this.run<{ text: string; sources: { title: string; url: string }[]; usage: Usage }>('search', o.op ?? 'search', needOf('search'), o, undefined,
      async (p, _c, _x, sig) => { if (!p.search) throw new AiError('BAD_REQUEST', 'this provider cannot search'); return p.search(question, sig) },
      r => (r.text ? null : new AiError('EMPTY', 'the search answer was empty')))
    return { text: r.text, sources: r.sources }
  }

  /** open the connection to the first transcribing model early */
  warm(role: BrainRole) { try { const h = this.plan(role, role === 'transcribe' ? { audioIn: true } : {}, false).head[0]; if (h) this.build(h.c, h.keys[0]).warm?.() } catch { /* a warm-up is only a hint */ } }

  // ---- the Live voice socket: metered and breaker-guarded like any other provider, one breaker per model id ("live:<model>") ----------
  private liveId(model?: string) { return model ? `live:${model}` : 'live' }
  /** may a Live session be opened now (with this model)? No: its daily/minute quota is spent, or it keeps failing (the circuit is open). */
  liveAllowed(model?: string): { ok: true } | { ok: false; kind: AiKind; until: number; why: string } {
    const id = this.liveId(model)
    const until = this.p.quota.exhaustedUntil(id)
    const label = model ? `Gemini Live (${model})` : 'Gemini Live'
    if (until) return { ok: false, kind: 'QUOTA_DAY', until, why: `${label}'s limit is used up until about ${new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` }
    if (!this.p.health.allow(id)) return { ok: false, kind: 'OVERLOADED', until: this.p.health.openUntil(id), why: `${label} keeps failing; trying again shortly` }
    return { ok: true }
  }
  /** a connection attempt is about to start (lets a half-open breaker allow exactly one trial) */
  liveBegin(model?: string) { this.p.health.begin(this.liveId(model)) }
  /** a connection attempt ended: it came up (`kind` absent) or failed with `kind` */
  liveConnect(o: { model: string; ms: number; resumed: boolean; kind?: AiKind; note?: string; resetAt?: number }) {
    const ok = !o.kind, id = this.liveId(o.model)
    this.liveSeen.add(id)
    this.p.tracer.record({ op: 'live.connect', role: 'live', provider: 'live', model: o.model, ok, kind: o.kind ?? 'OK', attempt: 1, ms: o.ms, note: (o.resumed ? 'resumed; ' : '') + (o.note ?? '') })
    if (ok) { this.p.health.ok(id, o.ms); this.emitChange(); return }
    this.p.quota.record('live', undefined, false, true)
    this.logger(`ai live.connect failed: ${o.kind} model=${o.model} ${o.note ?? ''}`)
    if (o.kind === 'QUOTA_DAY') this.p.quota.exhaust(id, o.resetAt ?? dailyReset('gemini', this.now()), 'live quota')
    else if (o.kind === 'RATE_MINUTE') this.p.health.cool(id, 60_000)
    else if (o.kind !== 'AUTH' && o.kind !== 'BAD_REQUEST' && o.kind !== 'ABORTED') this.p.health.fail(id, String(o.kind))
    this.emitChange()
  }
  /** a session ended: meter it (audio seconds become estimated tokens at 25 per second) */
  liveEnd(o: { model: string; ms: number; audioInSec: number; audioOutSec: number; kind?: AiKind | null; code?: number; note?: string }) {
    const bad = !!o.kind, id = this.liveId(o.model)
    this.liveSeen.add(id)
    this.p.quota.record('live', { in: Math.round(o.audioInSec * 25), out: Math.round(o.audioOutSec * 25), cached: 0 }, false, bad)
    this.p.tracer.record({ op: 'live.session', role: 'live', provider: 'live', model: o.model, ok: !bad, kind: o.kind ?? 'OK', attempt: 1, ms: o.ms, tin: Math.round(o.audioInSec * 25), tout: Math.round(o.audioOutSec * 25), note: `${o.code ? `code ${o.code}; ` : ''}${o.note ?? ''}` })
    if (bad) this.logger(`ai live.session ended: ${o.kind} code=${o.code ?? 0} after ${Math.round(o.ms / 1000)}s model=${o.model} ${o.note ?? ''}`)
    if (o.kind === 'NETWORK' || o.kind === 'OVERLOADED') this.p.health.fail(id, String(o.kind))
    if (o.kind === 'QUOTA_DAY') this.p.quota.exhaust(id, dailyReset('gemini', this.now()), 'live quota')
    else if (o.kind === 'RATE_MINUTE') this.p.health.cool(id, 60_000)
    this.emitChange()
  }
  /** a Live model id that does not exist (or is refused for good): off for a day */
  liveRetire(model: string, why: string) { const id = this.liveId(model); this.liveSeen.add(id); this.p.health.cool(id, 24 * 3_600_000); this.logger(`ai live model ${model} retired: ${why}`); this.emitChange() }
  /** a Live model that was refused again and again: rested for a while so another id is tried */
  liveRest(model: string, ms: number, why: string) { const id = this.liveId(model); this.liveSeen.add(id); this.p.health.cool(id, ms); this.logger(`ai live model ${model} rested ${Math.round(ms / 1000)}s: ${why}`); this.emitChange() }

  /** the person changed the key or the model, or pressed Test: forget the rests and limits held against these Live model ids */
  liveForgive(models: string[]) { for (const m of models) { const id = this.liveId(m); this.p.health.reset(id); this.p.quota.clear(id) } this.emitChange() }
  private liveList: { at: number; ids: string[] } | null = null
  /** the Live-capable model ids this key can use (asked of Google, kept for 6 hours): the alternates the voice ladder tries when voice.models is empty */
  async liveModels(): Promise<string[]> {
    if (this.liveList && this.now() - this.liveList.at < 6 * 3_600_000) return this.liveList.ids
    const key = this.key('gemini')
    if (!key) return []
    try { const ids = (await listLiveModels(key)).filter(m => !/native-audio-dialog|tts|image/i.test(m)); this.liveList = { at: this.now(), ids }; return ids } catch { return this.liveList?.ids ?? [] }
  }

  // ---- keys, tests and views ------------------------------------------------------------------------------------------------------
  /** the state of each key of a provider (the Models page shows these) */
  keyStates(c: ProviderConfig): KeyState[] {
    return keysOf(c).map(ref => {
      const b = this.keyBlock(c, ref, 'main')
      if (b) return { ref, state: b.kind === 'auth' ? 'rejected' as const : b.kind === 'quota' ? 'limit' as const : 'resting' as const, until: b.kind === 'auth' ? undefined : b.until, note: b.kind === 'auth' ? 'key rejected' : b.kind === 'quota' ? 'daily limit used up' : 'resting' }
      const ci = this.multi(c) ? null : this.p.health.coolInfo(c.id)
      if (ci) return { ref, state: 'resting' as const, until: ci.until, note: 'rate limited' }
      return { ref, state: 'ok' as const }
    })
  }
  /** forget everything held against this key / provider (the person pressed Test and it worked, or saved a new key) */
  forgive(c: ProviderConfig, ref?: string) {
    for (const r of ref ? [ref] : keysOf(c)) {
      this.authOff.delete(this.authId(c, r))
      this.p.health.reset(this.kid(c, r))
      for (const role of ['main', 'transcribe', 'search', 'embed'] as BrainRole[]) this.p.quota.clear(this.qid(c, role, r))
    }
    this.p.health.reset(c.id)
    this.probes.delete(c.id)
    this.emitChange()
  }

  /** a one-line check of a configured model (and one specific key of it, with `ref`), plus (for the roles that need it) a tool-call probe */
  async test(id: string, ref?: string): Promise<{ ok: boolean; ms: number; reply?: string; error?: string; tools?: boolean }> {
    const c = this.cfg().find(x => x.id === id)
    if (!c) return { ok: false, ms: 0, error: 'unknown provider' }
    const t0 = this.now()
    const useRef = ref ?? this.refsOf(c)[0] ?? keysOf(c)[0]
    if (c.enabled && c.kind === 'openai' && c.baseUrl.trim() && !c.model.trim()) {
      // no model name: ask the server what it has, so the person can type one
      try {
        const r = await fetch(`${c.baseUrl.replace(/\/+$/, '')}/models`, { headers: this.key(useRef) ? { Authorization: `Bearer ${this.key(useRef)}` } : {}, signal: AbortSignal.timeout(6000) })
        const j = (await r.json()) as { data?: { id?: string }[]; models?: { name?: string }[] }
        const ids = (j.data?.map(m => m.id) ?? j.models?.map(m => m.name) ?? []).filter(Boolean).slice(0, 8)
        return { ok: false, ms: this.now() - t0, error: ids.length ? `type a model name first. This server offers: ${ids.join(', ')}` : 'type a model name first (the server listed none)' }
      } catch (e) { return { ok: false, ms: this.now() - t0, error: `type a model name first; the server at ${c.baseUrl} did not answer (${classifyThrown(e).message.slice(0, 60)})` } }
    }
    if (!this.ready(c)) return { ok: false, ms: 0, error: this.whyNot(c) || 'not ready' }
    try {
      const p = this.build(c, useRef)
      let reply = ''
      if (capsOf(c).embed) { const e = await p.embed?.(['ping'], 'query', 8); if (!e || !e.vectors[0]?.length) throw new AiError('EMPTY', 'no vector came back'); reply = `vector of ${e.vectors[0].length}` }
      else reply = (await p.chat({ system: 'Reply with exactly: ok', messages: [{ role: 'user', text: 'ping' }], maxTokens: 16, temperature: 0, signal: AbortSignal.timeout(30_000) })).text.slice(0, 40)
      this.forgive(c, ref)
      const out: { ok: boolean; ms: number; reply?: string; tools?: boolean } = { ok: true, ms: this.now() - t0, reply }
      if (c.roles.some(r => r === 'main' || r === 'ground') && !capsOf(c).embed) { const pr = await this.probe(c, useRef); if (pr !== null) out.tools = pr }
      return out
    } catch (e) {
      const err = classifyThrown(e)
      err.provider = c.name
      if (err.kind === 'AUTH') this.authOff.set(this.authId(c, useRef), { fp: keyPrint(this.key(useRef)), at: this.now() })
      this.emitChange()
      return { ok: false, ms: this.now() - t0, error: userMessage(err, c.name).slice(0, 160) }
    }
  }

  /** does the model call a tool when told to? One that cannot is kept out of main and ground (for 10 minutes, or until the next Test) */
  async probe(c: ProviderConfig, ref?: string): Promise<boolean | null> {
    let ok = false
    try {
      const r = await this.build(c, ref ?? this.refsOf(c)[0] ?? keysOf(c)[0]).chat({
        system: 'You must answer by calling the tool probe_echo with word set to "ok". Do not write anything else.', messages: [{ role: 'user', text: 'Call the tool now.' }],
        tools: [{ name: 'probe_echo', description: 'Echo a word back', parameters: { type: 'OBJECT', properties: { word: { type: 'STRING' } }, required: ['word'] } }], maxTokens: 64, temperature: 0, signal: AbortSignal.timeout(45_000),
      })
      ok = r.toolCalls.some(t => t.name === 'probe_echo' && typeof t.args.word === 'string')
    } catch { return null }   // an error (overloaded, rate limited, offline) says nothing about tool calling: the model is neither passed nor failed
    this.probes.set(c.id, { ok, at: this.now() })
    if (!ok) this.p.health.penalize(c.id, 1, 'failed the tool-call probe')
    return ok
  }

  getUsage(): Record<string, ProviderUsage> { return this.p.quota.usage() }
  traces(f?: TraceFilter): TraceRow[] { return this.p.tracer.list(f) }

  /** the day's chat quota of a provider: exhausted only when every one of its keys is */
  private exhaustedFor(c: ProviderConfig): number | null {
    const us = keysOf(c).map(r => this.p.quota.exhaustedUntil(this.qid(c, 'main', r)))
    return us.every(u => u) ? Math.min(...(us as number[])) : null
  }

  status(): BrainStatus {
    const u = this.p.quota.usage()
    const liveRow = () => {
      const ids = [...this.liveSeen]
      const outs = ids.map(i => this.p.quota.exhaustedUntil(i)), rests = ids.map(i => this.p.health.info(i))
      const out = ids.length && outs.every(x => x) ? Math.min(...(outs as number[])) : null
      const rest = ids.length && rests.every(h => h.restingUntil) ? Math.min(...rests.map(h => h.restingUntil as number)) : null
      const x = u.live
      return { id: 'live', requests: x?.requests ?? 0, tin: x?.in ?? 0, tout: x?.out ?? 0, errors: x?.errors ?? 0, limit: 0, exhaustedUntil: out, restingUntil: rest, breaker: (rests.some(h => h.breaker === 'open') && rest ? 'open' : 'closed') as 'open' | 'closed', demerits: 0, note: out ? 'live voice limit used up' : rest ? 'live voice resting after errors (basic voice meanwhile)' : '' }
    }
    return {
      offline: this.offline, db: !!this.p.db,
      providers: [...this.cfg().map(c => c.id), 'live'].map(id => ({ id, c: this.cfg().find(x => x.id === id) })).map(({ c }) => {
        if (!c) return liveRow()
        const h = this.p.health.info(c.id)
        const out = this.exhaustedFor(c)
        const unadmitted = c.enabled && c.model.trim() && c.roles.some(r => (r === 'main' || r === 'ground') && !this.isAdmitted(c, r))
        const broken = c.enabled ? this.whyNot(c) : ''
        const pr = this.probes.get(c.id)
        const note = broken ? `not used: ${broken}` : unadmitted ? 'not tested yet: it is tried after the tested models; press Test' : out ? `daily limit used up, back about ${new Date(out).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : this.authBlocked(c) ? 'key rejected' : pr && !pr.ok && this.now() - pr.at < PROBE_TTL_MS ? 'does not call tools reliably' : h.demerits >= SINK_AT ? (h.note || 'making bad calls') : h.restingUntil ? (h.note || 'resting after errors') : ''
        const x = u[c.id]
        return { id: c.id, requests: x?.requests ?? 0, tin: x?.in ?? 0, tout: x?.out ?? 0, errors: x?.errors ?? 0, limit: this.p.quota.limits(c).rpd, exhaustedUntil: out, restingUntil: h.restingUntil, breaker: h.breaker, demerits: h.demerits, note }
      }),
    }
  }

  flush() { this._p?.quota.flush(); this._p?.health.flush() }
}

export const ai = new Gateway(undefined, undefined, { admission: () => settings.value.brain.admission !== false, admitted: () => settings.value.brain.admitted ?? [] })

export type { AiKind }
