import type { FunctionDecl } from '../agent/session'
import type { ToolCtx, ToolResult } from '../agent/tools'
import { ai } from '../ai/gateway'
import { draftAsMe } from './style'
import { weeklyReview } from './weekly'

// C2 + C5 tools. Both only read or draft: draft_as_me never types or sends (typing still needs type_text's confirm card).
const S = { type: 'STRING' }
export const EXTRA_TOOLS: FunctionDecl[] = [
  { name: 'draft_as_me', description: 'Draft a message or reply in the user\'s own writing style (learned from their past messages). Returns text only; to put it in a field use type_text, which asks the user first. Use for "reply to this as me", "write to Arun".', parameters: { type: 'OBJECT', properties: { context: { ...S, description: 'what to say, or the message being replied to' }, recipient: { ...S, description: 'who it is for, optional' } }, required: ['context'] } },
  { name: 'weekly_review', description: 'What happened this week: new things learned, promises kept or late, time per app (if the activity timeline is on), trusted actions earned.', parameters: { type: 'OBJECT', properties: {} } },
]
export const EXTRA_NAMES = new Set(EXTRA_TOOLS.map(t => t.name))
export const EXTRA_READ_ONLY = EXTRA_NAMES

export async function runExtraTool(name: string, a: Record<string, unknown>, _ctx?: ToolCtx): Promise<ToolResult> {
  if (name === 'weekly_review') return { result: { ok: true, ...weeklyReview() } }
  const r = await draftAsMe(String(a.context ?? ''), a.recipient ? String(a.recipient) : undefined, async (system, user) => (await ai.call('fast', { system, messages: [{ role: 'user', text: user }], temperature: 0.7, maxTokens: 400 }, { op: 'draft' })).text)
  return { result: { ...r, note: 'draft only: nothing was sent or typed' } }
}
