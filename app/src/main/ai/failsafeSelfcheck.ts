import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KeyFamily, ModelsStatus, ProviderConfig } from '@shared/bridge'
import type { AgentTask } from '@shared/voice'
import { execute, type ToolCtx } from '../agent/tools'
import type { Sidecar } from '../sidecar'
import { guard } from './guard/policy'
import { cliTest, mockCli, refreshCli } from '../brain/cli'
import { COMPUTER_TOOLS } from '../brain/computer'
import { runLoop } from '../brain/loop'
import { runOperator } from '../brain/operator'
import { groupTools, installedCli, startTools } from '../brain/roles'
import { TaskManager } from '../brain/tasks'
import type { ChatRequest } from '../brain/types'
import { FaultProvider, type Fault, type Step } from './chaos'
import { openDb } from './db'
import { AiError, classifyHttp, failureLine, isWait, userMessage } from './errors'
import { Gateway } from './gateway'
import { rungOf, salvageKind, speakable } from './live/ladder'
import { makePusher, ModelsService } from './modelsFeed'
import { Journal } from './runtime/journal'
import { planAndRun } from './runtime/plan'

// `--selfcheck` for AI v2 (docs/AI-FAILSAFE.md section 7): the user's real failure replayed, the audit findings as regression tests, the chaos
// matrix, the never-fail tasks, delegation to a coding agent (a mock CLI), the voice ladder's decisions and the models feed. No network, no key,
// no real data folder; all model clocks are fake. (The mock-Live socket cases are in live/selfcheck.ts, the caption bar's in agent/*Selfcheck.ts.)
const T0 = Date.parse('2026-10-16T12:00:00Z')
export const cfg = (id: string, o: Partial<ProviderConfig> = {}): ProviderConfig => ({ id, name: id, kind: 'gemini', baseUrl: '', model: 'm-' + id, enabled: true, keyRef: id, roles: ['main'], dailyLimit: 0, ...o })
export const req = (extra: Partial<ChatRequest> = {}): ChatRequest => ({ system: 's', messages: [{ role: 'user', text: 'x' }], ...extra })
const AUDIO: ChatRequest = { system: 's', messages: [{ role: 'user', text: 'transcribe', audio: 'QQ==' }] }
const SETV = { name: 'set_volume', description: 'set the volume', parameters: { type: 'OBJECT', properties: { level: { type: 'NUMBER' } }, required: ['level'] } }
const WRITE = { name: 'write_file', description: 'write', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' }, content: { type: 'STRING' } }, required: ['path', 'content'] } }

export function rig(cfgs: ProviderConfig[], scripts: Record<string, Step[]> = {}, secrets: Record<string, string> = {}) {
  const fp = Object.fromEntries(cfgs.map(c => [c.id, new FaultProvider(c.id, scripts[c.id] ?? [], c.model, c.name, c.kind)]))
  const slept: number[] = [], logs: string[] = []
  const t = { now: T0 }
  const keys: Record<string, string> = { ...Object.fromEntries(cfgs.flatMap(c => [c.keyRef, ...(c.keyRefs ?? [])].map(r => [r, 'key-' + r + '-abcd']))), ...secrets }
  const db = openDb(':memory:')
  const g = new Gateway(() => cfgs, ref => keys[ref] ?? null, { db, probe: async () => true, build: c => fp[c.id], sleep: async ms => { slept.push(ms); t.now += ms }, now: () => t.now, rand: () => 0, log: m => logs.push(m) })
  return { g, fp, slept, logs, t, keys, db, cfgs }
}
export const fails = async (p: Promise<unknown>): Promise<AiError | null> => { try { await p } catch (e) { return e instanceof AiError ? e : new AiError('BAD_REQUEST', String(e)) } return null }
const tick = () => new Promise<void>(r => setImmediate(r))
/** real time (a child process is involved) */
async function untilReal(pred: () => boolean, ms = 15_000) { const end = Date.now() + ms; while (Date.now() < end && !pred()) await new Promise(r => setTimeout(r, 40)); return pred() }
async function until(pred: () => boolean, max = 400) { for (let i = 0; i < max && !pred(); i++) await tick(); return pred() }

/** a TaskManager on a fake clock, a scratch journal and a scripted model chain */
function taskRig(cfgs: ProviderConfig[], scripts: Record<string, Step[]> = {}) {
  const r = rig(cfgs, scripts)
  const journal = new Journal(() => r.db, () => r.t.now)
  const timers: { fn: () => void; ms: number; dead: boolean }[] = []
  const calls: string[] = []
  const events: string[] = []
  const hooks: { onTool?: () => void } = {}
  const mk = () => {
    const m = new TaskManager({
      sidecar: null as unknown as Sidecar, makeCtx: () => ({}) as ToolCtx, catalog: () => [SETV], system: () => 's',
      execute: async (name, a) => { calls.push(name + ':' + JSON.stringify(a)); hooks.onTool?.(); return { result: { ok: true } } },
      router: r.g, journal, now: () => r.t.now, rand: () => 0,
      later: (fn, ms) => { const t = { fn, ms, dead: false }; timers.push(t); return { cancel: () => { t.dead = true } } },
    })
    m.on('parked', (_t: AgentTask, text: string) => events.push(text))
    return m
  }
  const fire = () => { for (const t of timers.splice(0)) if (!t.dead) t.fn() }
  return { ...r, journal, timers, calls, events, hooks, mk, fire }
}

export async function failsafeSelfCheck(): Promise<string> {
  const problems: string[] = []
  let n = 0
  const ok = (c: boolean, m: string) => { n++; if (!c) problems.push(m) }
  const names = { flash: 'Gemini Flash', or: 'OpenRouter', free: 'FreeLLMAPI' }
  const real = () => [cfg('flash', { name: names.flash, roles: ['main', 'transcribe', 'search'], keyRef: 'gemini' }), cfg('or', { name: names.or, kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'x:free', keyRef: 'or' }), cfg('free', { name: names.free, kind: 'openai', baseUrl: 'http://localhost:3001/v1', model: 'auto', keyRef: 'fl' })]

  // ---- 1. the user's real failure: Flash daily quota, OpenRouter key rejected, FreeLLMAPI 429 "all models exhausted" --------------------------------
  {
    const r = rig(real(), { flash: ['quota_day'], or: ['auth'], free: ['bare_429'] })
    const e = await fails(r.g.call('main', req()))
    ok(!!e && !!e.until && e.until > r.t.now && isWait(e), 'replay: the call ends as a wait with a comeback time, not a dead end')
    ok(!!e && failureLine(e) === 'Gemini Flash hit its daily limit; OpenRouter key was rejected; FreeLLMAPI is rate limited', 'replay: the notice names WHICH providers failed and why: ' + (e ? failureLine(e) : ''))
    ok(!!e && !/\b(429|401|RESOURCE_EXHAUSTED|All models exhausted)\b/.test(e.message), 'replay: no raw status text reaches the person')
    const lp = await runLoop({ goal: 'x', system: 's', role: 'main', catalog: [], enabled: new Set(), run: async () => ({ result: {} }), maxSteps: 3, router: rig(real(), { flash: ['quota_day'], or: ['auth'], free: ['bare_429'] }).g })
    ok(lp.reason === 'wait' && !!lp.until && /Gemini Flash hit its daily limit/.test(lp.error ?? ''), 'replay: the loop waits (names the providers) instead of failing the job')
  }
  // the whole story as a job: it parks, tells the person once, and finishes by itself once a provider is back, without repeating the side effect
  {
    const t = taskRig(real())
    let outage = false
    for (const id of ['flash', 'or', 'free']) t.fp[id].down = () => (outage ? (id === 'flash' ? 'quota_day' : id === 'or' ? 'auth' : 'bare_429') : null)
    t.fp.flash.then({ fault: 'ok', tool: { name: 'set_volume', args: { level: 30 } } }, { fault: 'ok', tool: { name: 'set_volume', args: { level: 30 } } }, { fault: 'ok', text: 'All written.' })
    t.hooks.onTool = () => { outage = true }   // the outage starts right after the first tool ran
    const mgr = t.mk()
    const sp = mgr.spawn({ goal: 'write the note', role: 'general' })
    const id = 'id' in sp ? sp.id : ''
    await until(() => mgr.list()[0]?.status === 'parked')
    const job = mgr.list()[0]
    ok(job?.status === 'parked' && !!job.until && job.until > t.t.now && job.waitKind !== undefined, 'a job that finds every model down is PARKED with a comeback time, not failed: ' + JSON.stringify(job) + t.calls.join())
    ok(t.calls.length === 1 && t.events.length === 1 && /Gemini Flash hit its daily limit; OpenRouter key was rejected; FreeLLMAPI is rate limited/.test(t.events[0]) && /carry on/.test(t.events[0]), 'the person is told once which providers failed and that it carries on')
    ok(/waiting for a model/.test(job?.line ?? '') && t.journal.run(id)?.status === 'parked', 'the Flow line says it is waiting and the journal says parked')
    // a restart in between: a new manager on the same journal restores it and it carries on by itself
    t.timers.length = 0   // (the first manager's timers belong to the old process)
    const mgr2 = t.mk()
    mgr2.restoreParked()
    ok(mgr2.list()[0]?.status === 'parked' && mgr2.interrupted().length === 0, 'after a restart the parked job is restored and waiting (not listed as interrupted)')
    outage = false; t.t.now += 16 * 60_000
    t.fire()
    await until(() => mgr2.list()[0]?.status === 'done')
    ok(mgr2.list()[0]?.status === 'done' && !!mgr2.list()[0]?.result, 'when a provider is back (the exhausted day is re-probed after 15 min) the job finishes by itself: ' + JSON.stringify(mgr2.list()[0]) + ' timers=' + t.timers.length + ' steps=' + JSON.stringify(t.journal.stepsOf(id).map(x => x.kind + x.n + x.status)))
    ok(t.calls.length === 1, 'a resumed job does not repeat the side effect that already happened (idempotency)')
    ok(t.journal.run(id)?.status === 'done', 'and the run is closed in the journal')
  }
  // hard stops fail at once; an endless outage is given up after about six hours, naming the providers
  {
    const t = taskRig([cfg('a', { name: 'Model A' })], { a: Array(20).fill('bad_request') })
    const mgr = t.mk(); mgr.spawn({ goal: 'do something', role: 'general' })
    await until(() => mgr.list()[0]?.status === 'failed')
    ok(mgr.list()[0]?.status === 'failed' && /Model A rejected the request/.test(mgr.list()[0]?.result ?? ''), 'a request every model rejects fails at once (a hard stop), with the reason: ' + JSON.stringify(mgr.list()[0]))
    const none = taskRig([])
    const m2 = none.mk(); m2.spawn({ goal: 'do something', role: 'general' })
    await until(() => m2.list()[0]?.status === 'failed')
    ok(m2.list()[0]?.status === 'failed' && /No model is set up/.test(m2.list()[0]?.result ?? ''), 'no key and no model at all fails at once, saying what to add')
    const dead = taskRig(real())
    for (const id of ['flash', 'or', 'free']) dead.fp[id].down = () => (id === 'flash' ? 'quota_day' : id === 'or' ? 'auth' : 'bare_429')
    const m3 = dead.mk(); m3.spawn({ goal: 'do something', role: 'general' })
    await until(() => m3.list()[0]?.status === 'parked')
    let rounds = 0
    while (m3.list()[0]?.status === 'parked' && rounds < 80) { dead.t.now += (m3.list()[0].until ?? dead.t.now) - dead.t.now + 1000; dead.fire(); await until(() => m3.list()[0]?.status !== 'running'); rounds++ }
    const j = m3.list()[0]
    ok(j?.status === 'failed' && /gave up/.test(j.result ?? '') && /Gemini Flash hit its daily limit/.test(j.result ?? '') && rounds >= 20 && rounds < 60, `an endless outage is given up after about six hours (${rounds} tries, backoff capped at 15 minutes), naming the providers`)
    // retry and stop on a parked job
    const p = taskRig(real())
    for (const id of ['flash', 'or', 'free']) p.fp[id].down = () => (id === 'flash' ? 'quota_day' : id === 'or' ? 'auth' : 'bare_429')
    const m4 = p.mk(); const sp = m4.spawn({ goal: 'another job', role: 'general' }); const pid = 'id' in sp ? sp.id : ''
    await until(() => m4.list()[0]?.status === 'parked')
    const rr = m4.retry(pid)
    ok('id' in rr, 'Retry on a parked job asks the models again right now')
    await until(() => m4.list()[0]?.status === 'parked' && p.events.length >= 1)
    ok(m4.stop(pid) && m4.list()[0]?.status === 'stopped' && p.journal.run(pid)?.status === 'stopped', 'Stop on a parked job ends it')
  }
  // the plan-then-execute path of unattended runs parks too
  {
    const r = rig([cfg('m')], { m: [] })
    r.fp.m.down = () => 'quota_day'
    const out = await planAndRun({ goal: 'g', system: 's', catalog: [WRITE], allowed: new Set(['write_file']), run: async () => ({ result: { ok: true } }), router: r.g })
    ok(!!out.wait && !out.planned && out.wait.kind === 'QUOTA_DAY', 'a plan that cannot be made now returns a wait, not a failure')
  }
  // the screen operator waits in place and carries on
  {
    const fpo = new FaultProvider('g', ['rate_minute', 'overloaded', { fault: 'ok', tool: { name: 'finish', args: { success: true, summary: 'all done' } } }])
    const gw = new Gateway(() => [cfg('g', { roles: ['ground'] })], () => 'k', { db: null, build: () => fpo })
    const waits: number[] = []
    const res = await runOperator({ goal: 'do it', sidecar: undefined, signal: new AbortController().signal, router: gw, capture: async () => ({ jpeg: 'f', width: 1000, height: 1000 }), settleMs: 1, sleep: async ms => { waits.push(ms) }, act: async () => 'done', context: async () => '' })
    ok(res.ok && /all done/.test(res.summary) && waits.length > 0, 'the operator: a rate limit and an outage on the screen model are waited out in place, then the run continues')
  }

  // ---- 2. quota keys, stand-ins, multi key, host skip, headroom --------------------------------------------------------------------------------
  {
    const r = rig([cfg('flash', { roles: ['main', 'transcribe', 'search'] })], { flash: ['quota_day'] })
    await fails(r.g.call('main', req()))
    const before = r.fp.flash.calls
    await fails(r.g.call('transcribe', AUDIO))
    ok(r.fp.flash.calls > before, 'quota keys: a spent chat quota still lets transcribe try')
    r.fp.flash.calls = 0
    r.t.now += 5 * 60_000
    await fails(r.g.call('main', req()))
    ok(r.fp.flash.calls === 0, 'a spent day is not hammered')
    r.t.now += 11 * 60_000
    const e = await fails(r.g.call('main', req()))
    ok(!e && r.fp.flash.calls === 1, 'a spent day is half-open: one probe after 15 minutes finds out whether it came back')
  }
  {
    const r = rig([cfg('lite', { roles: ['fast'] })])
    const e = await fails(r.g.call('transcribe', AUDIO))
    ok(!e && r.fp.lite.calls === 1, 'stand-ins: transcribe with only Flash-Lite ticked for fast is served')
    const r2 = rig([cfg('lite', { roles: ['fast'] }), cfg('oai', { kind: 'openai', baseUrl: 'http://x/v1', model: 'plain-7b', roles: ['main'] })])
    const s = await fails(r2.g.search('q'))
    ok(!s && r2.fp.lite.calls === 1 && r2.fp.oai.calls === 0, 'stand-ins: search is served by a model that can search, not by one that cannot')
    const r3 = rig([cfg('flash', { roles: ['transcribe'] }), cfg('lite', { roles: ['fast'] })], { flash: ['quota_day'] })
    const t = await fails(r3.g.call('transcribe', AUDIO))
    ok(!t && r3.fp.lite.calls === 1, 'speech-to-text: when the ticked model is out of quota, another that hears audio answers')
  }
  {
    const two = cfg('g', { keyRefs: ['k1', 'k2'], keyRef: 'k1' })
    const r = rig([two], { g: ['auth'] })
    const a = await fails(r.g.call('main', req()))
    ok(!a && r.fp.g.calls === 2, 'multi key: a rejected key moves on to the next key of the same provider in the same call')
    const ks = r.g.keyStates(two)
    ok(ks.find(k => k.ref === 'k1')?.state === 'rejected' && ks.find(k => k.ref === 'k2')?.state === 'ok', 'and only that key is marked rejected')
    ok((await fails(r.g.call('main', req()))) === null && r.fp.g.calls === 3, 'the provider is not rested while a key works')
  }
  {
    const r = rig([cfg('a', { kind: 'openai', baseUrl: 'https://h1.test/v1', roles: ['main'] }), cfg('b', { kind: 'openai', baseUrl: 'https://h1.test/v1', model: 'other', roles: ['main'] }), cfg('c', { kind: 'openai', baseUrl: 'https://h2.test/v1', roles: ['main'] })], { a: ['bad_gateway', 'bad_gateway'] })
    const e = await fails(r.g.call('main', req()))
    ok(!e && r.fp.b.calls === 0 && r.fp.c.calls === 1, 'host skip: after a 502 the other models on the same host are skipped for this request')
  }
  {
    const r = rig([cfg('a', { rpm: 2 }), cfg('b')])
    for (let i = 0; i < 3; i++) await r.g.call('main', req())
    ok(r.fp.a.calls === 2 && r.fp.b.calls === 1, 'headroom: near its known limit a model ranks lower before the 429 arrives')
    const nf = rig([cfg('a', { model: 'gone' }), cfg('b')], { a: ['not_found'] })
    await nf.g.call('main', req()); await nf.g.call('main', req())
    ok(nf.fp.a.calls === 1, 'a dead model id (404) stops being first')
  }
  {
    const e401 = classifyHttp({ provider: 'openai', status: 401, body: '{}' }), e402 = classifyHttp({ provider: 'openai', status: 402, body: '{}' }), e403 = classifyHttp({ provider: 'openai', status: 403, body: '{"error":{"message":"model not allowed for this tier"}}' })
    ok(e401.source === 'key' && e402.source === 'credit' && e403.source === 'tier' && new Set([userMessage(e401, 'X'), userMessage(e402, 'X'), userMessage(e403, 'X')]).size === 3, '401, 402 and 403 are told apart (rejected key, no credit, not allowed with this key)')
    const bare = classifyHttp({ provider: 'openai', status: 429, body: '{"error":{"message":"All models exhausted"}}' })
    const withRetry = classifyHttp({ provider: 'openai', status: 429, body: '{}', headers: { 'retry-after': '12' } })
    const upstream = classifyHttp({ provider: 'openai', status: 502, body: '{"error":{"message":"upstream_failed"}}' })
    ok(bare.kind === 'RATE_MINUTE' && bare.source === 'heuristic' && withRetry.source === 'authoritative' && withRetry.retryAfterMs === 12_000 && upstream.kind === 'OVERLOADED', 'cooldown provenance: Retry-After is authoritative, a bare 429 is our guess; FreeLLMAPI 502 upstream_failed is OVERLOADED')
    const billing = classifyHttp({ provider: 'gemini', status: 429, body: '{"error":{"status":"RESOURCE_EXHAUSTED","message":"Check your plan and billing details."}}' })
    ok(billing.kind === 'RATE_MINUTE', 'the bare words "billing details" no longer make a daily quota')
    const router = cfg('free', { kind: 'openai', baseUrl: 'http://localhost:3001/v1', local: undefined })
    ok(!new Gateway(() => [router], () => 'k', { db: null }).isLocal(router), 'a localhost router (FreeLLMAPI) is not local for the offline latch unless marked')
  }
  // wait in the gateway; mid-stream resume; dictation replaces the partial
  {
    const r = rig([cfg('only')], { only: [{ fault: 'rate_minute', retryAfterSec: 5 }] })
    const t0 = r.t.now
    const e = await fails(r.g.call('main', req()))
    ok(!e && r.slept.some(ms => ms >= 5000 && ms <= 6000) && r.t.now - t0 < 20_000, 'wait-in-gateway: a sole provider with a short cooldown is waited for inside the call, which then succeeds')
    const long = rig([cfg('only')], { only: [{ fault: 'rate_minute', retryAfterSec: 90 }] })
    const el = await fails(long.g.call('main', req()))
    ok(!el || (isWait(el) && !!el.until), 'a long cooldown is not slept through: success on the last-resort try or a wait error with a time')
    const half = 'The quick brown fox jumps over the lazy dog and then'
    const s = rig([cfg('a'), cfg('b')], { a: [{ fault: 'stream_drop', partial: half + ' ru' }], b: [{ fault: 'ok', text: 'runs away.' }] })
    const res = await s.g.call('main', req())
    ok(res.text === half + ' runs away.' && s.fp.b.seen[0].messages.some(m => m.role === 'assistant' && m.text === half) && s.fp.b.seen[0].messages.some(m => /Continue exactly/.test(m.text ?? '')), 'mid-stream resume: the next model gets the cut-off text and continues from it (the half word is dropped), and the answers are joined')
    const shown: string[] = []
    const d = rig([cfg('a'), cfg('b')], { a: [{ fault: 'stream_drop', partial: 'hello wor' }], b: [{ fault: 'ok', text: 'hello world' }] })
    const dr = await d.g.call('main', req({ onText: t => { shown.push(t) } }))
    ok(dr.text === 'hello world' && shown.includes(''), 'dictation: a stream that drops mid-transcript is retried on another provider and the partial is replaced (reset signal sent), not appended')
  }

  // ---- 3. the chaos matrix: 1 and 3 providers x each fault x (recovers | stays down) -----------------------------------------------------------------
  {
    const faults: Step[] = [
      { fault: 'rate_minute', retryAfterSec: 3 }, { fault: 'rate_minute', retryAfterSec: 90 }, 'bare_429', 'quota_day', 'overloaded', 'bad_gateway', 'timeout', 'hang', 'malformed_json', 'invented_tool', 'network', 'auth', 'stream_drop', 'empty',
    ]
    let cells = 0, good = 0
    const label = (f: Step) => (typeof f === 'string' ? f : f.fault + (f.retryAfterSec ? `-${f.retryAfterSec}s` : ''))
    for (const f of faults) for (const N of [1, 3]) for (const mode of ['recovers', 'down'] as const) {
      const list = Array.from({ length: N }, (_, i) => cfg('p' + i, { name: 'P' + i, kind: 'openai', baseUrl: 'https://h' + i + '.test/v1' }))
      const r = rig(list)
      const bad = r.fp.p0
      if (mode === 'recovers') bad.then(f, f); else bad.down = () => f
      const first = await (async () => { try { return { res: await r.g.call('main', req({ tools: [WRITE] }), { deadlineMs: 60, totalMs: 600_000 }) } } catch (e) { return { err: e as AiError } } })()
      cells++
      let pass = false
      if ('res' in first) pass = true
      else if (first.err instanceof AiError && (first.err.failures?.length ?? 0) > 0 && (!isWait(first.err) || !!first.err.until)) pass = true
      if (N === 3 && mode === 'down') pass = pass && 'res' in first            // the other two providers must answer
      if (mode === 'recovers' && !('res' in first)) {                         // after the stated time the provider answers (it may take a try or two)
        let again: AiError | null = first.err
        for (let k = 0; k < 4 && again; k++) { r.t.now = Math.max(r.t.now, again.until ?? r.t.now) + 16 * 60_000; await r.g.checkOnline(); again = await fails(r.g.call('main', req({ tools: [WRITE] }), { deadlineMs: 60, totalMs: 600_000 })) }
        pass = pass && !again
      }
      if (pass) good++; else problems.push(`chaos: ${label(f)} x ${N} provider${N > 1 ? 's' : ''} (${mode}) -> ${'res' in first ? 'ok' : (first.err.kind + ': ' + first.err.message)}`)
    }
    n += cells
    chaos.cells = cells; chaos.good = good
  }

  // ---- 4. delegation to a coding agent through the whole path (a mock CLI, no model, no login) ----------------------------------------------------
  {
    const dir = mkdtempSync(join(tmpdir(), 'lokey-deleg-'))
    cliTest.installed = { claude: true, codex: false }
    cliTest.command = tool => (tool === 'claude' ? mockCli('ok') : undefined)
    await refreshCli()
    ok(installedCli.claude && !installedCli.codex, 'the app knows which coding agents are installed')
    ok(groupTools('agents').includes('delegate_coding') && startTools('general', ['agents']).has('delegate_coding') && !startTools('general').has('delegate_coding'), 'the agents group exists: a worker gets delegate_coding only by asking (use_tools) and only when a CLI is installed')
    const cards: { title: string; detail: string }[] = []
    const t = taskRig([cfg('m')])
    const mgr = t.mk()
    const ctx = { sidecar: null as unknown as Sidecar, scheduler: null as never, abilities: [], hub: null as never, confirmMode: 'risky', ask: async (title: string, detail: string) => { cards.push({ title, detail }); return true }, tasks: mgr } as ToolCtx
    guard.newTurn()
    const r1 = await execute('do_task', { goal: 'fix the login bug', role: 'coder', folder: dir }, ctx)
    ok((r1.result as { ok?: boolean }).ok === true && cards.length === 1 && /Claude Code/.test(cards[0].title) && cards[0].detail.includes(dir) && /fix the login bug/.test(cards[0].detail), 'do_task(role coder, folder, goal) shows the confirm card with the folder and goes to the CLI')
    await untilReal(() => mgr.list()[0]?.status === 'done')
    const j = mgr.list()[0]
    ok(j?.kind === 'cli' && j.backend === 'claude' && j.role === 'coder' && j.status === 'done' && /Fixed it: fix the login bug/.test(j.result ?? '') && j.steps >= 2, 'the job is a cli job (the Flow tab lists it), streams progress into the job and ends with the CLI answer: ' + JSON.stringify(j))
    const st = await execute('agent_status', {}, ctx)
    ok(JSON.stringify(st.result).includes('"role":"coder"'), 'agent_status shows the coding job')
    // a worker asks for the group, then delegates (the real use_tools + loop path)
    const w = rig([cfg('w')], { w: [{ fault: 'ok', tool: { name: 'use_tools', args: { group: 'agents' } } }, { fault: 'ok', tool: { name: 'delegate_coding', args: { task: 'add a README', folder: dir } } }, { fault: 'ok', text: 'Handed it over.' }] })
    const before = mgr.list().length
    const lp = await runLoop({ goal: 'ask Claude Code to add a README in the folder', system: 's', role: 'main', catalog: COMPUTER_TOOLS.concat([{ name: 'x', description: 'x', parameters: { type: 'OBJECT', properties: {} } }]), enabled: startTools('general'), run: (name, a) => execute(name, a, ctx), maxSteps: 6, router: w.g })
    ok(lp.reason === 'done' && mgr.list().length === before + 1 && cards.length === 2, 'a worker without the tool switches the agents group on with use_tools and delegates')
    await untilReal(() => mgr.list().every(x => x.status !== 'running'))
    // helpers cannot breed helpers, but may start a coding agent
    const rs = (mgr as unknown as { restricted(): { spawn(o: object): object } }).restricted()
    ok('error' in rs.spawn({ goal: 'more', role: 'general' }) && !('error' in rs.spawn({ goal: 'fix it', role: 'coder', backend: 'claude', folder: dir })), 'a helper cannot start more helpers but can hand a coding job to the CLI')
    await untilReal(() => mgr.list().every(x => x.status !== 'running'))
    // clear messages: no folder, missing folder, not installed
    const nf = await execute('delegate_coding', { task: 'fix it' }, { ...ctx, ask: async () => true })
    ok(/Which project folder/.test(JSON.stringify(nf.result)) && !('task_id' in nf.result), 'no folder named and none saved: it asks which folder instead of failing silently')
    const mf = await execute('delegate_coding', { task: 'fix it', folder: join(dir, 'nope') }, ctx)
    ok(/does not exist/.test(JSON.stringify(mf.result)), 'a folder that does not exist is said plainly')
    const cx = await execute('delegate_coding', { task: 'fix it', folder: dir, tool: 'codex' }, ctx)
    ok(/Codex is not installed/.test(JSON.stringify(cx.result)), '"Codex is not installed" is a clear message, not silence')
    // no CLI at all: the group has no delegate_coding
    cliTest.installed = { claude: false, codex: false }
    await refreshCli()
    ok(!groupTools('agents').includes('delegate_coding') && groupTools('agents').includes('spawn_agent'), 'with no coding agent installed delegate_coding is not offered (helpers still are)')
    delete cliTest.installed; delete cliTest.command
    await refreshCli()
  }

  // ---- 5. the voice ladder's decisions (the socket cases are in live/selfcheck.ts) -----------------------------------------------------------------
  {
    ok(salvageKind({ typed: false, text: '', audioBytes: 32 * 2000 }) === 'audio' && salvageKind({ typed: true, text: 'open chrome', audioBytes: 0 }) === 'text' && salvageKind({ typed: false, text: '', audioBytes: 32 * 100 }) === 'none', 'a push-to-talk turn is salvaged from its audio, a typed one from its text, a tap is not salvaged')
    ok(rungOf({ liveDown: false, usingAlternate: false, viaAudio: false, speak: true }) === 'live' && rungOf({ liveDown: false, usingAlternate: true, viaAudio: false, speak: true }) === 'live-alt' && rungOf({ liveDown: true, usingAlternate: false, viaAudio: true, speak: false }) === 'cascade' && rungOf({ liveDown: true, usingAlternate: false, viaAudio: false, speak: true }) === 'spoken-text' && rungOf({ liveDown: true, usingAlternate: false, viaAudio: false, speak: false }) === 'text', 'the rungs: live, live on another id, cascade, text, text + spoken')
    ok(speakable('**Done.** See https://x.test/a `code` now') === 'Done. See link code now' && speakable('word. '.repeat(200)).length <= 503, 'spoken text has no markup or links and a sensible length')
  }

  // ---- 6. the models feed ---------------------------------------------------------------------------------------------------------------------
  {
    const list = [cfg('gemini-flash', { name: 'Gemini Flash', keyRef: 'gemini', keyRefs: ['gemini'], roles: ['main', 'transcribe', 'search'] }), cfg('openrouter', { name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', enabled: false, keyRef: 'openrouter', keyRefs: ['openrouter'] })]
    const r = rig(list, {}, { gemini: 'AIzaSyA_abcdefghijklmnopqrstuvwxyz012345' })
    let preset: 'quality' | 'fast' | 'save' = 'quality', offline = true
    const secrets: Record<string, string> = { gemini: 'AIzaSyA_abcdefghijklmnopqrstuvwxyz012345' }
    const svc = new ModelsService({
      gw: r.g, cfg: () => list, setProviders: l => { list.splice(0, list.length, ...l) },
      getSecret: ref => secrets[ref] ?? null, setSecret: (ref, v) => { secrets[ref] = v; r.keys[ref] = v; return true }, clearSecret: ref => { delete secrets[ref]; delete r.keys[ref] },
      preset: () => preset, offlineLocal: () => offline, setPreset: p => { preset = p }, setOfflineLocal: b => { offline = b },
      voice: () => ({ rung: 'live', model: 'live-x' }),
      discover: async a => (a.family === 'openrouter' ? { model: 'vendor/model:free', caps: { tools: true } } : null),
    })
    const s0 = svc.status()
    ok(s0.mode === 'online' && s0.using?.label === 'Gemini Flash' && s0.backups === 0 && s0.providers[0].keys[0].hint === '2345' && s0.providers[0].state === 'ok' && s0.providers[1].state === 'off' && s0.preset === 'quality' && s0.offlineLocal === true && s0.voice.rung === 'live', 'models.status: mode, the model in use, backups, key hints (last 4 only), states, preset, voice rung')
    ok(!JSON.stringify(s0).includes('abcdefghijklmnopqrstuvwxyz'), 'the status never contains a key')
    const a1 = await svc.addKey({ family: 'other' as KeyFamily, key: 'AIzaSyB_abcdefghijklmnopqrstuvwxyz999999' })
    ok(a1.ok && a1.ref === 'gemini-2' && list[0].keyRefs?.join() === 'gemini,gemini-2' && !!secrets['gemini-2'], 'addKey: a key starting AIza is a Google key whatever row it was pasted on; the second one is added next to the first')
    const s1 = svc.status()
    ok(s1.providers[0].keys.length === 2 && s1.providers[0].keys.map(k => k.hint).join() === '2345,9999', 'both keys are listed under the provider')
    const a2 = await svc.addKey({ family: 'openrouter', key: 'sk-or-v1-0123456789abcdef' })
    ok(a2.ok && list[1].enabled && list[1].model === 'vendor/model:free' && list[1].caps?.tools === true && list[1].keyRefs?.join() === 'openrouter', 'addKey: OpenRouter is switched on and its model and abilities are discovered')
    const bad = await svc.addKey({ family: 'gemini', key: 'short' })
    ok(!bad.ok && /does not look like a key/.test(bad.error ?? ''), 'a silly key is refused')
    const rm = await svc.removeKey('gemini-2')
    ok(rm.ok && list[0].keyRefs?.join() === 'gemini' && !secrets['gemini-2'], 'removeKey: the key and its secret are gone, the first one stays')
    const rm2 = await svc.removeKey('openrouter')
    ok(rm2.ok && !list[1].enabled && !secrets.openrouter, 'removing the only key of a provider switches it off')
    ok((await svc.test('gemini-flash')).ok && !(await svc.test('nothing')).ok, 'models.test runs one cheap request for a provider or a key, and says no to an unknown target')
    await svc.setPreset('save'); await svc.setOfflineLocal(false)
    ok((preset as string) === 'save' && (offline as boolean) === false, 'setPreset and setOfflineLocal write the settings')
    const sent: ModelsStatus[] = []
    const push = makePusher(s => sent.push(s), () => svc.status(), 500)
    for (let i = 0; i < 20; i++) push()
    await new Promise(res => setTimeout(res, 1200))
    for (let i = 0; i < 20; i++) push()
    await new Promise(res => setTimeout(res, 700))
    ok(sent.length >= 2 && sent.length <= 3, `the feed is throttled (${sent.length} pushes for 40 changes in 2 s)`)
    // a rejected key is shown and not kept
    list[0].keyRefs = ['gemini']
    r.fp['gemini-flash'].down = () => 'auth'
    const rej = await svc.addKey({ family: 'gemini', key: 'AIzaSyC_abcdefghijklmnopqrstuvwxyz777777' })
    ok(!rej.ok && /rejected/.test(rej.error ?? '') && !secrets['gemini-2'] && list[0].keyRefs?.join() === 'gemini', 'addKey tests the key; one the provider rejects is not kept')
  }

  guard.newTurn()
  if (problems.length) throw new Error('failsafe: ' + problems.join(' | '))
  return `failsafe ok (${n} checks; chaos matrix ${chaos.good}/${chaos.cells} cells)`
}
const chaos = { cells: 0, good: 0 }
void (null as unknown as Fault)
