import type { FunctionDecl } from '../agent/session'

// The common language every model backend is spoken to in. A conversation is a list of messages; the model may answer with text,
// with tool calls, or both; tool results go back as `tool` messages. Each provider turns this into its own wire format.
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  text?: string
  /** base64 JPEG pictures attached to a user message */
  images?: string[]
  /** assistant: the tool calls it made */
  toolCalls?: ToolCall[]
  /** tool: which call this answers */
  toolResult?: { id: string; name: string; result: unknown }
  /** assistant: the provider's own message, replayed as it came (some models insist on getting their own reasoning tokens back) */
  raw?: { kind: 'gemini' | 'openai'; value: unknown }
}

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  tools?: FunctionDecl[]
  maxTokens?: number
  temperature?: number
  /** ask for a JSON object as the answer */
  json?: boolean
  signal?: AbortSignal
}

export interface Usage { in: number; out: number; cached: number }

export interface ChatResponse {
  text: string
  toolCalls: ToolCall[]
  usage: Usage
  provider: string
  model: string
  raw?: ChatMessage['raw']
}

export interface LlmProvider {
  readonly id: string
  readonly name: string
  readonly model: string
  chat(req: ChatRequest): Promise<ChatResponse>
}

/** A backend refused or failed. `retryable`: another provider may do better right now (rate limit, outage, no network). */
export class ProviderError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) { super(message) }
}

/** Gemini declares schema types in capitals ("OBJECT"), OpenAI-style APIs want JSON Schema: lower-case them, recursively. */
export function toJsonSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toJsonSchema)
  if (!s || typeof s !== 'object') return s
  const o: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) o[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v)
  return o
}

export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** What a tool needs to start, list and stop background jobs (implemented by TaskManager; an interface so tools.ts does not import it). */
export interface TaskHost {
  spawn(o: { goal: string; role: string; backend?: 'api' | 'claude' | 'codex'; folder?: string; scheduled?: boolean; approved?: boolean; extra?: Record<string, unknown> }): { id: string } | { error: string }
  list(): import('@shared/voice').AgentTask[]
  stop(id: string): boolean
}
