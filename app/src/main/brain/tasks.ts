import { EventEmitter } from 'node:events'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AgentTask } from '@shared/voice'
import type { FunctionDecl } from '../agent/session'
import type { ToolCtx, ToolResult } from '../agent/tools'
import { logAction } from '../agent/permissions'
import { settings } from '../settings'
import { runCli } from './cli'
import { runLoop } from './loop'
import { ai as defaultAi, type Gateway } from '../ai/gateway'
import { journal as defaultJournal, type Journal, type RunRow } from '../ai/runtime/journal'
import { planAndRun } from '../ai/runtime/plan'
import { runOperator } from './operator'
import { memory } from './memory'
import { ROLES, groupsForGoal, startTools } from './roles'
import { clip, type TaskHost } from './types'
import type { Sidecar } from '../sidecar'

// Background jobs: a worker doing a multi-step task with the model-and-tools loop, a screen operator, or a coding agent run by
// its own CLI. A few at a time, each with a stop signal; the kill-switch stops them all. They report back through the 'done' event.
const MAX_RUNNING = 3
const KEEP = 30
/** a parked job tries again no sooner than this (doubling per attempt without progress), never later than the cap, and is given up after the window */
const PARK_MIN_MS = 2000, PARK_CAP_MS = 15 * 60_000, PARK_GIVE_UP_MS = 6 * 3_600_000

/** a platform adds its own kind of job here (Android: the second-screen operator, mobile/secondScreen.ts); Windows registers none */
export interface RunnerOptions { goal: string; signal: AbortSignal; onStep: (n: number, line: string) => void; extra?: Record<string, unknown> }
export const taskRunners = new Map<string, (o: RunnerOptions) => Promise<{ ok: boolean; summary: string; steps: number }>>()

export interface TaskDeps {
  sidecar: Sidecar
  /** a tool context for a job (permissions are the same as for the voice assistant) */
  makeCtx: (o: { scheduled: boolean; approved: boolean; signal: AbortSignal; tasks: TaskHost }) => ToolCtx
  catalog: () => FunctionDecl[]
  system: (role: string, goal: string) => string
  execute: (name: string, args: Record<string, unknown>, ctx: ToolCtx) => Promise<ToolResult>
  /** tests stand in for these */
  router?: Gateway
  journal?: Journal
  now?: () => number
  later?: (fn: () => void, ms: number) => { cancel(): void }
  rand?: () => number
}

interface Park { since: number; tries: number; lastSteps: number; timer?: { cancel(): void }; why: string; goal: string; scheduled: boolean; /** parked while still planning: start from the plan again, not from the loop */ replan: boolean }

export class TaskManager extends EventEmitter implements TaskHost {
  private tasks: AgentTask[] = []
  private ctrls = new Map<string, AbortController>()
  /** jobs waiting for a model (limit, outage, rejected key): they carry on by themselves */
  private parks = new Map<string, Park>()
  constructor(private deps: TaskDeps) { super() }
  private get ai() { return this.deps.router ?? defaultAi }
  private get journal() { return this.deps.journal ?? defaultJournal }
  private now() { return (this.deps.now ?? Date.now)() }
  private later(fn: () => void, ms: number) { if (this.deps.later) return this.deps.later(fn, ms); const h = setTimeout(fn, ms); h.unref?.(); return { cancel: () => clearTimeout(h) } }

  list() { return [...this.tasks].reverse() }
  running() { return this.tasks.filter(t => t.status === 'running') }
  parked() { return this.tasks.filter(t => t.status === 'parked') }
  private changed() { this.emit('changed', this.list()) }

  /** what a helper itself may do with jobs: look and stop, but never start more (no helpers breeding helpers) */
  private restricted(): TaskHost { return { spawn: o => (o.backend && o.backend !== 'api' ? this.spawn(o) : { error: 'helpers cannot start more helpers (a coding agent can be started: use delegate_coding)' }), list: () => this.list(), stop: (id: string) => this.stop(id) } }

