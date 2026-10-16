import { AiError, classifyHttp, classifyThrown } from '../errors'
import type { ChatMessage, ChatRequest, ChatResponse, Finish, LlmProvider, ToolCall, Usage } from '../../brain/types'

// Google's generateContent API (the free AI Studio key). Tools are function declarations; their calls come back as
// `functionCall` parts. Gemini 3 models want their own reasoning signatures returned with each tool call, so the assistant
// message is replayed verbatim (`raw`) whenever it came from Gemini. Errors are classified here (errors.ts); retries and
// fallbacks are the gateway's job.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/'

type Part = Record<string, unknown>
type Content = { role: 'user' | 'model'; parts: Part[] }

export function toContents(messages: ChatMessage[]): Content[] {
  const out: Content[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const parts: Part[] = []
      for (const im of m.images ?? []) parts.push({ inlineData: { mimeType: 'image/jpeg', data: im } })
      if (m.audio) parts.push({ inlineData: { mimeType: 'audio/wav', data: m.audio } })
      if (m.text) parts.push({ text: m.text })
      out.push({ role: 'user', parts: parts.length ? parts : [{ text: ' ' }] })
    } else if (m.role === 'assistant') {
      if (m.raw?.kind === 'gemini') { out.push(m.raw.value as Content); continue }
      const parts: Part[] = []
      if (m.text) parts.push({ text: m.text })
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args } })
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: ' ' }] })
    } else if (m.toolResult) {
      // all results of one round travel together in one user turn
      const part = { functionResponse: { name: m.toolResult.name, response: { result: m.toolResult.result } } }
      const last = out[out.length - 1]
      if (last && last.role === 'user' && last.parts.every(p => 'functionResponse' in p)) last.parts.push(part)
      else out.push({ role: 'user', parts: [part] })
    }
  }
  return out
}

function finishOf(reason: unknown, blocked: boolean): Finish {
  const r = String(reason ?? '')
  if (blocked || /^(SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|IMAGE_SAFETY|LANGUAGE)$/.test(r)) return 'safety'
  if (r === 'RECITATION') return 'recitation'
  if (r === 'MAX_TOKENS') return 'length'
  if (/MALFORMED_FUNCTION_CALL|UNEXPECTED_TOOL_CALL/.test(r)) return 'malformed'
  return r === 'STOP' || !r ? 'stop' : 'other'
}

export function parseResponse(j: any, id: string, model: string): ChatResponse {
  const cand = j?.candidates?.[0]
  const parts: Part[] = cand?.content?.parts ?? []
  let text = ''
  const toolCalls: ToolCall[] = []
  for (const p of parts) {
    if (typeof p.text === 'string' && !p.thought) text += p.text
    const fc = p.functionCall as { name?: string; args?: Record<string, unknown>; id?: string } | undefined
    if (fc?.name) toolCalls.push({ id: fc.id ?? `${fc.name}-${toolCalls.length}-${Math.random().toString(36).slice(2, 6)}`, name: fc.name, args: fc.args ?? {} })
  }
  const u = j?.usageMetadata ?? {}
  const finish = finishOf(cand?.finishReason, !cand && !!j?.promptFeedback?.blockReason)
  return {
    text: text.trim(), toolCalls, provider: id, model, finish,
    malformed: finish === 'malformed' ? String(cand?.finishMessage ?? 'the function call was rejected as malformed') : undefined,
    usage: { in: Number(u.promptTokenCount) || 0, out: Number(u.candidatesTokenCount) || 0, cached: Number(u.cachedContentTokenCount) || 0 },
    raw: cand?.content ? { kind: 'gemini', value: cand.content } : undefined,
  }
}

function sseJson(block: string): any[] {
  const out: any[] = []
  for (const line of block.split('\n')) {
    if (!line.startsWith('data:')) continue
    try { out.push(JSON.parse(line.slice(5))) } catch { /* partial line: the next chunk completes it */ }
  }
  return out
}

/** the text inside the `data:` lines of an SSE block from streamGenerateContent */
export function sseText(block: string): string {
  let out = ''
  for (const j of sseJson(block)) for (const p of j.candidates?.[0]?.content?.parts ?? []) if (!p.thought && typeof p.text === 'string') out += p.text
  return out
}

export class GeminiProvider implements LlmProvider {
  constructor(readonly id: string, readonly name: string, readonly model: string, private key: () => string | null) {}

  private url(method: string) { return `${BASE}${encodeURIComponent(this.model)}:${method}` }
  private needKey(): string { const k = this.key(); if (!k) throw new AiError('AUTH', 'no Gemini key', 401, { provider: this.id }); return k }

