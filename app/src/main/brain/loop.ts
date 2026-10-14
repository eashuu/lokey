import type { BrainRole } from '@shared/bridge'
import type { FunctionDecl } from '../agent/session'
import type { ToolResult } from '../agent/tools'
import { router as defaultRouter, type Router } from './router'
import { GROUPS, USE_TOOLS_DECL } from './roles'
import { clip, type ChatMessage, type Usage } from './types'

// The agent loop: ask the model what to do, run the tools it names, show it the results, repeat until it answers in plain text.
// This is what lets a free model do multi-step work: Lokey (not the model) owns the loop, the tool permissions and the budget.
// Guards: a step limit, a token budget, a stop signal, and repeated identical calls are cut off.
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
}

export interface LoopResult { text: string; steps: number; reason: 'done' | 'max' | 'abort' | 'error' | 'budget'; usage: Usage; error?: string }

const RESULT_CHARS = 5000

export async function runLoop(o: LoopOptions): Promise<LoopResult> {
  const router = o.router ?? defaultRouter
  const messages: ChatMessage[] = [{ role: 'user', text: o.goal, images: o.images }]
  const usage: Usage = { in: 0, out: 0, cached: 0 }
  const seen = new Map<string, number>()
  const enabled = new Set([...o.enabled, 'use_tools'])
  const budget = o.tokenBudget ?? 90_000
  const by = new Map(o.catalog.map(t => [t.name, t]))
  let text = ''

  for (let step = 1; step <= o.maxSteps; step++) {
    if (o.signal?.aborted) return { text, steps: step - 1, reason: 'abort', usage }
    // a stable order keeps the prompt prefix identical between steps, which is what lets providers cache it
    const tools = [...enabled].sort().map(n => (n === 'use_tools' ? USE_TOOLS_DECL : by.get(n))).filter((t): t is FunctionDecl => !!t)
    let res
    try { res = await router.chat(o.role, { system: o.system, messages, tools, signal: o.signal }) } catch (e) {
      if (o.signal?.aborted) return { text, steps: step - 1, reason: 'abort', usage }
      return { text, steps: step - 1, reason: 'error', usage, error: e instanceof Error ? e.message : String(e) }
    }
    usage.in += res.usage.in; usage.out += res.usage.out; usage.cached += res.usage.cached
    if (res.text) text = res.text
    messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw })
    if (!res.toolCalls.length) return { text: res.text || text, steps: step, reason: 'done', usage }
    if (usage.in + usage.out > budget) return { text: res.text || text, steps: step, reason: 'budget', usage }

    for (const c of res.toolCalls) {
      o.onStep?.(step, `${c.name.replace(/_/g, ' ')}${Object.keys(c.args).length ? ': ' + clip(String(Object.values(c.args)[0] ?? ''), 60) : ''}`)
      const sig = c.name + JSON.stringify(c.args)
      const n = (seen.get(sig) ?? 0) + 1
      seen.set(sig, n)
      let result: unknown
      if (c.name === 'use_tools') {
        const g = String(c.args.group ?? '')
        if (GROUPS[g]) { for (const t of GROUPS[g]) enabled.add(t); result = { ok: true, now_available: GROUPS[g] } } else result = { ok: false, error: 'unknown group' }
      } else if (!enabled.has(c.name) || !by.has(c.name)) {
        result = { ok: false, error: `${c.name} is not switched on; call use_tools with its group first` }
      } else if (n > 3) {
        result = { ok: false, error: 'you already tried exactly this three times; do something different or finish' }
      } else {
        try { result = (await o.run(c.name, c.args)).result } catch (e) { result = { ok: false, error: e instanceof Error ? e.message : String(e) } }
      }
      messages.push({ role: 'tool', toolResult: { id: c.id, name: c.name, result: clip(JSON.stringify(result), RESULT_CHARS) } })
      if (o.signal?.aborted) return { text, steps: step, reason: 'abort', usage }
    }
    // keep the conversation small: old tool outputs are replaced by a stub, only the recent ones stay in full
    for (let i = 0; i < messages.length - 8; i++) { const m = messages[i]; if (m.role === 'tool' && m.toolResult && typeof m.toolResult.result === 'string' && m.toolResult.result.length > 300) m.toolResult.result = clip(m.toolResult.result, 200) + ' [older output shortened]' }
  }
  return { text, steps: o.maxSteps, reason: 'max', usage }
}
