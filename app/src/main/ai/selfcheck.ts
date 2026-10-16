import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProviderConfig } from '@shared/bridge'
import type { FunctionDecl } from '../agent/session'
import { BrainStore } from '../brain/memory/store'
import type { ChatRequest } from '../brain/types'
import { FaultProvider, type Step } from './chaos'
import { getDb, migrateLegacy, openDb, readDoc, setDb, writeDoc } from './db'
import { AiError, classifyHttp, nextMidnight, parseDuration } from './errors'
import { Gateway } from './gateway'
import { parseResponse as parseGemini } from './adapters/gemini'
import { parseOpenAi } from './adapters/openai'

// `--selfcheck` for the gateway: chaos (a scripted FaultProvider plays 429s, 5xx, timeouts, malformed tool calls... and the
// gateway must answer each as the plan says), quota and breaker bookkeeping, the capability filter, the classifiers against
// realistic provider bodies, and the old-JSON-to-database migration on a fixture. No network, no key, no real data folder.
const T0 = Date.parse('2026-10-15T12:00:00Z')
const cfg = (id: string, o: Partial<ProviderConfig> = {}): ProviderConfig => ({ id, name: id, kind: 'gemini', baseUrl: 'http://' + id + '.test', model: 'm-' + id, enabled: true, keyRef: id, roles: ['main'], dailyLimit: 0, ...o })
const ECHO = { name: 'echo', description: 'echo', parameters: { type: 'OBJECT', properties: { a: { type: 'STRING' } }, required: ['a'] } } as FunctionDecl
const req = (extra: Partial<ChatRequest> = {}): ChatRequest => ({ system: 's', messages: [{ role: 'user', text: 'x' }], ...extra })

function rig(cfgs: ProviderConfig[], scripts: Record<string, Step[]> = {}) {
  const fp = Object.fromEntries(cfgs.map(c => [c.id, new FaultProvider(c.id, scripts[c.id] ?? [], c.model, c.name, c.kind)]))
  const slept: number[] = [], logs: string[] = []
  const t = { now: T0 }
  const keys: Record<string, string> = Object.fromEntries(cfgs.map(c => [c.keyRef, 'k']))
  const db = openDb(':memory:')
  const g = new Gateway(() => cfgs, ref => keys[ref] ?? null, { db, build: c => fp[c.id], sleep: async ms => { slept.push(ms); t.now += ms }, now: () => t.now, rand: () => 0, log: m => logs.push(m) })
  return { g, fp, slept, logs, t, keys, db }
}
const fails = async (p: Promise<unknown>): Promise<AiError | null> => { try { await p } catch (e) { return e instanceof AiError ? e : new AiError('BAD_REQUEST', String(e)) } return null }

