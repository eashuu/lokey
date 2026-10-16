import type { BrainRole } from '@shared/bridge'
import type { FunctionDecl } from '../agent/session'
import type { ToolResult } from '../agent/tools'
import { ai as defaultRouter, type Gateway as Router } from '../ai/gateway'
import { failureLine, isWait, type AiKind } from '../ai/errors'
import { classOf } from '../ai/guard/policy'
import { compact } from '../ai/runtime/compact'
import { callHash, type Journal, type StepRow } from '../ai/runtime/journal'
import { hasVerifier, verify } from '../ai/runtime/verify'
import { GROUPS, groupTools, USE_TOOLS_DECL } from './roles'
import { clip, type ChatMessage, type ToolCall, type Usage } from './types'

// The agent loop: ask the model what to do, run the tools it names, show it the results, repeat until it answers in plain text.
// This is what lets a free model do multi-step work: Lokey (not the model) owns the loop, the tool permissions and the budget.
// Guards: a step limit, a token budget, a time limit, a stop signal, repeated identical calls are cut off (arguments compared
// with their keys sorted), old results are folded away as the job grows.
//
// Durable: with a `journal` every model answer and every tool call is written to lokey.db before it is used, so a job that was
// killed can continue (`resume`) from the last complete step. A tool call that was started but has no result is never repeated
// blindly: reading tools are simply run again, a side-effecting one is checked (did the file appear?) or reported to the model as
// "interrupted, check before repeating". A completed side-effecting call with the same tool and arguments is never run twice.
export interface LoopOptions {
  goal: string
  system: string
  role: BrainRole
  /** every tool that exists; the loop shows the model only the ones switched on */
  catalog: FunctionDecl[]
  /** names switched on at the start */
  enabled: Set<string>
  run: (name: string, args: Record<string, unknown>) => Promise<ToolResult>
  maxSteps: number
  signal?: AbortSignal
  onStep?: (step: number, line: string) => void
  images?: string[]
  router?: Router
  /** stop after the model has used this many tokens in total */
  tokenBudget?: number
  /** stop after this long (epoch ms) */
  deadline?: number
  /** the model's context size in tokens, for compaction (default 32k) */
  contextTokens?: number
  /** durable execution: write every step here; `resume` continues a run that was interrupted */
  journal?: { j: Journal; runId: string; resume?: boolean }
}

/** `wait`: no model could answer right now but one will later (limit, outage, rejected key): the job parks and carries on at `until` (docs/AI-FAILSAFE.md section 4). `error` is then the sentence naming which providers failed and why. */
export interface LoopResult { text: string; steps: number; reason: 'done' | 'max' | 'abort' | 'error' | 'budget' | 'time' | 'wait'; usage: Usage; error?: string; until?: number; waitKind?: AiKind }

const RESULT_CHARS = 5000
const UNCERTAIN = { ok: false, uncertain: true, error: 'This step was interrupted by a crash or restart and may or may not have happened. Check the result (look at the file, window or setting) before doing it again.' }

/** rebuild the conversation of an interrupted run from its journal rows */
export function restore(goal: string, rows: StepRow[]): { messages: ChatMessage[]; step: number; pending: { call: ToolCall; row?: StepRow }[] } {
  const messages: ChatMessage[] = [{ role: 'user', text: goal }]
  let step = 0, pending: { call: ToolCall; row?: StepRow }[] = []
  const models = rows.filter(r => r.kind === 'model')
  for (const m of models) {
    const out = JSON.parse(m.output) as { text: string; toolCalls: ToolCall[]; raw?: ChatMessage['raw'] }
    step = m.n
    messages.push({ role: 'assistant', text: out.text, toolCalls: out.toolCalls, raw: out.raw })
    const tools = rows.filter(r => r.kind === 'tool' && r.n === m.n)
    pending = []
    out.toolCalls.forEach((call, i) => {
      const row = tools.find(t => t.idx === i)
      if (row && (row.status === 'done' || row.status === 'failed' || row.status === 'uncertain')) messages.push({ role: 'tool', toolResult: { id: call.id, name: call.name, result: clip(row.output, RESULT_CHARS) } })
      else pending.push({ call, row })
    })
    if (pending.length && m !== models[models.length - 1]) pending = []    // cannot happen in order; ignore damaged history
  }
  return { messages, step, pending }
}