  private async send(url: string, key: string, body: string, signal?: AbortSignal): Promise<Response> {
    let r: Response
    try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body, signal }) } catch (e) { throw classifyThrown(e) }
    if (!r.ok) throw classifyHttp({ provider: 'gemini', status: r.status, body: (await r.text().catch(() => '')).slice(0, 1500), headers: r.headers })
    return r
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const key = this.needKey()
    const body = (thinkingOff: boolean) => JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: toContents(req.messages),
      ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools }] } : {}),
      generationConfig: {
        temperature: req.temperature ?? 0.4, maxOutputTokens: req.maxTokens ?? 2048,
        ...(req.json ? { responseMimeType: 'application/json' } : {}),
        ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    })
    const call = async (thinkingOff: boolean): Promise<ChatResponse> => {
      if (!req.onText) return parseResponse(await (await this.send(this.url('generateContent'), key, body(thinkingOff), req.signal)).json(), this.id, this.model)
      const r = await this.send(this.url('streamGenerateContent') + '?alt=sse', key, body(thinkingOff), req.signal)
      if (!r.body) throw new AiError('NETWORK', 'empty stream')
      const dec = new TextDecoder()
      const parts: Part[] = []
      let buf = '', text = '', last: any = null, finishReason: unknown, usage: unknown, started = false
      try {
        for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
          buf += dec.decode(chunk, { stream: true })
          let i: number
          while ((i = buf.indexOf('\n\n')) >= 0) {
            for (const j of sseJson(buf.slice(0, i))) {
              started = true; last = j
              const c = j.candidates?.[0]
              for (const p of c?.content?.parts ?? []) { parts.push(p); if (!p.thought && typeof p.text === 'string') text += p.text }
              if (c?.finishReason) finishReason = c.finishReason
              if (j.usageMetadata) usage = j.usageMetadata
            }
            buf = buf.slice(i + 2)
            req.onText(text)
          }
        }
      } catch (e) {
        const err = classifyThrown(e)
        throw started && err.kind !== 'ABORTED' ? new AiError('STREAM_DROP', err.message, 0, { partialText: text }) : err
      }
      return parseResponse({ candidates: [{ content: { parts }, finishReason }], usageMetadata: usage, promptFeedback: last?.promptFeedback }, this.id, this.model)
    }
    try { return await call(!req.tools?.length) } catch (e) {
      // some models reject a thinking budget of 0
      if (e instanceof AiError && e.kind === 'BAD_REQUEST' && !req.tools?.length) return call(false)
      throw e
    }
  }

  /** an answer grounded in a Google search: the text plus the pages it used */
  async search(question: string, signal?: AbortSignal): Promise<{ text: string; sources: { title: string; url: string }[]; usage: Usage }> {
    const key = this.needKey()
    const r = await this.send(this.url('generateContent'), key, JSON.stringify({ contents: [{ role: 'user', parts: [{ text: question }] }], tools: [{ googleSearch: {} }], generationConfig: { temperature: 0.2, maxOutputTokens: 1500 } }), signal)
    const j = (await r.json()) as any
    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: Part) => (typeof p.text === 'string' ? p.text : '')).join('').trim()
    const chunks: any[] = j?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
    const u = j?.usageMetadata ?? {}
    return { text, sources: chunks.map(c => ({ title: String(c?.web?.title ?? ''), url: String(c?.web?.uri ?? '') })).filter(s => s.url).slice(0, 6), usage: { in: Number(u.promptTokenCount) || 0, out: Number(u.candidatesTokenCount) || 0, cached: 0 } }
  }

  async embed(texts: string[], kind: 'doc' | 'query', dims: number, signal?: AbortSignal): Promise<{ vectors: number[][]; usage: Usage }> {
    const key = this.needKey()
    const r = await this.send(this.url('batchEmbedContents'), key, JSON.stringify({ requests: texts.map(t => ({ model: `models/${this.model}`, content: { parts: [{ text: t.slice(0, 2000) }] }, taskType: kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT', outputDimensionality: dims })) }), signal)
    const j = (await r.json()) as { embeddings?: { values?: number[] }[] }
    return { vectors: (j.embeddings ?? []).map(e => e.values ?? []), usage: { in: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0), out: 0, cached: 0 } }
  }

  /** open the connection to Google while the user is still talking, so the real request skips the TLS handshake */
  warm() {
    const key = this.key()
    if (!key) return
    void fetch(`${BASE}${encodeURIComponent(this.model)}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(8000) }).then(r => r.arrayBuffer()).catch(() => undefined)
  }
}

/** the models this key can use for the Live API (bidiGenerateContent), from the models list; used by `--livetest` */
export async function listLiveModels(key: string): Promise<string[]> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw classifyHttp({ provider: 'gemini', status: r.status, body: (await r.text().catch(() => '')).slice(0, 500), headers: r.headers })
  const j = (await r.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] }
  return (j.models ?? []).filter(m => m.supportedGenerationMethods?.includes('bidiGenerateContent')).map(m => String(m.name).replace(/^models\//, ''))
}