  spawn(o: { goal: string; role: string; backend?: 'api' | 'claude' | 'codex'; folder?: string; scheduled?: boolean; approved?: boolean; extra?: Record<string, unknown> }): { id: string } | { error: string } {
    const goal = o.goal.trim()
    if (goal.length < 3) return { error: 'what should it do?' }
    if (this.running().length >= MAX_RUNNING) return { error: `${MAX_RUNNING} jobs are already running; stop one or wait` }
    const backend = o.backend ?? 'api'
    const cli = settings.value.brain.cli
    if (backend !== 'api' && !cli[backend]) return { error: `${backend === 'claude' ? 'Claude Code' : 'Codex'} is switched off in Settings > Brain` }
    if (backend !== 'api') {   // a coding agent needs a folder: the one named, else the one saved in Settings > Brain
      const dir = (o.folder || cli.folder || '').trim()
      if (!dir) return { error: `Which project folder should ${backend === 'claude' ? 'Claude Code' : 'Codex'} work in? Tell me the folder.` }
      try { if (!statSync(resolve(dir)).isDirectory()) throw new Error('not a folder') } catch { return { error: `The folder "${dir}" does not exist.` } }
    }
    const role = ROLES[o.role] && (o.role !== 'second_screen' || taskRunners.has(o.role)) ? o.role : 'general'
    const t: AgentTask = {
      id: Math.random().toString(36).slice(2, 8), kind: backend !== 'api' ? 'cli' : role === 'operator' ? 'operator' : 'task', role, title: clip(goal.replace(/\s+/g, ' '), 70), goal: clip(goal, 1500),
      status: 'running', backend, startedAt: Date.now(), steps: 0, line: 'starting…',
    }
    if (backend === 'api' && !taskRunners.has(role) && role !== 'operator') this.journal.startRun({ id: t.id, goal, role, origin: o.scheduled ? 'schedule' : 'user', budget: { maxSteps: settings.value.brain.maxSteps } })
    this.tasks.push(t)
    if (this.tasks.length > KEEP) this.tasks.splice(0, this.tasks.length - KEEP)
    const ctl = new AbortController()
    this.ctrls.set(t.id, ctl)
    this.changed()
    void this.run(t, goal, o, ctl)
    return { id: t.id }
  }

  private async run(t: AgentTask, goal: string, o: { folder?: string; scheduled?: boolean; approved?: boolean; extra?: Record<string, unknown> }, ctl: AbortController, resume = false) {
    const step = (n: number, line: string) => { t.steps = n; t.line = line; this.changed() }
    let ok = false, text = ''
    try {
      if (t.backend !== 'api') {
        const folder = resolve(o.folder || settings.value.brain.cli.folder || '.')
        const r = await runCli({ tool: t.backend, task: goal, folder, allowEdits: settings.value.brain.cli.allowEdits, signal: ctl.signal, onLine: line => step(t.steps + 1, line) })
        ok = r.ok; text = r.text
      } else if (taskRunners.has(t.role)) {
        const r = await taskRunners.get(t.role)!({ goal, signal: ctl.signal, onStep: step, extra: o.extra })
        ok = r.ok; text = r.summary; t.steps = r.steps
      } else if (t.role === 'operator') {
        // per-app plan memory: what worked last time in the program in front is offered as a hint, and a confirmed success is kept for next time
        const app = (await this.deps.sidecar.call('foreground.get', {}).catch(() => null))?.exe ?? ''
        const hint = app ? memory.planHint(app, goal) : ''
        const r = await runOperator({ goal: hint ? `${goal}

${hint}` : goal, sidecar: this.deps.sidecar, signal: ctl.signal, onStep: step, onControl: on => this.emit('control', on) })
        ok = r.ok; text = r.summary; t.steps = r.steps
        if (r.ok && app && !o.scheduled && r.trail?.length) memory.savePlan(app, goal, r.trail)
      } else {
        const ctx = this.deps.makeCtx({ scheduled: !!o.scheduled, approved: !!o.approved, signal: ctl.signal, tasks: this.restricted() })
        const catalog = this.ai.visibleTools(this.deps.catalog())
        const enabled = startTools(t.role, groupsForGoal(goal))
        const system = this.deps.system(t.role, goal)
        // unattended runs (schedules, routines, follow-ups) decide their steps before reading anything from outside
        const p = o.scheduled && !resume ? await planAndRun({ goal, system, catalog, allowed: enabled, run: (name, args) => this.deps.execute(name, args, ctx), router: this.ai, signal: ctl.signal, onStep: step, journal: { j: this.journal, runId: t.id } }) : null
        if (p?.wait) { this.park(t, goal, o, p.wait.until, p.wait.why, p.wait.kind, !p.planned); return }
        if (p?.planned) { ok = p.ok; text = p.text; t.steps = p.steps } else {
          const r = await runLoop({
            goal, system, role: ROLES[t.role].model, catalog, enabled,
            run: (name, args) => this.deps.execute(name, args, ctx), maxSteps: settings.value.brain.maxSteps, signal: ctl.signal, onStep: step,
            deadline: Date.now() + 20 * 60_000, journal: { j: this.journal, runId: t.id, resume }, router: this.ai,
          })
          if (r.reason === 'wait') { t.steps = r.steps; this.park(t, goal, o, r.until ?? this.now() + 30_000, r.error ?? 'no model could answer', r.waitKind ?? 'NETWORK'); return }
          text = r.text
          ok = r.reason === 'done' || (r.reason === 'max' && !!r.text) || r.reason === 'budget'
          if (r.reason === 'error') text = `I could not finish: ${r.error ?? 'no model could answer'}`
          else if (r.reason === 'max' && !r.text) text = 'I ran out of steps before finishing.'
          else if (r.reason === 'time') { ok = false; text = r.text || 'That took longer than I allow; stopping here.' }
          t.steps = r.steps
        }
      }
    } catch (e) { text = e instanceof Error ? e.message : String(e) }
    this.ctrls.delete(t.id)
    t.status = ctl.signal.aborted ? 'stopped' : ok ? 'done' : 'failed'
    this.parks.delete(t.id)
    if (['running', 'parked'].includes(this.journal.run(t.id)?.status ?? '')) this.journal.finishRun(t.id, t.status)
    t.result = clip(text || (ok ? 'Done.' : 'No result.'), 4000)
    t.line = ctl.signal.aborted ? 'stopped' : clip(t.result.replace(/\s+/g, ' '), 90)
    t.endedAt = Date.now()
    logAction({ tool: t.kind === 'cli' ? t.backend : t.role, summary: `${t.status}: ${t.title}`, outcome: t.status === 'done' ? 'done' : 'failed' })
    this.changed()
    this.emit('done', t)
  }

