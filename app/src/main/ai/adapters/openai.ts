import { AiError, classifyHttp, classifyThrown } from '../errors'
import { IDLE_MS } from '../catalog'
import { toJsonSchema, type ChatMessage, type ChatRequest, type ChatResponse, type Finish, type LlmProvider, type ToolCall, type Usage } from '../../brain/types'

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

const finishOf = (r: unknown): Finish => (r === 'length' ? 'length' : r === 'content_filter' ? 'safety' : r === 'stop' || r === 'tool_calls' || r === 'function_call' || !r ? 'stop' : 'other')

export function parseOpenAi(j: any, id: string, model: string): ChatResponse {
  const msg = j?.choices?.[0]?.message ?? {}
  const toolCalls: ToolCall[] = []
  let malformed: string | undefined
  for (const c of msg.tool_calls ?? []) {
    let args: Record<string, unknown> = {}
    try { args = c?.function?.arguments ? JSON.parse(c.function.arguments) : {} } catch { malformed = `the arguments of ${c?.function?.name ?? 'a tool call'} were not valid JSON`; args = {} }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) { malformed = `the arguments of ${c?.function?.name ?? 'a tool call'} were not an object`; args = {} }
    if (c?.function?.name) toolCalls.push({ id: String(c.id ?? `${c.function.name}-${toolCalls.length}`), name: c.function.name, args })
  }
  const u = j?.usage ?? {}
  return {
    text: typeof msg.content === 'string' ? msg.content.trim() : '', toolCalls, provider: id, model: String(j?.model ?? model), finish: finishOf(j?.choices?.[0]?.finish_reason), malformed,
    usage: { in: Number(u.prompt_tokens) || 0, out: Number(u.completion_tokens) || 0, cached: Number(u.prompt_tokens_details?.cached_tokens) || 0 },
    raw: { kind: 'openai', value: { role: 'assistant', content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) } },
  }
}

export class OpenAiProvider implements LlmProvider {
  constructor(readonly id: string, readonly name: string, readonly model: string, private baseUrl: string, private key: () => string | null) {}

  private url(p: string) { return `${this.baseUrl.replace(/\/+$/, '')}${p}` }
  private headers() {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    const key = this.key()
    if (key) h.Authorization = `Bearer ${key}`
    return h
  }

