import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrainRole, ProviderConfig } from '@shared/bridge'
import { TOOLS } from '../agent/tools'
import { FaultProvider, type Step } from '../ai/chaos'
import { grandfather } from '../ai/catalog'
import { Gateway } from '../ai/gateway'
import { ADMIT_AT, admitProvider, evalRole, updateAdmitted } from './roleEval'
import { loadFixtures } from './eval'
import samples from '../../../evals/samples/starter-50.json'
import mainCases from '../../../evals/roles/main.json'
import fastCases from '../../../evals/roles/fast.json'
import groundCases from '../../../evals/roles/ground.json'
import embedCases from '../../../evals/roles/embed.json'

// `--selfcheck` for the evals: the 50 starter prompts are well-formed, each role's set scores a good stand-in model high and a bad one
// low, the admission gate keeps an untested model out of main/screen until it passes, and models already set up keep working.
// No key, no network: the "models" are scripted.
const cfg = (id: string, o: Partial<ProviderConfig> = {}): ProviderConfig => ({ id, name: id, kind: 'gemini', baseUrl: '', model: 'm-' + id, enabled: true, keyRef: id, roles: ['main'], dailyLimit: 0, ...o })
const argsFor = (name: string): Record<string, unknown> => {
  const t = TOOLS.find(x => x.name === name)
  const props = ((t?.parameters as { properties?: Record<string, { type?: string; enum?: string[] }> } | undefined)?.properties) ?? {}
  const req = ((t?.parameters as { required?: string[] } | undefined)?.required) ?? []
  return Object.fromEntries(req.map(k => [k, props[k]?.enum?.[0] ?? (props[k]?.type === 'NUMBER' ? 1 : props[k]?.type === 'ARRAY' ? [{ tool: 'open_app', args: { name: 'x' } }] : 'x')]))
}
const done: Step = { fault: 'ok', text: 'done' }
const TOPIC: [RegExp, number][] = [[/dark/i, 0], [/priya/i, 1], [/coffee/i, 2], [/tax/i, 3], [/lokey/i, 4], [/piano/i, 5]]

