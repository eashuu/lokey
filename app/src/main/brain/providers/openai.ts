import { ProviderError, toJsonSchema, type ChatMessage, type ChatRequest, type ChatResponse, type LlmProvider, type ToolCall } from '../types'

// Any OpenAI-compatible /chat/completions endpoint: FreeLLMAPI (a local router over many providers' free tiers), OpenRouter's free
// models, Groq, Cerebras, Ollama... One adapter covers them all; only the base URL, the model and the key differ.

export function toOpenAiMessages(system: string, messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') {
      if (m.images?.length) out.push({ role: 'user', content: [...m.images.map(im => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${im}` } })), { type: 'text', text: m.text ?? '' }] })
      else out.push({ role: 'user', content: m.text ?? '' })
    } else if (m.role === 'assistant') {
      if (m.raw?.kind === 'openai') { out.push(m.raw.value); continue }
      out.push({
        role: 'assistant', content: m.text || null,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
      })
    } else if (m.toolResult) {
      out.push({ role: 'tool', tool_call_id: m.toolResult.id, content: typeof m.toolResult.result === 'string' ? m.toolResult.result : JSON.stringify(m.toolResult.result) })
    }
  }
  return out
}

export function parseOpenAi(j: any, id: string, model: string): ChatResponse {
  const msg = j?.choices?.[0]?.message ?? {}
  const toolCalls: ToolCall[] = []
  for (const c of msg.tool_calls ?? []) {
    let args: Record<string, unknown> = {}
    try { args = c?.function?.arguments ? JSON.parse(c.function.arguments) : {} } catch { args = {} }
    if (c?.function?.name) toolCalls.push({ id: String(c.id ?? `${c.function.name}-${toolCalls.length}`), name: c.function.name, args })
  }
  const u = j?.usage ?? {}
  return {
    text: typeof msg.content === 'string' ? msg.content.trim() : '', toolCalls, provider: id, model: String(j?.model ?? model),
    usage: { in: Number(u.prompt_tokens) || 0, out: Number(u.completion_tokens) || 0, cached: Number(u.prompt_tokens_details?.cached_tokens) || 0 },
    raw: { kind: 'openai', value: { role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) } },
  }
}

export class OpenAiProvider implements LlmProvider {
  constructor(readonly id: string, readonly name: string, readonly model: string, private baseUrl: string, private key: () => string | null) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.model.trim()) throw new ProviderError(`${this.name}: choose a model first`, 400, false)
    const key = this.key()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (key) headers.Authorization = `Bearer ${key}`
    let r: Response
    try {
      r = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers, signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model: this.model, messages: toOpenAiMessages(req.system, req.messages), temperature: req.temperature ?? 0.4, max_tokens: req.maxTokens ?? 2048,
          ...(req.tools?.length ? { tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters ?? { type: 'OBJECT', properties: {} }) } })), tool_choice: 'auto' } : {}),
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      })
    } catch (e) {
      if (req.signal?.aborted) throw e
      throw new ProviderError(e instanceof Error ? e.message : String(e), 0, true)
    }
    if (!r.ok) throw new ProviderError(`${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`, r.status, r.status === 429 || r.status >= 500 || r.status === 408)
    return parseOpenAi(await r.json(), this.id, this.model)
  }
}
