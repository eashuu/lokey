import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from '../agent/tools'
import { runLoop } from './loop'
import type { Router } from './router'

// C6 `--eval`: replays fixtures (app/evals/*.json: {request, expectedTools, forbiddenTools}) through the real agent loop and the
// current model with a MOCK executor (no tool runs, every call "succeeds"), then scores: every expected tool called, no forbidden
// tool called. Fixtures are only files the user put there; nothing is recorded automatically.
export interface Fixture { request: string; expectedTools: string[]; forbiddenTools?: string[] }
export interface Score { request: string; pass: boolean; called: string[]; missing: string[]; risky: string[] }

export function score(f: Fixture, called: string[]): Score {
  const missing = f.expectedTools.filter(t => !called.includes(t)), risky = called.filter(t => f.forbiddenTools?.includes(t))
  return { request: f.request, pass: !missing.length && !risky.length, called, missing, risky }
}

export function loadFixtures(dir: string): Fixture[] {
  const out: Fixture[] = []
  for (const n of readdirSync(dir).filter(x => x.endsWith('.json'))) {
    try { const v = JSON.parse(readFileSync(join(dir, n), 'utf8')); for (const f of Array.isArray(v) ? v : [v]) if (typeof f?.request === 'string' && Array.isArray(f.expectedTools)) out.push(f) } catch { /* skip bad file */ }
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
  const fx = loadFixtures(dir), rows: Score[] = []
  for (const f of fx) { try { rows.push(await replay(f)) } catch (e) { rows.push({ request: f.request, pass: false, called: [], missing: ['(error: ' + (e instanceof Error ? e.message : e) + ')'], risky: [] }) } }
  const ok = rows.filter(r => r.pass).length
  const text = [`eval score: ${ok}/${rows.length}`, ...rows.map(r => `${r.pass ? 'PASS' : 'FAIL'} ${r.request.slice(0, 60)}${r.missing.length ? ' missing=' + r.missing : ''}${r.risky.length ? ' RISKY=' + r.risky : ''} called=[${r.called}]`)].join('\n')
  try { writeFileSync(out, text) } catch { /* console only */ }
  console.log(text)
  return text
}

export function evalSelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('eval: ' + m) }
  const f: Fixture = { request: 'x', expectedTools: ['open_app'], forbiddenTools: ['power'] }
  need(score(f, ['open_app']).pass && !score(f, []).pass && !score(f, ['open_app', 'power']).pass && score(f, ['open_app', 'power']).risky[0] === 'power', 'scoring')
  return 'ok'
}
