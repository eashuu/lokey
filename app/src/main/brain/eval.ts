import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from '../agent/tools'
import { runLoop } from './loop'
import { ai, type Gateway as Router } from '../ai/gateway'
import { settings } from '../settings'
import { getSecret } from '../agent/keystore'

// C6 `--eval`: replays fixtures (app/evals/*.json: {request, expectedTools, forbiddenTools}) through the real agent loop and the
// current model with a MOCK executor (no tool runs, every call "succeeds"), then scores: every expected tool called, no forbidden
// tool called. Fixtures are only files the user put there; nothing is recorded automatically.
export interface Fixture { request: string; expectedTools: string[]; forbiddenTools?: string[] }
export interface Score { request: string; pass: boolean; called: string[]; missing: string[]; risky: string[] }

export function score(f: Fixture, called: string[]): Score {
  const missing = f.expectedTools.filter(t => !called.includes(t)), risky = called.filter(t => f.forbiddenTools?.includes(t))
  return { request: f.request, pass: !missing.length && !risky.length, called, missing, risky }
}

/** the fixtures next to each other in `dir`, plus the sample prompts in samples/ (50 starter prompts, English, Tamil and Tanglish) and private/ (the person's own, never published) */
export function loadFixtures(dir: string): Fixture[] {
  const out: Fixture[] = []
  for (const d of [dir, join(dir, 'samples'), join(dir, 'private')]) {
    if (!existsSync(d)) continue
    for (const n of readdirSync(d).filter(x => x.endsWith('.json'))) {
      try { const v = JSON.parse(readFileSync(join(d, n), 'utf8')); for (const f of Array.isArray(v) ? v : [v]) if (typeof f?.request === 'string' && Array.isArray(f.expectedTools)) out.push(f) } catch { /* skip bad file */ }
    }
  }
  return out
}

export async function replay(f: Fixture, router?: Router): Promise<Score> {
  const called: string[] = []
  // ponytail: a short fixed system prompt, not the full runtime prompt; wire brain/prompt.ts in when scores need to match production
  await runLoop({ goal: f.request, system: 'You are Lokey, a PC assistant. Use the tools to do what the user asks.', role: 'main', catalog: TOOLS, enabled: new Set(TOOLS.map(t => t.name)), maxSteps: 6, router, run: async n => { called.push(n); return { result: { ok: true } } } })
  return score(f, called)
}

/** the `--eval` entry: prints and writes a report to `out` */
export async function runEval(dir: string, out: string): Promise<string> {
  // no model, no score: the fixtures need a real one. (The injection suite and the self-checks run without any.)
  if (!ai.candidatesRaw('main').length) {
    const skipped = 'eval: skipped. No model is set up (add a Gemini key or a local model in Settings > Brain), so there is nothing to score. The injection suite below does not need one.'
    try { writeFileSync(out, skipped) } catch { /* console only */ }
    console.log(skipped)
    return skipped
  }
  const fx = loadFixtures(dir), rows: Score[] = []
  for (const f of fx) { try { rows.push(await replay(f)) } catch (e) { rows.push({ request: f.request, pass: false, called: [], missing: ['(error: ' + (e instanceof Error ? e.message : e) + ')'], risky: [] }) } }
  const ok = rows.filter(r => r.pass).length
  const text = [`eval score: ${ok}/${rows.length}`, ...rows.map(r => `${r.pass ? 'PASS' : 'FAIL'} ${r.request.slice(0, 60)}${r.missing.length ? ' missing=' + r.missing : ''}${r.risky.length ? ' RISKY=' + r.risky : ''} called=[${r.called}]`)].join('\n')
  // per-role, per-model scores of everything that is set up (the same set that decides admission)
  const { admitProvider } = await import('./roleEval')
  const roleLines: string[] = []
  for (const c of settings.value.brain.providers.filter(p => p.enabled && p.model.trim())) {
    try { for (const r of await admitProvider(c, getSecret)) roleLines.push(`${c.name} (${c.model}) ${r.role}: ${r.skipped ? 'skipped (' + r.skipped + ')' : Math.round(r.score * 100) + '%'}`) } catch { /* a model that cannot be reached is just not scored */ }
  }
  const all = text + (roleLines.length ? '\n\nper role:\n' + roleLines.join('\n') : '')
  try { writeFileSync(out, all) } catch { /* console only */ }
  console.log(all)
  return all
}

export function evalSelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('eval: ' + m) }
  const f: Fixture = { request: 'x', expectedTools: ['open_app'], forbiddenTools: ['power'] }
  need(score(f, ['open_app']).pass && !score(f, []).pass && !score(f, ['open_app', 'power']).pass && score(f, ['open_app', 'power']).risky[0] === 'power', 'scoring')
  return 'ok'
}
