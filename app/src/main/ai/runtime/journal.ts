import { createHash } from 'node:crypto'
import { getDb, type Db } from '../db'

// The step journal (round-9 plan 3.6): durable execution for background jobs. Before a model call's answer is used, and before and
// after every tool call, a row is written to lokey.db. After a crash or a restart an unfinished run can be rebuilt from its rows
// (the conversation so far), continued, or discarded. A tool call that was "started" with no result is never run again blindly:
// a read-only one is repeated, a side-effecting one is verified (did the file appear?) or reported to the model as uncertain.
// A completed side-effecting call with the same tool and arguments is never run twice in one run (idempotency).
/** `parked`: no model could answer, the job waits and carries on by itself (docs/AI-FAILSAFE.md section 4) */
export type RunStatus = 'running' | 'parked' | 'done' | 'failed' | 'stopped' | 'discarded'
export interface RunRow { id: string; goal: string; role: string; origin: string; status: RunStatus; created: number; updated: number; budget: string }
export type StepStatus = 'started' | 'done' | 'failed' | 'uncertain'
export interface StepRow { run_id: string; n: number; idx: number; kind: 'model' | 'tool' | 'plan'; name: string; args: string; idem: string; hash: string; status: StepStatus; output: string; started: number; ended: number | null }

/** a stable fingerprint of a call: tool name + arguments with their keys sorted */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'null'
}
export const callHash = (name: string, args: unknown) => createHash('sha1').update(name + canonical(args)).digest('hex').slice(0, 20)
/** the idempotency key of one tool call in one run: run:step:toolCallId */
export const idemKey = (runId: string, n: number, callId: string) => `${runId}:${n}:${callId}`

export class Journal {
  private runs = new Map<string, RunRow>()
  private steps: StepRow[] = []
  constructor(private db: () => Db | null = getDb, private now: () => number = Date.now) {}

  startRun(r: { id: string; goal: string; role: string; origin: string; budget?: unknown }) {
    const t = this.now(), row: RunRow = { id: r.id, goal: r.goal, role: r.role, origin: r.origin, status: 'running', created: t, updated: t, budget: JSON.stringify(r.budget ?? {}) }
    const d = this.db()
    if (d) { try { d.run('insert or replace into runs(id, goal, role, origin, status, created, updated, budget) values(?, ?, ?, ?, ?, ?, ?, ?)', row.id, row.goal, row.role, row.origin, row.status, row.created, row.updated, row.budget); return } catch { /* memory */ } }
    this.runs.set(row.id, row)
  }
  finishRun(id: string, status: RunStatus) {
    const d = this.db()
    if (d) { try { d.run('update runs set status = ?, updated = ? where id = ?', status, this.now(), id); return } catch { /* memory */ } }
    const r = this.runs.get(id); if (r) { r.status = status; r.updated = this.now() }
  }
  run(id: string): RunRow | undefined {
    const d = this.db()
    if (d) { try { return d.get<RunRow>('select * from runs where id = ?', id) } catch { /* memory */ } }
    return this.runs.get(id)
  }
  /** runs that never finished: the app was closed or killed while they ran (parked ones too: they carry on after a restart) */
  unfinished(): RunRow[] {
    const d = this.db()
    if (d) { try { return d.all<RunRow>("select * from runs where status in ('running', 'parked') order by created") } catch { /* memory */ } }
    return [...this.runs.values()].filter(r => r.status === 'running')
  }

  private put(s: StepRow) {
    const d = this.db()
    if (d) { try { d.run('insert or replace into steps(run_id, n, idx, kind, name, args, idem, hash, status, output, started, ended) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', s.run_id, s.n, s.idx, s.kind, s.name, s.args, s.idem, s.hash, s.status, s.output, s.started, s.ended); return } catch { /* memory */ } }
    this.steps = this.steps.filter(x => !(x.run_id === s.run_id && x.n === s.n && x.idx === s.idx && x.kind === s.kind)); this.steps.push(s)
  }
  /** the model's answer for step n (text, tool calls, the provider's raw message) */
  model(runId: string, n: number, out: unknown) { this.put({ run_id: runId, n, idx: 0, kind: 'model', name: '', args: '', idem: '', hash: '', status: 'done', output: JSON.stringify(out), started: this.now(), ended: this.now() }) }
  /** the plan of a plan-then-execute run */
  plan(runId: string, plan: unknown) { this.put({ run_id: runId, n: 0, idx: 0, kind: 'plan', name: '', args: '', idem: '', hash: '', status: 'done', output: JSON.stringify(plan), started: this.now(), ended: this.now() }) }
  /** a tool call is about to run (written BEFORE it runs) */
  toolBegin(runId: string, n: number, idx: number, call: { id: string; name: string; args: Record<string, unknown> }) {
    const s: StepRow = { run_id: runId, n, idx, kind: 'tool', name: call.name, args: JSON.stringify(call.args), idem: idemKey(runId, n, call.id), hash: callHash(call.name, call.args), status: 'started', output: '', started: this.now(), ended: null }
    this.put(s); return s
  }
  toolDone(s: StepRow, status: StepStatus, result: unknown) { this.put({ ...s, status, output: JSON.stringify(result ?? null), ended: this.now() }) }
  stepsOf(runId: string): StepRow[] {
    const d = this.db()
    if (d) { try { return d.all<StepRow>('select * from steps where run_id = ? order by n, idx', runId) } catch { /* memory */ } }
    return this.steps.filter(s => s.run_id === runId).sort((a, b) => a.n - b.n || a.idx - b.idx)
  }
  /** an earlier call with the same tool and arguments in this run that completed, or that a crash left uncertain (never repeated blindly either) */
  doneSame(runId: string, hash: string): StepRow | undefined { return this.stepsOf(runId).find(s => s.kind === 'tool' && s.hash === hash && (s.status === 'done' || s.status === 'uncertain')) }
  discard(id: string) { this.finishRun(id, 'discarded') }
}

export const journal = new Journal()
