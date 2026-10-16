import type { ChatMessage } from '../../brain/types'

// Context management for long jobs (plan 3.6). Two steps, both deterministic (no model call, nothing important invented):
//  1. old tool results (older than the last KEEP_STEPS model steps) become one-line stubs: the safest compaction
//  2. near 70% of the model's context, everything between the goal and the last few messages is folded into one note listing
//     what was done and found (tool, short arguments, short outcome), so decisions and IDs survive
export const KEEP_STEPS = 2
const RECENT = 4
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
export const approxTokens = (m: ChatMessage[]) => Math.ceil(m.reduce((n, x) => n + (x.text?.length ?? 0) + JSON.stringify(x.toolCalls ?? '').length + JSON.stringify(x.toolResult?.result ?? '').length + (x.images?.length ?? 0) * 1200, 0) / 3.5)

const outcome = (r: unknown): string => {
  const s = typeof r === 'string' ? r : JSON.stringify(r)
  let ok = true
  try { ok = (JSON.parse(s) as { ok?: boolean })?.ok !== false } catch { /* plain text */ }
  return `${ok ? 'ok' : 'failed'}: ${clip(s.replace(/\s+/g, ' '), 120)}`
}

/** returns true when something was compacted (the array is changed in place) */
export function compact(messages: ChatMessage[], ctxTokens: number): boolean {
  let changed = false
  // 1. stub old tool results
  const assistants = messages.map((m, i) => (m.role === 'assistant' ? i : -1)).filter(i => i >= 0)
  const cut = assistants.length > KEEP_STEPS ? assistants[assistants.length - KEEP_STEPS] : 0
  for (let i = 0; i < cut; i++) {
    const m = messages[i]
    if (m.role === 'tool' && m.toolResult && !(typeof m.toolResult.result === 'string' && m.toolResult.result.startsWith('[older'))) {
      const o = outcome(m.toolResult.result)
      if (o.length < 40 && typeof m.toolResult.result === 'string') continue
      m.toolResult = { ...m.toolResult, result: `[older result of ${m.toolResult.name}] ${o}` }; changed = true
    }
  }
  // 2. fold the middle when the whole thing is near the limit
  if (approxTokens(messages) > ctxTokens * 0.7 && messages.length > RECENT + 2) {
    const head = messages[0]
    let end = messages.length - RECENT
    while (end > 1 && messages[end].role === 'tool') end--      // never split a call from its results
    const mid = messages.slice(1, end)
    if (mid.length > 2) {
      const lines: string[] = []
      for (const m of mid) {
        if (m.role === 'assistant') {
          if (m.text) lines.push(`I said: ${clip(m.text.replace(/\s+/g, ' '), 160)}`)
          for (const c of m.toolCalls ?? []) lines.push(`I called ${c.name}(${clip(JSON.stringify(c.args), 100)})`)
        } else if (m.role === 'tool' && m.toolResult) lines.push(`  -> ${m.toolResult.name} ${outcome(m.toolResult.result)}`)
        else if (m.role === 'user' && m.text) lines.push(`Note: ${clip(m.text, 160)}`)
      }
      head.text = `${head.text ?? ''}\n\n[Earlier in this job, folded to save room; decisions and results kept]\n${clip(lines.join('\n'), 3500)}`
      messages.splice(1, end - 1); changed = true
    }
  }
  return changed
}
