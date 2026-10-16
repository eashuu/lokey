import type { BrainRole, ProviderConfig } from '@shared/bridge'
import type { UiTree } from '@shared/protocol'
import { Gateway } from '../ai/gateway'
import { cosine } from './memory/search'
import { replay, type Fixture } from './eval'
import { DECLS, SYSTEM } from './operator'
import { formatTree } from './uia'
import mainCases from '../../../evals/roles/main.json'
import fastCases from '../../../evals/roles/fast.json'
import groundCases from '../../../evals/roles/ground.json'
import embedCases from '../../../evals/roles/embed.json'
import tree from '../../../evals/uia/notepad-save-as.tree.json'

// Per-role, per-model scores (round-9 plan 3.11) and the admission gate: a model you add may serve the main and screen roles only after it
// passes this set with at least ADMIT_AT. Each role has its own small set (app/evals/roles): tool choice for main, valid JSON for fast,
// picking the right element for ground, ordering of related and unrelated texts for embed. Dictation and web search need audio and the
// internet and are not scored here. Calls go through a gateway that holds ONLY the model being tested, so a fallback cannot pass for it.
export const ADMIT_AT = 0.8
export const ADMIT_ROLES: BrainRole[] = ['main', 'ground']
export interface RoleScore { role: BrainRole; provider: string; model: string; total: number; pass: number; score: number; failures: string[]; skipped?: string }

const PIXEL = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='   // a 1x1 picture: grounding is judged on the element list
const embedKey = (a: string, b: string) => `${a}|${b}`

export async function evalRole(g: Gateway, role: BrainRole, o: { limit?: number } = {}): Promise<RoleScore> {
  const c = g.candidatesRaw(role)[0]
  const out: RoleScore = { role, provider: c?.id ?? '', model: c?.model ?? '', total: 0, pass: 0, score: 0, failures: [] }
  const done = (name: string, ok: boolean, why = '') => { out.total++; if (ok) out.pass++; else out.failures.push(why ? `${name}: ${why}` : name) }
  try {
    if (role === 'main') {
      for (const f of (mainCases as Fixture[]).slice(0, o.limit ?? mainCases.length)) {
        try { const s = await replay(f, g); done(f.request, s.pass, s.missing.length ? `missing ${s.missing}` : s.risky.length ? `used ${s.risky}` : '') } catch (e) { done(f.request, false, msg(e)) }
      }
    } else if (role === 'fast') {
      for (const f of fastCases as { system: string; input: string; expectJson: Record<string, unknown> }[]) {
        try {
          const v = await g.callJson('fast', { system: f.system, messages: [{ role: 'user', text: f.input }], temperature: 0, maxTokens: 300 }, { type: 'object', props: {} }) as Record<string, unknown>
          const bad = Object.entries(f.expectJson).find(([k, want]) => (want === 'array' ? !Array.isArray(v[k]) : String(v[k]).toLowerCase() !== String(want).toLowerCase()))
          done(f.input, !bad, bad ? `${bad[0]} was ${JSON.stringify(v[bad[0]])}` : '')
        } catch (e) { done(f.input, false, msg(e)) }
      }
    } else if (role === 'ground' || role === 'vision') {
      for (const f of (groundCases as { goal: string; expectId: number }[]).slice(0, o.limit ?? groundCases.length)) {
        try {
          const r = await g.call(role, { system: SYSTEM, messages: [{ role: 'user', text: `Goal: ${f.goal}\n\nHere is the screen now.\n\n${formatTree(tree as unknown as UiTree)}`, images: [PIXEL] }], tools: DECLS, maxTokens: 300, temperature: 0 }, { op: 'eval' })
          const call = r.toolCalls[0]
          done(f.goal, call?.name === 'computer' && Number(call.args.id) === f.expectId, `chose ${call ? JSON.stringify(call.args) : 'nothing'}, wanted element ${f.expectId}`)
        } catch (e) { done(f.goal, false, msg(e)) }
      }
    } else if (role === 'embed') {
      const pairs = embedCases as { a: string; b: string; related: boolean }[]
      const texts = [...new Set(pairs.flatMap(p => [p.a, p.b]))]
      const vec = await g.embed(texts, 'doc')
      if (!vec) { out.skipped = 'the model returned no vectors'; return out }
      const sim = pairs.map(p => ({ p, s: cosine(vec[texts.indexOf(p.a)], vec[texts.indexOf(p.b)]) }))
      const lowRel = Math.min(...sim.filter(x => x.p.related).map(x => x.s)), highUnrel = Math.max(...sim.filter(x => !x.p.related).map(x => x.s))
      for (const x of sim) done(embedKey(x.p.a, x.p.b), x.p.related ? x.s > highUnrel : x.s < lowRel, 'ranked on the wrong side')
    } else { out.skipped = `${role} is not scored here (it needs audio or the internet)`; return out }
  } catch (e) { out.skipped = msg(e) }
  out.score = out.total ? out.pass / out.total : 0
  return out
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120)

export interface Admission { role: BrainRole; score: number; admitted: boolean; skipped?: string }
/**
 * Score one configured model on the roles it is set up for. For main and screen the result decides admission. `build` is for tests (a
 * stand-in model); the default builds the real adapter.
 */
export async function admitProvider(c: ProviderConfig, key: (ref: string) => string | null, build?: ConstructorParameters<typeof Gateway>[2]): Promise<Admission[]> {
  const res: Admission[] = []
  for (const role of c.roles.filter(r => ADMIT_ROLES.includes(r) || r === 'fast' || r === 'embed')) {
    const g = new Gateway(() => [{ ...c, enabled: true, roles: [role] }], key, build ?? { db: null })
    const s = await evalRole(g, role, { limit: role === 'main' ? 8 : undefined })
    res.push({ role, score: s.score, admitted: !s.skipped && s.score >= ADMIT_AT, skipped: s.skipped })
  }
  return res
}
/** the `id|model|role` entries to keep after a scoring: passes are added, failures removed */
export function updateAdmitted(list: string[], c: ProviderConfig, results: Admission[]): string[] {
  const keys = new Set(list)
  for (const r of results) if (ADMIT_ROLES.includes(r.role) && !r.skipped) { const k = `${c.id}|${c.model}|${r.role}`; if (r.admitted) keys.add(k); else keys.delete(k) }
  return [...keys]
}
