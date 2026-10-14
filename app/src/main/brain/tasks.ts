import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import type { AgentTask } from '@shared/voice'
import type { FunctionDecl } from '../agent/session'
import type { ToolCtx, ToolResult } from '../agent/tools'
import { logAction } from '../agent/permissions'
import { settings } from '../settings'
import { runCli } from './cli'
import { runLoop } from './loop'
import { runOperator } from './operator'
import { ROLES, groupsForGoal, startTools } from './roles'
import { clip, type TaskHost } from './types'
import type { Sidecar } from '../sidecar'

// Background jobs: a worker doing a multi-step task with the model-and-tools loop, a screen operator, or a coding agent run by
// its own CLI. A few at a time, each with a stop signal; the kill-switch stops them all. They report back through the 'done' event.
const MAX_RUNNING = 3
const KEEP = 30

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
}

export class TaskManager extends EventEmitter implements TaskHost {
  private tasks: AgentTask[] = []
  private ctrls = new Map<string, AbortController>()
  constructor(private deps: TaskDeps) { super() }

  list() { return [...this.tasks].reverse() }
  running() { return this.tasks.filter(t => t.status === 'running') }
  private changed() { this.emit('changed', this.list()) }

  /** what a helper itself may do with jobs: look and stop, but never start more (no helpers breeding helpers) */
  private restricted(): TaskHost { return { spawn: () => ({ error: 'helpers cannot start more helpers' }), list: () => this.list(), stop: (id: string) => this.stop(id) } }

  spawn(o: { goal: string; role: string; backend?: 'api' | 'claude' | 'codex'; folder?: string; scheduled?: boolean; approved?: boolean; extra?: Record<string, unknown> }): { id: string } | { error: string } {
    const goal = o.goal.trim()
    if (goal.length < 3) return { error: 'what should it do?' }
    if (this.running().length >= MAX_RUNNING) return { error: `${MAX_RUNNING} jobs are already running; stop one or wait` }
    const backend = o.backend ?? 'api'
    const cli = settings.value.brain.cli
    if (backend !== 'api' && !cli[backend]) return { error: `${backend === 'claude' ? 'Claude Code' : 'Codex'} is switched off in Settings > Brain` }
    const role = ROLES[o.role] && (o.role !== 'second_screen' || taskRunners.has(o.role)) ? o.role : 'general'
    const t: AgentTask = {
      id: Math.random().toString(36).slice(2, 8), kind: backend !== 'api' ? 'cli' : role === 'operator' ? 'operator' : 'task', role, title: clip(goal.replace(/\s+/g, ' '), 70),
      status: 'running', backend, startedAt: Date.now(), steps: 0, line: 'starting…',
    }
    this.tasks.push(t)
    if (this.tasks.length > KEEP) this.tasks.splice(0, this.tasks.length - KEEP)
    const ctl = new AbortController()
    this.ctrls.set(t.id, ctl)
    this.changed()
    void this.run(t, goal, o, ctl)
    return { id: t.id }
  }

  private async run(t: AgentTask, goal: string, o: { folder?: string; scheduled?: boolean; approved?: boolean; extra?: Record<string, unknown> }, ctl: AbortController) {
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
        const r = await runOperator({ goal, sidecar: this.deps.sidecar, signal: ctl.signal, onStep: step })
        ok = r.ok; text = r.summary; t.steps = r.steps
      } else {
        const ctx = this.deps.makeCtx({ scheduled: !!o.scheduled, approved: !!o.approved, signal: ctl.signal, tasks: this.restricted() })
        const catalog = this.deps.catalog()
        const r = await runLoop({
          goal, system: this.deps.system(t.role, goal), role: ROLES[t.role].model, catalog, enabled: startTools(t.role, groupsForGoal(goal)),
          run: (name, args) => this.deps.execute(name, args, ctx), maxSteps: settings.value.brain.maxSteps, signal: ctl.signal, onStep: step,
        })
        text = r.text
        ok = r.reason === 'done' || (r.reason === 'max' && !!r.text) || r.reason === 'budget'
        if (r.reason === 'error') text = `I could not finish: ${r.error ?? 'the model failed'}`
        else if (r.reason === 'max' && !r.text) text = 'I ran out of steps before finishing.'
        t.steps = r.steps
      }
    } catch (e) { text = e instanceof Error ? e.message : String(e) }
    this.ctrls.delete(t.id)
    t.status = ctl.signal.aborted ? 'stopped' : ok ? 'done' : 'failed'
    t.result = clip(text || (ok ? 'Done.' : 'No result.'), 4000)
    t.line = ctl.signal.aborted ? 'stopped' : clip(t.result.replace(/\s+/g, ' '), 90)
    t.endedAt = Date.now()
    logAction({ tool: t.kind === 'cli' ? t.backend : t.role, summary: `${t.status}: ${t.title}`, outcome: t.status === 'done' ? 'done' : 'failed' })
    this.changed()
    this.emit('done', t)
  }

  stop(id: string) {
    const c = this.ctrls.get(id)
    if (!c) return false
    c.abort()
    return true
  }

  /** the kill switch */
  stopAll() { for (const c of this.ctrls.values()) c.abort() }

  static selfCheck(): string {
    // two jobs on a stand-in: the cap, the stop and the "no helpers from helpers" rule, without a model or the OS
    const mgr = new TaskManager({ sidecar: null as unknown as Sidecar, makeCtx: () => ({}) as ToolCtx, catalog: () => [], system: () => '', execute: async () => ({ result: {} }) })
    const need = (c: boolean, m: string) => { if (!c) throw new Error('tasks: ' + m) }
    need('error' in mgr.spawn({ goal: 'x', role: 'general' }), 'a goal needs some words')
    need('error' in mgr.restricted().spawn({ goal: 'more', role: 'general' }), 'helpers cannot spawn helpers')
    return 'tasks ok'
  }
}
