import { ProviderError, type ChatMessage, type ChatRequest, type ChatResponse, type LlmProvider, type ToolCall } from '../types'

// Google's generateContent API (the free AI Studio key). Tools are function declarations; their calls come back as
// `functionCall` parts. Gemini 3 models want their own reasoning signatures returned with each tool call, so the assistant
// message is replayed verbatim (`raw`) whenever it came from Gemini.
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/'

type Part = Record<string, unknown>
type Content = { role: 'user' | 'model'; parts: Part[] }

export function toContents(messages: ChatMessage[]): Content[] {
  const out: Content[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const parts: Part[] = []
      for (const im of m.images ?? []) parts.push({ inlineData: { mimeType: 'image/jpeg', data: im } })
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
  return {
    text: text.trim(), toolCalls, provider: id, model,
    usage: { in: Number(u.promptTokenCount) || 0, out: Number(u.candidatesTokenCount) || 0, cached: Number(u.cachedContentTokenCount) || 0 },
    raw: cand?.content ? { kind: 'gemini', value: cand.content } : undefined,
  }
}

export class GeminiProvider implements LlmProvider {
  constructor(readonly id: string, readonly name: string, readonly model: string, private key: () => string | null) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const key = this.key()
    if (!key) throw new ProviderError('no Gemini key', 401, false)
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
    const call = async (thinkingOff: boolean) => {
      let r: Response
      try {
        r = await fetch(`${BASE}${encodeURIComponent(this.model)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: body(thinkingOff),
          signal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
        })
      } catch (e) {
        if (req.signal?.aborted) throw e
        throw new ProviderError(e instanceof Error ? e.message : String(e), 0, true)
      }
      if (!r.ok) throw new ProviderError(`${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`, r.status, r.status === 429 || r.status >= 500)
      return parseResponse(await r.json(), this.id, this.model)
    }
    try { return await call(!req.tools?.length) } catch (e) {
      // some models reject a thinking budget of 0
      if (e instanceof ProviderError && e.status === 400 && !req.tools?.length) return call(false)
      throw e
    }
  }

  /** an answer grounded in a Google search: the text plus the pages it used */
  async search(question: string, signal?: AbortSignal): Promise<{ text: string; sources: { title: string; url: string }[] }> {
    const key = this.key()
    if (!key) throw new ProviderError('no Gemini key', 401, false)
    const r = await fetch(`${BASE}${encodeURIComponent(this.model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: signal ?? AbortSignal.timeout(45_000),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: question }] }], tools: [{ googleSearch: {} }], generationConfig: { temperature: 0.2, maxOutputTokens: 1500 } }),
    })
    if (!r.ok) throw new ProviderError(`${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`, r.status, r.status === 429 || r.status >= 500)
    const j = (await r.json()) as any
    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: Part) => (typeof p.text === 'string' ? p.text : '')).join('').trim()
    const chunks: any[] = j?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
    return { text, sources: chunks.map(c => ({ title: String(c?.web?.title ?? ''), url: String(c?.web?.uri ?? '') })).filter(s => s.url).slice(0, 6) }
  }
}