  /**
   * Streams (SSE) and assembles the reply, so a dropped connection keeps what had arrived (`partialText` on the STREAM_DROP, which the gateway can
   * hand to the next model to continue), and a server that goes quiet is cut off after IDLE_MS instead of at the long whole-call deadline.
   * A server that ignores `stream` and answers with plain JSON is handled as before.
   */
  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.model.trim()) throw new AiError('BAD_REQUEST', `${this.name}: choose a model first`, 400)
    const idle = new AbortController()
    let timer: ReturnType<typeof setTimeout> | null = null, idled = false
    const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { idled = true; idle.abort(new Error(`no data for ${IDLE_MS / 1000}s`)) }, IDLE_MS) }
    const done = () => { if (timer) clearTimeout(timer); timer = null }
    const signal = req.signal ? AbortSignal.any([req.signal, idle.signal]) : idle.signal
    arm()
    let r: Response
    try {
      r = await fetch(this.url('/chat/completions'), {
        method: 'POST', headers: this.headers(), signal,
        body: JSON.stringify({
          model: this.model, messages: toOpenAiMessages(req.system, req.messages), temperature: req.temperature ?? 0.4, max_tokens: req.maxTokens ?? 2048,
          stream: true, stream_options: { include_usage: true },
          ...(req.tools?.length ? { tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters ?? { type: 'OBJECT', properties: {} }) } })), tool_choice: 'auto' } : {}),
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      })
    } catch (e) { done(); throw idled && !req.signal?.aborted ? new AiError('TIMEOUT', 'the server did not start answering') : classifyThrown(e) }
    if (!r.ok) { done(); throw classifyHttp({ provider: 'openai', status: r.status, body: (await r.text().catch(() => '')).slice(0, 1500), headers: r.headers }) }
    if (!/event-stream/i.test(r.headers.get('content-type') ?? '') || !r.body) {
      try { const j = await r.json(); done(); const out = parseOpenAi(j, this.id, this.model); req.onText?.(out.text); return out } catch (e) { done(); throw idled && !req.signal?.aborted ? new AiError('TIMEOUT', 'the server stopped answering') : classifyThrown(e) }
    }
    const dec = new TextDecoder()
    const calls: { id?: string; name?: string; args: string }[] = []
    let buf = '', text = '', finish: unknown, usage: unknown, model = this.model, started = false
    const eat = (line: string) => {
      if (!line.startsWith('data:')) return
      const d = line.slice(5).trim()
      if (!d || d === '[DONE]') return
      let j: any
      try { j = JSON.parse(d) } catch { return }   // a partial line: the next chunk completes it
      started = true
      if (j.model) model = String(j.model)
      if (j.usage) usage = j.usage
      const ch = j.choices?.[0]
      if (!ch) return
      if (ch.finish_reason) finish = ch.finish_reason
      const dl = ch.delta ?? {}
      if (typeof dl.content === 'string' && dl.content) { text += dl.content; req.onText?.(text) }
      for (const tc of dl.tool_calls ?? []) {
        const i = Number(tc.index ?? 0)
        const c = (calls[i] ??= { args: '' })
        if (tc.id) c.id = String(tc.id)
        if (tc.function?.name) c.name = (c.name ?? '') + String(tc.function.name)
        if (tc.function?.arguments) c.args += String(tc.function.arguments)
      }
    }
    try {
      for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
        arm()
        buf += dec.decode(chunk, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) { eat(buf.slice(0, i).trim()); buf = buf.slice(i + 1) }
      }
      eat(buf.trim())
    } catch (e) {
      done()
      const err = idled && !req.signal?.aborted ? new AiError(started ? 'STREAM_DROP' : 'TIMEOUT', 'the server went quiet') : classifyThrown(e)
      throw started && err.kind !== 'ABORTED' && err.kind !== 'TIMEOUT' ? new AiError('STREAM_DROP', err.message, 0, { partialText: text }) : err.kind === 'TIMEOUT' && started ? new AiError('STREAM_DROP', err.message, 0, { partialText: text }) : err
    }
    done()
    const out = parseOpenAi({ model, usage, choices: [{ finish_reason: finish, message: { content: text, tool_calls: calls.filter(c => c.name).map((c, i) => ({ id: c.id ?? `${c.name}-${i}`, function: { name: c.name, arguments: c.args } })) } }] }, this.id, this.model)
    return out
  }

  /** /embeddings (Ollama, LM Studio, OpenAI-style): vectors cut to `dims` so they sit in the same space size as the others */
  async embed(texts: string[], _kind: 'doc' | 'query', dims: number, signal?: AbortSignal): Promise<{ vectors: number[][]; usage: Usage }> {
    if (!this.model.trim()) throw new AiError('BAD_REQUEST', `${this.name}: choose a model first`, 400)
    let r: Response
    try { r = await fetch(this.url('/embeddings'), { method: 'POST', headers: this.headers(), signal, body: JSON.stringify({ model: this.model, input: texts.map(t => t.slice(0, 2000)) }) }) } catch (e) { throw classifyThrown(e) }
    if (!r.ok) throw classifyHttp({ provider: 'openai', status: r.status, body: (await r.text().catch(() => '')).slice(0, 1500), headers: r.headers })
    const j = (await r.json()) as { data?: { embedding?: number[] }[] }
    return { vectors: (j.data ?? []).map(d => (d.embedding ?? []).slice(0, dims)), usage: { in: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0), out: 0, cached: 0 } }
  }
}