export async function runLoop(o: LoopOptions): Promise<LoopResult> {
  const router = o.router ?? defaultRouter
  const jr = o.journal
  const usage: Usage = { in: 0, out: 0, cached: 0 }
  const seen = new Map<string, number>()
  const enabled = new Set([...o.enabled, 'use_tools'])
  const budget = o.tokenBudget ?? 90_000
  const by = new Map(o.catalog.map(t => [t.name, t]))
  let text = ''
  let messages: ChatMessage[] = [{ role: 'user', text: o.goal, images: o.images }]
  let start = 1
  let pending: { call: ToolCall; row?: StepRow }[] = []
  let lastProvider = ''
  if (jr?.resume) {
    const r = restore(o.goal, jr.j.stepsOf(jr.runId))
    messages = r.messages; pending = r.pending; start = r.pending.length ? r.step : r.step + 1
    for (const m of messages) if (m.role === 'assistant' && m.text) text = m.text
  }

  /** run one tool call (journalled, deduplicated, verified); the message with its result is added */
  const doCall = async (c: ToolCall, step: number, idx: number, prior?: StepRow) => {
    o.onStep?.(step, `${c.name.replace(/_/g, ' ')}${Object.keys(c.args).length ? ': ' + clip(String(Object.values(c.args)[0] ?? ''), 60) : ''}`)
    const hash = callHash(c.name, c.args)
    const n = (seen.get(hash) ?? 0) + 1
    seen.set(hash, n)
    let result: unknown
    const row = jr && !prior ? jr.j.toolBegin(jr.runId, step, idx, c) : prior
    if (c.name === 'use_tools') {
      const g = String(c.args.group ?? '')
      if (GROUPS[g]) { for (const t of groupTools(g)) enabled.add(t); result = { ok: true, now_available: groupTools(g) } } else result = { ok: false, error: 'unknown group' }
    } else if (!enabled.has(c.name) || !by.has(c.name)) {
      result = { ok: false, error: `${c.name} is not switched on; call use_tools with its group first` }
    } else if (n > 3) {
      result = { ok: false, error: 'you already tried exactly this three times; do something different or finish' }
    } else {
      const effect = classOf(c.name, c.args) !== 'read'
      const same = jr && effect ? jr.j.doneSame(jr.runId, hash) : undefined
      if (same && same !== row) {
        result = { ...(JSON.parse(same.output) as object), already_done: true, note: same.status === 'uncertain' ? 'The same call was interrupted earlier and may have happened; it was not repeated. Check the result first.' : 'The same call already completed earlier in this job; it was not repeated.' }
      } else if (prior && effect && prior.status === 'started') {
        // a side-effecting step the crash cut off: did it happen?
        result = hasVerifier(c.name) && verify(c.name, c.args) === null ? { ok: true, recovered: true, note: 'It had already taken effect before the interruption.' } : UNCERTAIN
      } else {
        try {
          const r = (await o.run(c.name, c.args)).result as Record<string, unknown>
          result = r
          // verify after act: a tool that says "ok" must also have done it
          if (effect && hasVerifier(c.name) && (r as { ok?: boolean })?.ok !== false) {
            const why = verify(c.name, c.args)
            if (why) { result = { ok: false, error: `verification failed: ${why}` }; if (lastProvider) router.health?.penalize(lastProvider, 1, 'an action that did not verify') }
          }
        } catch (e) { result = { ok: false, error: e instanceof Error ? e.message : String(e) } }
      }
    }
    if (row && jr) jr.j.toolDone(row, (result as { ok?: boolean; uncertain?: boolean })?.uncertain ? 'uncertain' : (result as { ok?: boolean })?.ok === false ? 'failed' : 'done', result)
    messages.push({ role: 'tool', toolResult: { id: c.id, name: c.name, result: clip(JSON.stringify(result), RESULT_CHARS) } })
  }

  for (let step = start; step <= o.maxSteps; step++) {
    if (o.signal?.aborted) return { text, steps: step - 1, reason: 'abort', usage }
    if (o.deadline && Date.now() > o.deadline) return { text, steps: step - 1, reason: 'time', usage }
    if (!pending.length) {
      // a stable order keeps the prompt prefix identical between steps, which is what lets providers cache it
      const tools = [...enabled].sort().map(n => (n === 'use_tools' ? USE_TOOLS_DECL : by.get(n))).filter((t): t is FunctionDecl => !!t)
      let res
      try { res = await router.call(o.role, { system: o.system, messages, tools, knownTools: [...by.keys()], signal: o.signal }, { op: 'loop' }) } catch (e) {
        if (o.signal?.aborted) return { text, steps: step - 1, reason: 'abort', usage }
        if (isWait(e)) return { text, steps: step - 1, reason: 'wait', usage, error: failureLine(e), until: e.until ?? Date.now() + 30_000, waitKind: e.kind }
        return { text, steps: step - 1, reason: 'error', usage, error: failureLine(e) }
      }
      lastProvider = res.provider
      usage.in += res.usage.in; usage.out += res.usage.out; usage.cached += res.usage.cached
      if (res.text) text = res.text
      messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw })
      jr?.j.model(jr.runId, step, { text: res.text, toolCalls: res.toolCalls, raw: res.raw })
      if (!res.toolCalls.length) return { text: res.text || text, steps: step, reason: 'done', usage }
      if (usage.in + usage.out > budget) return { text: res.text || text, steps: step, reason: 'budget', usage }
      pending = res.toolCalls.map(call => ({ call }))
    }
    const calls = pending
    pending = []
    for (let i = 0; i < calls.length; i++) {
      await doCall(calls[i].call, step, calls[i].row?.idx ?? i, calls[i].row)
      if (o.signal?.aborted) return { text, steps: step, reason: 'abort', usage }
    }
    // keep the conversation small: old results shrink to a line, and near the limit the middle is folded into a note
    compact(messages, o.contextTokens ?? 32_000)
  }
  return { text, steps: o.maxSteps, reason: 'max', usage }
}