  // ---- parking: a job whose models are all out of reach waits and carries on (docs/AI-FAILSAFE.md section 4) ------------------------------
  private park(t: AgentTask, goal: string, o: { scheduled?: boolean }, until: number, why: string, kind: string, replan = false) {
    const prev = this.parks.get(t.id)
    const p: Park = prev ?? { since: this.now(), tries: 0, lastSteps: -1, why, goal, scheduled: !!o.scheduled, replan }
    p.tries = prev && t.steps > p.lastSteps ? 1 : p.tries + 1   // progress since the last wait starts the backoff over
    p.lastSteps = t.steps; p.why = why; p.replan = replan
    this.ctrls.delete(t.id)
    if (this.now() - p.since > PARK_GIVE_UP_MS) {
      this.parks.delete(t.id)
      t.status = 'failed'; t.result = clip(`I gave up after waiting for hours. ${why}`, 4000); t.line = clip(t.result.replace(/\s+/g, ' '), 90); t.endedAt = this.now(); t.until = undefined
      this.journal.finishRun(t.id, 'failed')
      logAction({ tool: t.role, summary: `failed: ${t.title}`, outcome: 'failed' })
      this.changed(); this.emit('done', t)
      return
    }
    const backoff = Math.min(PARK_CAP_MS, PARK_MIN_MS * 2 ** (p.tries - 1))
    const wait = Math.min(PARK_CAP_MS, Math.max(until - this.now(), backoff)) + Math.floor((this.deps.rand ?? Math.random)() * 2000)
    t.status = 'parked'; t.until = this.now() + wait; t.waitKind = kind
    t.line = clip(`waiting for a model: ${why}`, 90)
    this.journal.finishRun(t.id, 'parked')
    p.timer?.cancel()
    p.timer = this.later(() => { void this.resume(t.id) }, wait)
    this.parks.set(t.id, p)
    this.changed()
    if (p.tries === 1) this.emit('parked', t, `Waiting: ${why}. I will carry on${t.until ? ` at ${new Date(t.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}.`)
  }
  /** after a restart: jobs that were parked carry on without being asked (one last touched longer ago than the give-up window stays on Desk) */
  restoreParked() {
    for (const r of this.journal.unfinished()) {
      if (r.status !== 'parked' || this.ctrls.has(r.id) || this.parks.has(r.id) || this.now() - r.updated > PARK_GIVE_UP_MS) continue
      const t: AgentTask = { id: r.id, kind: 'task', role: ROLES[r.role] ? r.role : 'general', title: clip(r.goal.replace(/\s+/g, ' '), 70), goal: clip(r.goal, 1500), status: 'parked', backend: 'api', startedAt: r.created, steps: 0, line: 'waiting for a model', until: this.now() + 30_000 }
      this.tasks.push(t)
      this.parks.set(t.id, { since: r.updated, tries: 1, lastSteps: 0, why: 'waiting for a model', goal: r.goal, scheduled: r.origin === 'schedule', replan: false, timer: this.later(() => { void this.resume(t.id) }, 30_000) })
    }
    this.changed()
  }

  stop(id: string) {
    const pk = this.parks.get(id)
    if (pk) {
      pk.timer?.cancel(); this.parks.delete(id)
      const t = this.tasks.find(x => x.id === id)
      if (t) { t.status = 'stopped'; t.line = 'stopped'; t.endedAt = this.now(); t.until = undefined }
      this.journal.finishRun(id, 'stopped'); this.changed()
      return true
    }
    const c = this.ctrls.get(id)
    if (!c) return false
    c.abort()
    return true
  }

  /** jobs the app was closed or killed in the middle of: they can be continued from their last complete step, or discarded */
  interrupted(): RunRow[] { return this.journal.unfinished().filter(r => !this.ctrls.has(r.id) && !this.parks.has(r.id)) }
  discard(id: string) { this.parks.get(id)?.timer?.cancel(); this.parks.delete(id); this.journal.discard(id) }
  resume(id: string): { id: string } | { error: string } {
    const r = this.journal.run(id)
    if (!r || (r.status !== 'running' && r.status !== 'parked') || this.ctrls.has(id)) return { error: 'that job cannot be continued' }
    if (this.running().length >= MAX_RUNNING) return { error: `${MAX_RUNNING} jobs are already running; stop one or wait` }
    const pk = this.parks.get(id)
    pk?.timer?.cancel()
    const old = this.tasks.find(x => x.id === id)
    const t: AgentTask = old ?? { id, kind: 'task', role: ROLES[r.role] ? r.role : 'general', title: clip(r.goal.replace(/\s+/g, ' '), 70), goal: clip(r.goal, 1500), status: 'running', backend: 'api', startedAt: this.now(), steps: 0, line: 'continuing…' }
    t.status = 'running'; t.until = undefined; t.waitKind = undefined; t.line = 'continuing…'
    if (!old) this.tasks.push(t)
    const ctl = new AbortController()
    this.ctrls.set(id, ctl)
    this.changed()
    this.journal.finishRun(id, 'running')
    void this.run(t, r.goal, { scheduled: r.origin === 'schedule', approved: false }, ctl, !pk?.replan)
    return { id }
  }

  /** start a finished job again with the same request */
  retry(id: string): { id: string } | { error: string } {
    const t = this.tasks.find(x => x.id === id)
    if (t?.status === 'parked') return this.resume(id)   // Retry on a waiting job: ask the models again now
    if (!t || t.status === 'running' || !t.goal) return { error: 'that job cannot be started again' }
    return this.spawn({ goal: t.goal, role: t.role, backend: t.backend })
  }

  /** the kill switch */
  stopAll() { for (const c of this.ctrls.values()) c.abort(); for (const id of [...this.parks.keys()]) this.stop(id) }

  static selfCheck(): string {
    // two jobs on a stand-in: the cap, the stop and the "no helpers from helpers" rule, without a model or the OS
    const mgr = new TaskManager({ sidecar: null as unknown as Sidecar, makeCtx: () => ({}) as ToolCtx, catalog: () => [], system: () => '', execute: async () => ({ result: {} }) })
    const need = (c: boolean, m: string) => { if (!c) throw new Error('tasks: ' + m) }
    need('error' in mgr.spawn({ goal: 'x', role: 'general' }), 'a goal needs some words')
    need('error' in mgr.restricted().spawn({ goal: 'more', role: 'general' }), 'helpers cannot spawn helpers')
    return 'tasks ok'
  }
}
