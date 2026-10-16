import type { ChatRequest, ChatResponse, LlmProvider, Usage } from '../brain/types'
import { AiError, classifyHttp, classifyThrown } from './errors'

// A scripted provider for self-checks (`--selfcheck`, ai/selfcheck.ts): each call plays the next fault from its script, then
// answers normally. HTTP-shaped faults go through the real classifiers with realistic bodies, so the taxonomy is tested too.
// Nothing here touches the network.
export type Fault =
  | 'ok' | 'rate_minute' | 'quota_day' | 'overloaded' | 'timeout' | 'network' | 'auth' | 'bad_request' | 'stream_drop' | 'hang'
  | 'bare_429' | 'not_found' | 'bad_gateway' | 'malformed_json' | 'invented_tool' | 'missing_arg' | 'empty' | 'truncated' | 'safety' | 'recitation'
export type Step = Fault | { fault: Fault; retryAfterSec?: number; partial?: string; text?: string; tool?: { name: string; args: Record<string, unknown> }; tools?: { name: string; args: Record<string, unknown> }[] }

const U: Usage = { in: 10, out: 5, cached: 0 }
const gemini429 = (extra: object) => JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota', details: [extra] } })

export class FaultProvider implements LlmProvider {
  calls = 0
  seen: ChatRequest[] = []
  /** while set, every call plays what this returns (a provider that is down until the test says otherwise); null = play the script */
  down: (() => Step | null) | null = null
  constructor(readonly id: string, private script: Step[] = [], readonly model = 'fault-1', readonly name = id, private family: 'gemini' | 'openai' = 'gemini') {}

  /** queue more faults */
  then(...s: Step[]) { this.script.push(...s); return this }

  private ok(text: string, tool?: { name: string; args: Record<string, unknown> }, finish: ChatResponse['finish'] = 'stop'): ChatResponse {
    return { text, toolCalls: tool ? [{ id: 't' + this.calls, ...tool }] : [], usage: U, provider: this.id, model: this.model, finish }
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls++; this.seen.push({ ...req, messages: structuredClone(req.messages) })   // a copy: the caller may edit its messages afterwards
    const s = this.down?.() ?? this.script.shift() ?? 'ok'
    const { fault, retryAfterSec, text, tool, tools, partial } = typeof s === 'string' ? { fault: s, retryAfterSec: undefined, text: undefined, tool: undefined, tools: undefined, partial: undefined } : s
    if (fault === 'ok' && tools?.length) return { text: text ?? '', toolCalls: tools.map((t, i) => ({ id: `t${this.calls}-${i}`, ...t })), usage: U, provider: this.id, model: this.model, finish: 'stop' }
    const http = (status: number, body: string, headers: Record<string, string> = {}) => classifyHttp({ provider: this.family, status, body, headers })
    switch (fault) {
      case 'ok': return this.ok(text ?? `from ${this.id}`, tool)
      case 'rate_minute': throw http(429, gemini429({ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: `${retryAfterSec ?? 30}s` }), {})
      case 'quota_day': throw http(429, gemini429({ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }))
      case 'overloaded': throw http(503, '{"error":{"message":"The model is overloaded. Please try again later."}}')
      case 'timeout': throw classifyThrown(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))
      case 'network': throw classifyThrown(new TypeError('fetch failed'))
      case 'auth': throw http(401, '{"error":{"message":"Invalid API key"}}')
      case 'bad_request': throw http(400, '{"error":{"message":"unsupported parameter"}}')
      case 'stream_drop': req.onText?.(partial ?? 'part'); throw new AiError('STREAM_DROP', 'connection closed after the first chunk', 0, { partialText: partial ?? 'part' })
      case 'bare_429': throw http(429, '{"error":{"message":"All models exhausted"}}')   // FreeLLMAPI's wording: no Retry-After, no quota id
      case 'not_found': throw http(404, '{"error":{"message":"model not found"}}')
      case 'bad_gateway': throw http(502, '{"error":{"message":"upstream_failed"}}')
      case 'hang': return new Promise<ChatResponse>((_, rej) => req.signal?.addEventListener('abort', () => rej(req.signal?.reason ?? new Error('aborted'))))
      case 'malformed_json': return { ...this.ok(''), malformed: 'the arguments of echo were not valid JSON', finish: 'stop' }
      case 'invented_tool': return this.ok('', { name: 'no_such_tool', args: {} })
      case 'missing_arg': return this.ok('', { name: tool?.name ?? 'echo', args: {} })
      case 'empty': return this.ok('')
      case 'truncated': return this.ok(text ?? 'a cut-off sen', undefined, 'length')
      case 'safety': return this.ok('', undefined, 'safety')
      case 'recitation': return this.ok('', undefined, 'recitation')
    }
  }

  async embed(texts: string[]): Promise<{ vectors: number[][]; usage: Usage }> {
    this.calls++
    const s = this.script.shift() ?? 'ok'
    const f = typeof s === 'string' ? s : s.fault
    if (f === 'quota_day') throw classifyHttp({ provider: 'gemini', status: 429, body: gemini429({ violations: [{ quotaId: 'EmbedRequestsPerDay' }] }) })
    if (f === 'empty') return { vectors: [], usage: U }
    return { vectors: texts.map((_, i) => Array.from({ length: 8 }, (_, k) => (i + 1) * (k + 1))), usage: U }
  }

  async search(q: string): Promise<{ text: string; sources: { title: string; url: string }[]; usage: Usage }> {
    this.calls++
    const s = this.script.shift() ?? 'ok'
    const f = typeof s === 'string' ? s : s.fault
    if (f === 'overloaded') throw classifyHttp({ provider: 'gemini', status: 503, body: '{}' })
    if (f === 'quota_day') throw classifyHttp({ provider: 'gemini', status: 429, body: gemini429({ violations: [{ quotaId: 'GroundingRequestsPerDay' }] }) })
    return { text: `answer to ${q}`, sources: [{ title: 't', url: 'https://example.test/' }], usage: U }
  }
}