export async function roleSelfCheck(): Promise<string> {
  let n = 0
  const ok = (c: boolean, m: string) => { if (!c) throw new Error('roles: ' + m); n++ }

  // ---- the 50 starter prompts -----------------------------------------------------------------------------------------------------------------
  const names = new Set(TOOLS.map(t => t.name))
  const s = samples as { request: string; expectedTools: string[]; forbiddenTools: string[]; lang: string }[]
  ok(s.length === 50 && new Set(s.map(x => x.request)).size === 50, '50 distinct starter prompts')
  ok(s.every(x => x.expectedTools.length && x.expectedTools.every(t => names.has(t)) && x.forbiddenTools.every(t => names.has(t)) && !x.expectedTools.some(t => x.forbiddenTools.includes(t))), 'every expected and forbidden tool exists and they do not overlap')
  ok(['en', 'ta', 'tanglish'].every(l => s.some(x => x.lang === l)) && s.filter(x => x.lang !== 'en').length >= 8, 'English, Tamil and Tanglish are all in the set')
  const dir = mkdtempSync(join(tmpdir(), 'lokey-evals-'))
  try {
    mkdirSync(join(dir, 'samples')); mkdirSync(join(dir, 'private'))
    const one = (r: string) => JSON.stringify({ request: r, expectedTools: ['open_app'] })
    writeFileSync(join(dir, 'a.json'), one('a')); writeFileSync(join(dir, 'samples', 'b.json'), one('b')); writeFileSync(join(dir, 'private', 'c.json'), one('c')); writeFileSync(join(dir, 'private', 'bad.json'), '{ nope')
    ok(loadFixtures(dir).map(f => f.request).sort().join() === 'a,b,c', 'fixtures load from the folder, samples/ and the private/ folder; a damaged file is skipped')
  } finally { rmSync(dir, { recursive: true, force: true }) }

  // ---- per-role scores: a good stand-in model and a bad one -------------------------------------------------------------------------------------
  const one = (fp: FaultProvider, role: BrainRole, extra: Partial<ProviderConfig> = {}) => new Gateway(() => [cfg(fp.id, { roles: [role], ...extra })], () => 'k', { db: null, build: () => fp })
  {
    const cases = (mainCases as { expectedTools: string[] }[]).slice(0, 8)
    const good = new FaultProvider('good', cases.flatMap(c => [...c.expectedTools.map((t): Step => ({ fault: 'ok', tool: { name: t, args: argsFor(t) } })), done]))
    const bad = new FaultProvider('bad', cases.flatMap((): Step[] => [{ fault: 'ok', tool: { name: 'power', args: { action: 'shutdown' } } }, done]))
    const g = await evalRole(one(good, 'main'), 'main', { limit: 8 }), b = await evalRole(one(bad, 'main'), 'main', { limit: 8 })
    ok(g.total === 8 && g.score === 1 && b.score === 0 && b.failures.some(f => /missing open_app/.test(f)), 'main: a model that picks the right tools scores 100%, one that never does what was asked scores 0% and is told why')
  }
  {
    const good = new FaultProvider('good', (fastCases as { expectJson: Record<string, unknown> }[]).map((c): Step => ({ fault: 'ok', text: JSON.stringify(Object.fromEntries(Object.entries(c.expectJson).map(([k, v]) => [k, v === 'array' ? ['x'] : v]))) })))
    const bad = new FaultProvider('bad', Array.from({ length: 12 }, (): Step => ({ fault: 'ok', text: 'I am not sure.' })))
    const g = await evalRole(one(good, 'fast'), 'fast'), b = await evalRole(one(bad, 'fast'), 'fast')
    ok(g.score === 1 && b.score === 0, 'fast: valid JSON with the right values scores 100%, prose scores 0%')
  }
  {
    const cases = groundCases as { expectId: number }[]
    const good = new FaultProvider('good', cases.map((c): Step => ({ fault: 'ok', tool: { name: 'computer', args: { action: 'click', id: c.expectId } } })))
    const bad = new FaultProvider('bad', cases.map((): Step => ({ fault: 'ok', tool: { name: 'computer', args: { action: 'click', x: 10, y: 10 } } })))
    const g = await evalRole(one(good, 'ground'), 'ground'), b = await evalRole(one(bad, 'ground'), 'ground')
    ok(g.score === 1 && b.score === 0, 'ground: choosing the right element number scores 100%, pointing by pixels scores 0%')
  }
  {
    class Embedder extends FaultProvider {
      constructor(id: string, private good: boolean) { super(id) }
      override async embed(texts: string[]) {
        return { vectors: texts.map((t, i) => { const v = new Array(8).fill(0); const k = this.good ? (TOPIC.find(([re]) => re.test(t))?.[1] ?? 7) : i % 8; v[k] = 1; return v }), usage: { in: 1, out: 0, cached: 0 } }
      }
    }
    const g = await evalRole(one(new Embedder('good', true), 'embed', { model: 'embed-1' }), 'embed'), b = await evalRole(one(new Embedder('bad', false), 'embed', { model: 'embed-1' }), 'embed')
    ok(g.total === (embedCases as unknown[]).length && g.score === 1 && b.score < 1, 'embed: related texts closer than unrelated ones scores 100%, scrambled vectors do not')
    const t = await evalRole(one(new FaultProvider('t'), 'transcribe'), 'transcribe')
    ok(!!t.skipped && t.total === 0, 'dictation and web search are not scored (they need audio and the internet)')
  }

  // ---- admission ----------------------------------------------------------------------------------------------------------------------------------------
  {
    const c = cfg('custom-x', { roles: ['main'] })
    const cases = (mainCases as { expectedTools: string[] }[]).slice(0, 8)
    const goodScript = () => cases.flatMap(x => [...x.expectedTools.map((t): Step => ({ fault: 'ok', tool: { name: t, args: argsFor(t) } })), done])
    const pass = await admitProvider(c, () => 'k', { db: null, build: () => new FaultProvider('custom-x', goodScript()) })
    const fail = await admitProvider(c, () => 'k', { db: null, build: () => new FaultProvider('custom-x', cases.flatMap((): Step[] => [call('power'), done])) })
    ok(pass[0].role === 'main' && pass[0].admitted && pass[0].score >= ADMIT_AT && !fail[0].admitted && fail[0].score < ADMIT_AT, `a model must reach ${ADMIT_AT * 100}% to be admitted`)
    ok(updateAdmitted([], c, pass).join() === 'custom-x|m-custom-x|main' && updateAdmitted(['custom-x|m-custom-x|main'], c, fail).length === 0 && updateAdmitted(['a'], c, [{ role: 'fast', score: 0, admitted: false }]).join() === 'a', 'passing adds the entry, failing removes it, other roles do not change it')

    let admitted: string[] = []
    const mk = (providers: ProviderConfig[]) => new Gateway(() => providers, () => 'k', { db: null, admission: () => true, admitted: () => admitted, build: p => new FaultProvider(p.id) })
    const g = mk([c, cfg('custom-x', { id: 'f', roles: ['fast'] }), { ...cfg('gemini-flash'), model: 'gemini-flash-latest' }])
    ok(g.candidates('main').map(x => x.id).join() === 'gemini-flash,custom-x,f', 'the gate: an untested model comes AFTER the tested ones but is never kept out (it is the last resort when they fail); a model ticked for another role stands in last')
    ok(g.candidates('fast').map(x => x.id).join() === 'f,custom-x,gemini-flash', 'the gate does not touch the other roles (an untested model may still do cheap jobs)')
    admitted = ['custom-x|m-custom-x|main']
    ok(g.candidates('main').map(x => x.id).join() === 'custom-x,gemini-flash,f', 'once it has passed, it serves the role in the person\'s order')
    ok(g.status().providers.find(p => p.id === 'custom-x')!.note === '', 'and no longer carries the "not tested" note')
    admitted = []
    ok(/not tested/.test(g.status().providers.find(p => p.id === 'custom-x')!.note), 'an untested model says what to do')
    const off = new Gateway(() => [c], () => 'k', { db: null, build: p => new FaultProvider(p.id) })
    ok(off.candidates('main').length === 1, 'with the gate off (tests, or the setting switched off) everything is allowed')
    const old = [cfg('a', { roles: ['main', 'ground', 'fast'] }), cfg('b', { enabled: false, roles: ['main'] }), cfg('c', { model: '', roles: ['main'] })]
    ok(grandfather(old, ['z']).sort().join() === 'a|m-a|ground,a|m-a|main,z', 'models already set up are admitted by the upgrade, so nothing stops working')
  }
  // ---- a provider with no model name, and the reasons a role has nothing to use ----------------------------------------------------------------------
  {
    const { createServer } = await import('node:http')
    const srv = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'llama-a' }, { id: 'llama-b' }] })) })
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
    try {
      const base = `http://127.0.0.1:${(srv.address() as import('node:net').AddressInfo).port}/v1`
      const empty = cfg('freellmapi', { kind: 'openai', baseUrl: base, model: '', roles: ['fast', 'main'] })
      const g = new Gateway(() => [empty], () => null, { db: null, build: p => new FaultProvider(p.id) })
      ok(g.candidates('main').length === 0 && /no model name/.test(g.status().providers[0].note), 'a provider with an empty model name is skipped, and Settings says why')
      let err: { kind?: string; message?: string } | null = null
      try { await g.call('main', { system: 's', messages: [{ role: 'user', text: 'x' }] }) } catch (e) { err = e as { kind?: string; message?: string } }
      ok(err?.kind === 'NO_PROVIDER' && /FreeLLMAPI|freellmapi/i.test(err.message ?? '') && /no model name/.test(err.message ?? ''), 'the error names the provider and the reason')
      ok(g.traces({ failed: true }).some(t => t.kind === 'NO_PROVIDER' && t.role === 'main'), 'a call that could not even start leaves a trace row')
      const t = await g.test('freellmapi')
      ok(!t.ok && /This server offers: llama-a, llama-b/.test(t.error ?? ''), 'Test on it lists the models the server offers')
      const nokey = new Gateway(() => [cfg('gemini-flash', { roles: ['transcribe'] })], () => null, { db: null })
      let e2: { message?: string } | null = null
      try { await nokey.call('transcribe', { system: 's', messages: [{ role: 'user', text: 'x' }] }) } catch (e) { e2 = e as { message?: string } }
      ok(/no key saved/.test(e2?.message ?? ''), 'a missing key is named in the error')
    } finally { srv.close() }
  }
  // ---- what the live run found: an error is not a failed probe, and a spent search quota is not a spent chat quota ----------------------------------------------------
  {
    const c = cfg('gem', { roles: ['main', 'search'] })
    const fp = new FaultProvider('gem', ['overloaded', 'ok', { fault: 'ok', tool: { name: 'probe_echo', args: { word: 'ok' } } }])
    const g = new Gateway(() => [c], () => 'k', { db: null, build: () => fp })
    ok((await g.probe(c)) === null && g.candidates('main').length === 1, 'a probe that hit "overloaded" is inconclusive: the model is not marked as unable to call tools')
    ok((await g.probe(c)) === false && g.candidates('main').length === 0, 'a model that answers without calling the tool does fail the probe')
    ok((await g.probe(c)) === true && g.candidates('main').length === 1, 'and passes once it calls the tool')
    const fp2 = new FaultProvider('gem', ['quota_day'])
    const g2 = new Gateway(() => [c], () => 'k', { db: null, build: () => fp2 })
    let e: unknown = null
    try { await g2.search('x') } catch (x) { e = x }
    ok(!!e && g2.candidates('main').length === 1 && g2.candidates('search').length === 0, 'a spent daily SEARCH quota switches off search only; chat on the same model keeps working')
  }
  return `roles ok (${n} checks)`
}
const call = (name: string): Step => ({ fault: 'ok', tool: { name, args: argsFor(name) } })