export async function aiSelfCheck(): Promise<string> {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('ai: ' + m) }
  let n = 0
  const ok = (c: boolean, m: string) => { need(c, m); n++ }

  // ---- the database: SQLite from Node itself, WAL, FTS5 -----------------------------------------------------------------------
  const d0 = openDb(':memory:')
  ok(!!d0, 'node:sqlite is available')
  d0!.exec("create virtual table f using fts5(t); insert into f values('buy milk tomorrow'); insert into f values('call amma')")
  ok(d0!.all("select t from f where f match 'milk'").length === 1, 'FTS5 full-text search works')
  const tmp = mkdtempSync(join(tmpdir(), 'lokey-ai-'))
  try {
    const fdb = openDb(join(tmp, 'x.db'))!
    ok(String(fdb.get<{ journal_mode: string }>('pragma journal_mode')?.journal_mode).toLowerCase() === 'wal', 'the file database runs in WAL mode')
    fdb.close()

    // ---- classifiers, against realistic bodies -------------------------------------------------------------------------------
    const gem = (status: number, error: object, headers: Record<string, string> = {}) => classifyHttp({ provider: 'gemini', status, body: JSON.stringify({ error }), headers, now: T0 })
    const perDay = gem(429, { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] })
    ok(perDay.kind === 'QUOTA_DAY' && (perDay.resetAt ?? 0) > T0 && (perDay.resetAt ?? 0) <= T0 + 25 * 3_600_000, 'Gemini per-day 429 is QUOTA_DAY with a reset time within a day')
    const perMin = gem(429, { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Please retry in 34.2s', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '34s' }] })
    ok(perMin.kind === 'RATE_MINUTE' && perMin.retryAfterMs === 34_000, 'Gemini per-minute 429 is RATE_MINUTE with its retryDelay')
    const groq = classifyHttp({ provider: 'openai', status: 429, body: '{"error":{"message":"Rate limit reached for model x in organization y on tokens per day (TPD): Limit 100000, Used 99990.","type":"tokens","code":"rate_limit_exceeded"}}', headers: { 'retry-after': '3600' }, now: T0 })
    ok(groq.kind === 'QUOTA_DAY', 'Groq tokens-per-day 429 is QUOTA_DAY')
    const orDay = classifyHttp({ provider: 'openai', status: 429, body: '{"error":{"message":"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock more","code":429}}', headers: { 'x-ratelimit-reset': String(T0 + 5 * 3_600_000) }, now: T0 })
    ok(orDay.kind === 'QUOTA_DAY' && orDay.resetAt === T0 + 5 * 3_600_000, 'OpenRouter free-models-per-day uses the reset header')
    ok(classifyHttp({ provider: 'openai', status: 429, body: '{"error":{"message":"slow down"}}', headers: { 'retry-after': '7' } }).retryAfterMs === 7000, 'Retry-After seconds are honoured')
    ok(classifyHttp({ provider: 'openai', status: 429, body: '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}' }).kind === 'QUOTA_DAY', 'insufficient_quota is a spent quota')
    ok(classifyHttp({ provider: 'gemini', status: 400, body: '{"error":{"status":"INVALID_ARGUMENT","message":"API key not valid. Please pass a valid API key.","details":[{"reason":"API_KEY_INVALID"}]}}' }).kind === 'AUTH', 'Gemini invalid key (400) is AUTH')
    ok(['401:AUTH', '403:AUTH', '500:OVERLOADED', '503:OVERLOADED', '529:OVERLOADED', '408:TIMEOUT', '404:BAD_REQUEST', '422:BAD_REQUEST', '413:CONTEXT_OVERFLOW'].every(s => classifyHttp({ provider: 'openai', status: Number(s.split(':')[0]), body: '{}' }).kind === s.split(':')[1]), 'status codes map to kinds')
    ok(classifyHttp({ provider: 'openai', status: 400, body: '{"error":{"message":"This model\'s maximum context length is 8192 tokens"}}' }).kind === 'CONTEXT_OVERFLOW', 'context length error')
    ok(parseDuration('2m59.56s') === 179_560 && parseDuration('250ms') === 250 && parseDuration('45') === 45_000 && parseDuration('x') === undefined, 'durations')
    const mid = nextMidnight(Date.parse('2026-10-15T20:00:00Z'), 'America/Los_Angeles')
    ok(mid > Date.parse('2026-10-15T20:00:00Z') && mid - Date.parse('2026-10-15T20:00:00Z') <= 24 * 3_600_000, 'next Pacific midnight')

    // ---- adapters: what finish reasons and broken tool calls look like on the wire ---------------------------------------------------
    const gp = (c: object, extra: object = {}) => parseGemini({ candidates: [c], ...extra }, 'g', 'm')
    ok(gp({ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'x' }] } }).finish === 'length' && gp({ finishReason: 'RECITATION' }).finish === 'recitation' && gp({ finishReason: 'SAFETY' }).finish === 'safety' && gp({ finishReason: 'MALFORMED_FUNCTION_CALL' }).finish === 'malformed', 'Gemini finish reasons map to finish values')
    ok(parseGemini({ promptFeedback: { blockReason: 'SAFETY' } }, 'g', 'm').finish === 'safety', 'Gemini prompt block with no candidate is a safety finish')
    const oa = parseOpenAi({ choices: [{ finish_reason: 'length', message: { content: 'x', tool_calls: [{ id: '1', function: { name: 'echo', arguments: '{bad' } }] } }] }, 'p', 'm')
    ok(oa.finish === 'length' && /not valid JSON/.test(oa.malformed ?? ''), 'OpenAI-style: unparseable tool arguments are flagged, not silently emptied')

    // ---- chaos: each fault, and what the gateway does about it ---------------------------------------------------------------
    {   // a daily-quota 429 is not retried, marks the provider exhausted until the reset, and the next one answers
      const r = rig([cfg('A'), cfg('B')], { A: ['quota_day'] })
      const a = await r.g.call('main', req())
      ok(a.provider === 'B' && r.fp.A.calls === 1, 'QUOTA_DAY: not retried, next provider answers')
      await r.g.call('main', req())
      ok(r.fp.A.calls === 1 && r.g.candidates('main').map(c => c.id).join() === 'B', 'QUOTA_DAY: the exhausted provider is not asked again today')
      const st = r.g.status().providers.find(p => p.id === 'A')!
      ok((st.exhaustedUntil ?? 0) > r.t.now && /daily limit/.test(st.note), 'QUOTA_DAY: status shows the reset time')
      r.t.now = st.exhaustedUntil! + 1000
      ok(r.g.candidates('main').some(c => c.id === 'A'), 'QUOTA_DAY: it comes back after the reset')
      const only = rig([cfg('A')], { A: ['quota_day'] })
      const e = await fails(only.g.call('main', req()))
      ok(e?.kind === 'QUOTA_DAY' && /daily limit/.test(e.message), 'QUOTA_DAY on the only provider ends with a clear message')
      // exhaustion survives a restart (a second gateway on the same database)
      only.g.flush()
      const again = new Gateway(() => [cfg('A')], () => 'k', { db: only.db, build: () => new FaultProvider('A'), now: () => only.t.now })
      ok(again.candidates('main').length === 0, 'QUOTA_DAY: exhaustion persists in lokey.db')
    }
    {   // a per-minute 429 waits for Retry-After (when short) and retries the same model
      const r = rig([cfg('A'), cfg('B')], { A: [{ fault: 'rate_minute', retryAfterSec: 2 }] })
      const a = await r.g.call('main', req())
      ok(a.provider === 'A' && r.fp.A.calls === 2 && r.slept.length === 1 && r.slept[0] >= 2000 && r.slept[0] < 2300, 'RATE_MINUTE (2 s): waits Retry-After, retries the same model')
      const r2 = rig([cfg('A'), cfg('B')], { A: [{ fault: 'rate_minute', retryAfterSec: 40 }] })
      const b = await r2.g.call('main', req())
      ok(b.provider === 'B' && r2.fp.A.calls === 1 && r2.slept.length === 0 && r2.g.candidates('main').map(c => c.id).join() === 'B', 'RATE_MINUTE (40 s): no waiting, next model, the first rests')
    }
    {   // 5xx: one jittered retry, then the next
      const r = rig([cfg('A'), cfg('B')], { A: ['overloaded', 'overloaded'] })
      ok((await r.g.call('main', req())).provider === 'B' && r.fp.A.calls === 2, 'OVERLOADED: one retry, then the next model')
      const r2 = rig([cfg('A'), cfg('B')], { A: ['overloaded'] })
      ok((await r2.g.call('main', req())).provider === 'A' && r2.fp.A.calls === 2, 'OVERLOADED: a retry that works stays on the same model')
      const r3 = rig([cfg('A'), cfg('B')], { A: ['network', 'network'] })
      ok((await r3.g.call('main', req())).provider === 'B' && r3.fp.A.calls === 2, 'NETWORK: one retry, then the next model')
    }
    {   // timeouts (a scripted one, and a real hang cut by the deadline) move on and cost the model a penalty
      const r = rig([cfg('A'), cfg('B')], { A: ['timeout'] })
      ok((await r.g.call('main', req())).provider === 'B' && r.g.health.score('A') > 0, 'TIMEOUT: next model, a penalty')
      const h = rig([cfg('A'), cfg('B')], { A: ['hang'] })
      const t0 = Date.now()
      const a = await h.g.call('main', req(), { deadlineMs: 60 })
      ok(a.provider === 'B' && Date.now() - t0 < 3000 && h.g.traces({ failed: true })[0]?.kind === 'TIMEOUT', 'a hung request is cut at its deadline and traced as TIMEOUT')
    }
    {   // malformed tool calls: repair once (the hint reaches the model), then the next model; invented tools are worse
      const r = rig([cfg('A'), cfg('B')], { A: ['malformed_json'] })
      const a = await r.g.call('main', req({ tools: [ECHO] }))
      ok(a.provider === 'A' && r.fp.A.calls === 2 && /rejected/.test(r.fp.A.seen[1].system) && r.g.health.score('A') >= 1, 'MALFORMED_TOOL: repaired once with the error in the prompt, penalty +1')
      const r2 = rig([cfg('A'), cfg('B')], { A: ['invented_tool', 'invented_tool'] })
      ok((await r2.g.call('main', req({ tools: [ECHO] }))).provider === 'B' && r2.g.health.score('A') >= 4, 'MALFORMED_TOOL: an invented tool twice moves on, penalty +2 each')
      const r3 = rig([cfg('A'), cfg('B')], { A: [{ fault: 'missing_arg', tool: { name: 'echo', args: {} } }, { fault: 'ok', tool: { name: 'echo', args: { a: 'hi' } } }] })
      const c = await r3.g.call('main', req({ tools: [ECHO] }))
      ok(c.provider === 'A' && c.toolCalls[0].args.a === 'hi', 'MALFORMED_TOOL: a missing required argument is repaired')
      const r4 = rig([cfg('A')], { A: [{ fault: 'ok', tool: { name: 'hidden', args: {} } }] })
      ok((await r4.g.call('main', req({ tools: [ECHO], knownTools: ['hidden'] }))).toolCalls[0].name === 'hidden', 'a tool that exists but is switched off is passed on for the loop to refuse')
    }
    {   // empty replies: one retry, then the next
      const r = rig([cfg('A'), cfg('B')], { A: ['empty', 'empty'] })
      ok((await r.g.call('main', req())).provider === 'B' && r.fp.A.calls === 2, 'EMPTY: one retry, then the next model')
      const r2 = rig([cfg('A')], { A: ['empty'] })
      ok((await r2.g.call('main', req(), { allowEmpty: true })).text === '' && r2.fp.A.calls === 1, 'allowEmpty: silence is a valid transcription')
    }
    {   // truncated: ask again with more room; if still cut, accept what there is
      const r = rig([cfg('A')], { A: ['truncated'] })
      const a = await r.g.call('main', req({ maxTokens: 100 }))
      ok(a.text === 'from A' && r.fp.A.seen[1].maxTokens === 200, 'TRUNCATED: asks again with twice the output room')
      const r2 = rig([cfg('A')], { A: ['truncated', 'truncated'] })
      ok((await r2.g.call('main', req({ maxTokens: 100 }))).text === 'a cut-off sen' && r2.fp.A.calls === 2, 'TRUNCATED twice: the partial answer is used, not an error')
    }
    {   // a stream that drops after the first chunk: partial output discarded, the next model starts over
      const r = rig([cfg('A'), cfg('B')], { A: ['stream_drop'] })
      const a = await r.g.call('main', req({ onText: () => undefined }))
      ok(a.provider === 'B' && a.text === 'from B' && r.g.traces({ failed: true })[0]?.kind === 'STREAM_DROP', 'STREAM_DROP: the next model answers, the partial text is not the result')
    }
    {   // safety blocks: tried on one more provider, then reported
      const r = rig([cfg('A'), cfg('B')], { A: ['safety'] })
      ok((await r.g.call('main', req())).provider === 'B', 'SAFETY_BLOCK: one other provider may answer')
      const r2 = rig([cfg('A'), cfg('B'), cfg('C')], { A: ['safety'], B: ['safety'] })
      const e = await fails(r2.g.call('main', req()))
      ok(e?.kind === 'SAFETY_BLOCK' && r2.fp.C.calls === 0, 'SAFETY_BLOCK: after two refusals it stops and tells the person')
      const r3 = rig([cfg('A')], { A: ['recitation'] })
      ok((await r3.g.call('main', req())).provider === 'A' && r3.fp.A.seen[1].temperature === 0.9 && /own words/.test(r3.fp.A.seen[1].system), 'RECITATION: retried once, warmer, with a hint')
    }
    {   // the person's stop is not a failure
      const r = rig([cfg('A'), cfg('B')], { A: ['hang'] })
      const ctl = new AbortController()
      const p = r.g.call('main', req({ signal: ctl.signal }))
      setTimeout(() => ctl.abort(), 20)
      const e = await fails(p)
      ok(e?.kind === 'ABORTED' && r.fp.B.calls === 0 && r.g.traces().length === 0 && r.g.health.info('A').demerits === 0 && (r.g.getUsage().A?.errors ?? 0) === 0, 'ABORTED: no fallback, no failure recorded')
    }
    {   // bad requests and auth
      const r = rig([cfg('A'), cfg('B')], { A: ['bad_request'] })
      ok((await r.g.call('main', req())).provider === 'B' && r.fp.A.calls === 1, 'BAD_REQUEST: not retried on the same model')
      const r2 = rig([cfg('A'), cfg('B')], { A: ['auth'] })
      await r2.g.call('main', req()); await r2.g.call('main', req())
      ok(r2.fp.A.calls === 1 && /rejected/.test(r2.g.status().providers[0].note), 'AUTH: a rejected key switches the provider off')
      r2.keys.A = 'a-new-key'
      ok(r2.g.candidates('main').some(c => c.id === 'A'), 'AUTH: a different key switches it back on')
    }
    {   // everything failing: the last error comes out, with the chain in the trace and a log line per failure
      const r = rig([cfg('A'), cfg('B')], { A: ['bad_request'], B: ['overloaded', 'overloaded'] })
      const e = await fails(r.g.call('main', req()))
      ok(!!e && r.logs.length === 3 && /provider=B/.test(r.logs[2]) && /A:BAD_REQUEST/.test(r.g.traces()[0].chain), 'a failed call logs each attempt and keeps the fallback chain')
      const none = await fails(rig([], {}).g.call('main', req()))
      ok(none?.kind === 'NO_PROVIDER' && /Settings > Brain/.test(none.message), 'no provider: a clear NO_PROVIDER error')
    }

    // ---- circuit breaker ---------------------------------------------------------------------------------------------------
    {
      const r = rig([cfg('A'), cfg('B')])
      for (let i = 0; i < 3; i++) r.g.health.fail('A', 'x')
      ok(r.g.health.state('A') === 'open' && r.g.candidates('main').map(c => c.id).join() === 'B', 'breaker: 3 failures in a row open it')
      r.t.now += 31_000
      ok(r.g.health.state('A') === 'half' && r.g.candidates('main').some(c => c.id === 'A'), 'breaker: half-open after the 30 s cooldown')
      r.g.health.begin('A')
      ok(!r.g.health.allow('A'), 'breaker: only one trial request in half-open')
      r.g.health.fail('A', 'again')
      const left = r.g.health.openUntil('A') - r.t.now
      ok(r.g.health.state('A') === 'open' && left > 55_000 && left <= 60_000, 'breaker: a failed trial reopens it for longer (60 s)')
      r.t.now += 61_000; r.g.health.begin('A'); r.g.health.ok('A', 20)
      ok(r.g.health.state('A') === 'closed', 'breaker: a good trial closes it')
      // all candidates open: exactly one attempt, at the one that comes back soonest
      const o = rig([cfg('A'), cfg('B')], { A: ['overloaded'], B: ['overloaded'] })
      for (const id of ['A', 'B']) for (let i = 0; i < 3; i++) o.g.health.fail(id, 'x')
      o.t.now += 5000; o.g.health.fail('B', 'x')  // B tripped a bit later -> A reopens first
      const e = await fails(o.g.call('main', req()))
      ok(o.fp.A.calls === 1 && o.fp.B.calls === 1 && !!e && e.until !== undefined, 'all candidates open: each is tried once as a last resort, the one that comes back soonest first, and the error says when to try again')
      // demerits sink a model below healthy ones and rest it from main at 10
      const p = rig([cfg('A'), cfg('B')])
      p.g.health.penalize('A', 5, 'bad calls')
      ok(p.g.candidates('main').map(c => c.id).join() === 'B,A', 'penalties: 5 demerits sink A below B')
      p.g.health.penalize('A', 5, 'bad calls')
      ok(p.g.candidates('main').map(c => c.id).join() === 'B' , 'penalties: 10 demerits rest it from main')
      p.t.now += 48 * 3_600_000
      ok(p.g.health.score('A') < 3 && p.g.candidates('main').length === 2, 'penalties: demerits decay (24 h half-life)')
    }

    // ---- quota ledger ------------------------------------------------------------------------------------------------------
    {
      const r = rig([cfg('A', { dailyLimit: 2 }), cfg('B')])
      for (let i = 0; i < 3; i++) await r.g.call('main', req())
      ok(r.fp.A.calls === 2 && r.fp.B.calls === 1, 'daily limit: the third call skips the spent provider before sending')
      const bg = rig([cfg('A', { dailyLimit: 10 })])
      let done = 0
      for (let i = 0; i < 6; i++) { if (!(await fails(bg.g.call('main', req(), { background: true })))) done++ }
      ok(done === 3, 'background work gets 30% of a known daily budget (3 of 10)')
      for (let i = 0; i < 7; i++) await bg.g.call('main', req())
      ok(bg.fp.A.calls === 10 && !!(await fails(bg.g.call('main', req()))), 'the rest of the budget stays for foreground calls, and a spent day stops them')
      const m = rig([cfg('A', { rpm: 4 })])
      let sent = 0
      for (let i = 0; i < 5; i++) { if (!(await fails(m.g.call('main', req())))) sent++ }
      ok(sent === 4, 'rpm: the fifth call in a minute is held back')
      m.t.now += 61_000
      ok(!(await fails(m.g.call('main', req()))), 'rpm: the window slides')
      const b2 = rig([cfg('A', { rpm: 10 })])
      let bgDone = 0
      for (let i = 0; i < 10; i++) { if (!(await fails(b2.g.call('main', req(), { background: true })))) bgDone++ }
      ok(bgDone === 7, 'background work leaves 30% of the minute window free')
      const u = rig([cfg('A')])
      await u.g.call('main', req())
      ok(u.g.getUsage().A.requests === 1 && u.g.getUsage().A.in === 10 && u.g.getUsage().A.out === 5, 'tokens are counted')
    }

    // ---- catalog: capabilities and roles -----------------------------------------------------------------------------------
    {
      const r = rig([cfg('T', { kind: 'openai', baseUrl: 'http://x/v1', caps: { tools: false } }), cfg('A')])
      ok(r.g.candidates('main').length === 2, 'a request without tools may use a model without tools')
      await r.g.call('main', req({ tools: [ECHO] }))
      ok(r.fp.T.calls === 0 && r.fp.A.calls === 1, 'a request with tools skips a model that cannot call tools')
      const v = rig([cfg('P', { kind: 'openai', baseUrl: 'http://x/v1', model: 'plain-text-7b' }), cfg('G', { roles: ['vision'] })])
      await v.g.call('vision', req({ messages: [{ role: 'user', text: 'what', images: ['QQ=='] }] }))
      ok(v.fp.P.calls === 0 && v.fp.G.calls === 1, 'an image request goes to a model that can see (vision role, then main)')
      const f = rig([cfg('M', { roles: ['main'] })])
      ok(f.g.candidates('ground').length === 1 && f.g.candidates('heavy').length === 1 && f.g.candidates('fast').length === 1, 'ground, heavy and fast fall back to main when nothing is set for them')
      ok(f.g.candidates('transcribe').length === 1 && f.g.candidates('embed').length === 0, 'transcribe is served by any model that can hear audio (a stand-in); embed never falls back to a chat model')
      ok(rig([cfg('O', { kind: 'openai', baseUrl: 'http://x/v1' })]).g.candidates('transcribe').length === 0, 'a model that cannot hear audio never transcribes')
      const e = rig([cfg('E', { model: 'embed-1', roles: ['embed', 'main'] }), cfg('M')])
      ok(e.g.candidates('main').map(c => c.id).join() === 'M', 'an embedding model never serves chat roles')
      const pr = rig([cfg('A'), cfg('B')], { A: ['ok', 'ok'], B: ['ok', { fault: 'ok', tool: { name: 'probe_echo', args: { word: 'ok' } } }] })
      const ta = await pr.g.test('A'), tb = await pr.g.test('B')
      ok(ta.ok && ta.tools === false && tb.tools === true && pr.g.candidates('main').map(c => c.id).join() === 'B', 'tool-call probe: a model that does not call the tool is kept out of main')
    }

    // ---- the other call kinds: embeddings and search ---------------------------------------------------------------------------
    {
      const r = rig([cfg('E', { model: 'embed-1', roles: ['embed'] }), cfg('S', { roles: ['search'] })])
      const v = await r.g.embed(['a', 'b'], 'doc')
      ok(v?.length === 2 && v[0].length === 8, 'embed: vectors through the embed role')
      const bad = rig([cfg('E', { model: 'embed-1', roles: ['embed'] })], { E: ['quota_day'] })
      ok((await bad.g.embed(['a'])) === null && (await bad.g.embed(['a'])) === null && bad.fp.E.calls === 1, 'embed: a spent quota returns null and is not asked again')
      const s = await r.g.search('weather')
      ok(s.text === 'answer to weather' && s.sources.length === 1, 'search: grounded answer through the search role')
      ok(!!(await fails(rig([cfg('M', { kind: 'openai', baseUrl: 'http://x/v1' })]).g.search('x'))), 'search: no search model is an error, not a fake answer')
    }

    // ---- traces ------------------------------------------------------------------------------------------------------------------
    {
      const r = rig([cfg('A'), cfg('B')], { A: ['overloaded', 'overloaded'] })
      await r.g.call('main', req(), { op: 'loop' })
      const rows = r.g.traces()
      ok(rows.length === 3 && rows[0].ok && rows[0].provider === 'B' && rows[0].chain === 'A:OVERLOADED > A:OVERLOADED' && rows[0].tin === 10, 'traces: one row per attempt, newest first, with the chain')
      ok(r.g.traces({ failed: true }).length === 2 && r.g.traces({ provider: 'B' }).length === 1 && r.g.traces({ role: 'fast' }).length === 0, 'traces: filters')
      ok(rows.every(x => x.op === 'loop') && !('text' in rows[0]), 'traces: the operation is recorded, prompt text is not')
    }

    // ---- migration of the old JSON files ------------------------------------------------------------------------------------------
    {
      const dir = join(tmp, 'old'); const mk = (f: string, v: unknown) => writeFileSync(join(dir, f), typeof v === 'string' ? v : JSON.stringify(v))
      mkdirSync(dir, { recursive: true })
      const brain = { v: 1, facts: [{ id: 'f1', text: 'likes filter coffee', kind: 'fact', entities: [], source: 'chat', importance: 0.6, confidence: 0.8, created: 1, updated: 1, lastSeen: 1 }], entities: [], relations: [], episodes: [], lessons: [], journal: { '2026-10-01': 'a day' }, ops: [], lastReflect: 0, lastLearned: null }
      const convo = { summary: 'asked about trains', turns: [{ at: '2026-10-14T10:00:00Z', via: 'voice', user: 'open chrome', assistant: 'Opening Chrome.' }] }
      const usage = { day: new Date().toDateString(), providers: { 'gemini-flash': { requests: 12, in: 3400, out: 800, errors: 1, last: '2026-10-15T09:00:00Z' } } }
      mk('brain.json', brain); mk('conversation.json', convo); mk('usage.json', usage)
      const db = openDb(join(dir, 'lokey.db'))!
      const rep = migrateLegacy(db, dir)
      ok(rep.migrated.length === 3 && rep.errors.length === 0, 'migration: brain, conversation and usage are imported')
      ok(!existsSync(join(dir, 'brain.json')) && existsSync(join(dir, 'brain.json.migrated')) && JSON.parse(readFileSync(join(dir, 'brain.json.migrated'), 'utf8')).facts[0].id === 'f1', 'migration: the old file is kept as .migrated (the backup)')
      ok(JSON.parse(db.get<{ json: string }>("select json from kv where name = 'brain'")!.json).facts[0].text === 'likes filter coffee', 'migration: the memory is in the database, unchanged')
      ok(db.get<{ requests: number }>('select requests from usage where provider = ?', 'gemini-flash')?.requests === 12, 'migration: today\'s usage is in the ledger')
      ok(migrateLegacy(db, dir).migrated.length === 0, 'migration: running it again changes nothing')
      // the real stores read and write through the database afterwards
      setDb(db)
      try {
        const st = new BrainStore().load()
        ok(st.d.facts.length === 1 && st.d.facts[0].text === 'likes filter coffee' && st.d.journal['2026-10-01'] === 'a day', 'migration: BrainStore reads the migrated memory')
        st.add('drinks tea in the evening'); st.saveNow()
        ok(new BrainStore().load().d.facts.length === 2, 'migration: BrainStore writes back to the database')
        writeDoc('conversation', { summary: 's2', turns: [] }, join(dir, 'conversation.json'))
        ok(readDoc<{ summary: string }>('conversation', join(dir, 'conversation.json'))?.summary === 's2' && !existsSync(join(dir, 'conversation.json')), 'documents go to the database, not back to a file')
      } finally { setDb(null) }
      // damaged and conflicting files are left alone
      const dir2 = join(tmp, 'bad'); mkdirSync(dir2, { recursive: true })
      writeFileSync(join(dir2, 'brain.json'), '{ not json'); writeFileSync(join(dir2, 'conversation.json'), JSON.stringify(convo))
      const db2 = openDb(join(dir2, 'lokey.db'))!
      db2.run("insert into kv(name, json, updated) values('conversation', '{\"summary\":\"newer\",\"turns\":[]}', 1)")
      const rep2 = migrateLegacy(db2, dir2)
      ok(rep2.errors.length === 1 && existsSync(join(dir2, 'brain.json')), 'migration: a damaged file is reported and left as it is')
      ok(rep2.skipped.length === 1 && existsSync(join(dir2, 'conversation.json')) && JSON.parse(db2.get<{ json: string }>("select json from kv where name = 'conversation'")!.json).summary === 'newer', 'migration: a document already in the database is never overwritten')
      db.close(); db2.close()
    }
    ok(getDb() === null, 'the shared database stays off during self-checks (the real data folder is never touched)')
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  return `ai ok (${n} checks)`
}
