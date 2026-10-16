// The error taxonomy (round-9 plan 3.2). Each adapter turns what the provider said into one AiError.kind; nobody downstream
// reads message text again. The gateway decides what to do for each kind (retry, wait, fall back, rest the provider).
export type AiKind =
  | 'RATE_MINUTE' | 'QUOTA_DAY' | 'OVERLOADED' | 'TIMEOUT' | 'NETWORK' | 'AUTH' | 'BAD_REQUEST' | 'CONTEXT_OVERFLOW'
  | 'SAFETY_BLOCK' | 'RECITATION' | 'MALFORMED_TOOL' | 'EMPTY' | 'TRUNCATED' | 'STREAM_DROP' | 'ABORTED'
  | 'NO_PROVIDER' // nothing is set up (or allowed) for the role: not a provider failure

/** where a cooldown or refusal came from (docs/AI-FAILSAFE.md 3.4): authoritative = the provider said so (Retry-After, quotaId); heuristic = our guess; credit = 402; tier = 403; key = 401 */
/** where the person is told to go to fix a key or add a model (the Models page replaces the Brain page: change it here and in nothing else) */
export const SETTINGS_WHERE = 'Settings > Brain'
export type Source = 'authoritative' | 'heuristic' | 'credit' | 'tier' | 'key'

/** the kinds after which a request is worth asking again later (a job parks instead of failing). AUTH waits too: the person can fix the key and the job carries on. */
export const WAIT_KINDS: ReadonlySet<AiKind> = new Set<AiKind>(['RATE_MINUTE', 'QUOTA_DAY', 'OVERLOADED', 'TIMEOUT', 'NETWORK', 'STREAM_DROP', 'AUTH'])

export class AiError extends Error {
  /** wait this long before asking again (RATE_MINUTE) */
  retryAfterMs?: number
  /** the soonest moment (epoch ms) it is worth trying again, set by the gateway on the error it finally throws */
  until?: number
  source?: Source
  /** STREAM_DROP: the text that had arrived */
  partialText?: string
  /** the provider's own wording, kept when `message` was replaced by a sentence for the person */
  detail?: string
  /** when a daily quota comes back (QUOTA_DAY), epoch ms */
  resetAt?: number
  provider?: string
  /** demerit points this failure earns the model (health.ts) */
  pts = 0
  /** TRUNCATED: what the model did say */
  partial?: unknown
  /** which providers failed and why, one entry each (set by the gateway on the error it finally throws): the notice names them */
  failures?: Failure[]
  /** the fallback trail, `provider:KIND > provider:KIND` */
  chain?: string
  constructor(readonly kind: AiKind, message: string, readonly status = 0, o: { retryAfterMs?: number; resetAt?: number; provider?: string; pts?: number; source?: Source; partialText?: string; until?: number } = {}) {
    super(message)
    this.name = 'AiError'
    Object.assign(this, o)
  }
}

export interface Failure { provider: string; kind: AiKind; why: string }
/** a few words for a provider's failure, to follow its name: "Gemini Flash hit its daily limit" */
export function shortWhy(kind: AiKind, source?: Source): string {
  return kind === 'QUOTA_DAY' ? 'hit its daily limit' : kind === 'RATE_MINUTE' ? 'is rate limited' : kind === 'AUTH' ? (source === 'credit' ? 'has no credit left' : source === 'tier' ? 'does not allow this model with your key' : 'key was rejected') : kind === 'OVERLOADED' ? 'is overloaded' : kind === 'TIMEOUT' ? 'was too slow' : kind === 'NETWORK' ? 'could not be reached' : kind === 'STREAM_DROP' ? 'cut off mid-answer' : kind === 'MALFORMED_TOOL' || kind === 'EMPTY' ? 'gave a bad answer' : kind === 'BAD_REQUEST' ? 'rejected the request' : 'failed'
}
/** "Gemini Flash hit its daily limit; OpenRouter key was rejected; FreeLLMAPI is rate limited" (or the plain message when no trail is known) */
export function failureLine(e: unknown): string {
  if (e instanceof AiError && e.failures?.length) return e.failures.map(f => `${f.provider} ${f.why}`).join('; ')
  return e instanceof Error ? e.message : String(e)
}

export const isAi = (e: unknown): e is AiError => e instanceof AiError
/** an error after which asking again later can work */
export const isWait = (e: unknown): e is AiError => e instanceof AiError && WAIT_KINDS.has(e.kind)

type Headers_ = { get(name: string): string | null } | Record<string, string> | undefined
const header = (h: Headers_, n: string): string | null => {
  if (!h) return null
  if (typeof (h as { get?: unknown }).get === 'function') return (h as { get(n: string): string | null }).get(n)
  const hit = Object.entries(h as Record<string, string>).find(([k]) => k.toLowerCase() === n)
  return hit ? hit[1] : null
}

/** "34s", "1.5s", "2m59.56s", "250ms", "45" (seconds) -> ms */
export function parseDuration(s: string | null | undefined): number | undefined {
  if (!s) return undefined
  const t = s.trim()
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 1000)
  let ms = 0, any = false
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) { any = true; ms += Number(m[1]) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const)[m[2] as 'ms' | 's' | 'm' | 'h'] }
  return any ? Math.round(ms) : undefined
}

/** next local midnight in `tz` (Google's daily quotas reset at midnight Pacific; most others at UTC midnight) */
export function nextMidnight(now: number, tz: string): number {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(now)).map(x => [x.type, x.value]))
    const sinceMidnight = (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000
    return now + (86_400_000 - sinceMidnight)
  } catch { return now + 86_400_000 }
}
export const dailyReset = (kind: 'gemini' | 'openai', now: number) => nextMidnight(now, kind === 'gemini' ? 'America/Los_Angeles' : 'UTC')

const DAY_WORDS = /per ?day|daily|free-models-per-day|requests per day|tokens per day|insufficient_quota|billing hard limit|spend (limit|cap)|credit balance/i
const LEN_WORDS = /context (length|window)|maximum context|too long|token limit|exceeds the maximum number of tokens|input token count|prompt is too long|reduce the length/i

/**
 * What a non-2xx answer means. `provider` is the adapter family; `body` is the raw response text.
 * Understands Gemini (error.status, details[QuotaFailure|RetryInfo]), OpenAI-style (error.code/type), OpenRouter, Groq and Anthropic wording.
 */
export function classifyHttp(o: { provider: 'gemini' | 'openai'; status: number; body: string; headers?: Headers_; now?: number }): AiError {
  const now = o.now ?? Date.now()
  let j: any = null
  try { j = JSON.parse(o.body) } catch { /* plain text */ }
  const err = j?.error ?? j ?? {}
  const msg = String(err.message ?? (typeof err === 'string' ? err : '') ?? '') || o.body.slice(0, 200)
  const text = `${o.status} ${msg.slice(0, 220)}`
  const gStatus = String(err.status ?? '')
  const details: any[] = Array.isArray(err.details) ? err.details : []
  const quotaIds = details.flatMap(d => (Array.isArray(d?.violations) ? d.violations.map((v: any) => String(v?.quotaId ?? '') + ' ' + String(v?.quotaMetric ?? '')) : [])).join(' ')
  const retryInfo = details.find(d => String(d?.['@type'] ?? '').endsWith('RetryInfo'))?.retryDelay
  const retryMs = parseDuration(header(o.headers, 'retry-after')) ?? parseDuration(retryInfo) ?? parseDuration(header(o.headers, 'x-ratelimit-reset-requests')) ?? parseDuration(header(o.headers, 'x-ratelimit-reset-tokens')) ?? parseDuration(/retry in ([\d.]+)s/i.exec(msg)?.[1]) ?? undefined
  const mk = (kind: AiKind, extra: { retryAfterMs?: number; resetAt?: number; source?: Source } = {}) => new AiError(kind, text, o.status, extra)

  // 401 = the key is wrong, 402 = no credit left, 403 = this key may not use this model / region / tier (or, at Google, the key is not allowed at all)
  if (o.status === 401) return mk('AUTH', { source: 'key' })
  if (o.status === 402) return mk('AUTH', { source: 'credit' })
  if (o.status === 403) return mk('AUTH', { source: /api[_ ]?key|key (is )?(not valid|invalid|expired)|API_KEY|credential/i.test(msg + JSON.stringify(details).slice(0, 300)) ? 'key' : 'tier' })
  if (o.status === 400 && /api[_ ]key|API_KEY_INVALID|invalid x-api-key/i.test(msg + gStatus + JSON.stringify(details).slice(0, 400))) return mk('AUTH', { source: 'key' })
  if (o.status === 429 || gStatus === 'RESOURCE_EXHAUSTED') {
    const perDay = /perday/i.test(quotaIds) || (!/perminute/i.test(quotaIds) && DAY_WORDS.test(msg + ' ' + (err.code ?? '') + ' ' + (err.type ?? '')))
    // a header-reported wait of more than an hour means the day's budget is gone even if the body does not say so
    if (perDay || (retryMs ?? 0) > 3_600_000) {
      const reset = header(o.headers, 'x-ratelimit-reset')
      const abs = reset && /^\d{12,}$/.test(reset) ? Number(reset) : undefined // OpenRouter: epoch ms
      return mk('QUOTA_DAY', { resetAt: abs ?? (retryMs && retryMs > 3_600_000 ? now + retryMs : dailyReset(o.provider, now)), source: abs || /perday/i.test(quotaIds) || (retryMs ?? 0) > 3_600_000 ? 'authoritative' : 'heuristic' })
    }
    // a Retry-After / RetryInfo is the provider's word; a bare 429 ("all models exhausted") is our guess and is re-probed early
    return mk('RATE_MINUTE', { retryAfterMs: retryMs, source: retryMs !== undefined ? 'authoritative' : 'heuristic' })
  }
  if (o.status === 408) return mk('TIMEOUT')
  if (o.status >= 500 || /overloaded/i.test(String(err.type ?? '') + msg)) return mk('OVERLOADED', { retryAfterMs: retryMs })
  if (o.status === 413 || LEN_WORDS.test(msg)) return mk('CONTEXT_OVERFLOW')
  return mk('BAD_REQUEST')
}

/** a thrown fetch/stream error: the user's abort, a timeout, or the network */
export function classifyThrown(e: unknown, userSignal?: AbortSignal): AiError {
  if (e instanceof AiError) return e
  if (userSignal?.aborted) return new AiError('ABORTED', 'stopped')
  const name = e instanceof Error ? e.name : ''
  const msg = e instanceof Error ? e.message : String(e)
  if (name === 'TimeoutError' || name === 'AbortError' || /timed? ?out|aborted due to timeout/i.test(msg)) return new AiError('TIMEOUT', msg || 'timed out')
  return new AiError('NETWORK', msg)
}

/** a one-line explanation for the person, from the kind (the gateway's last error is what callers show) */
export function userMessage(e: unknown, providerName?: string): string {
  if (!(e instanceof AiError)) return e instanceof Error ? e.message : String(e)
  const who = providerName ?? e.provider ?? 'the model'
  switch (e.kind) {
    case 'QUOTA_DAY': return `${who}'s free daily limit is used up${e.resetAt ? ` (back about ${new Date(e.resetAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})` : ''}.`
    case 'RATE_MINUTE': return `${who} is rate limited for a moment.`
    case 'AUTH': return e.source === 'credit' ? `${who} has no credit left. Add credit or use another key.` : e.source === 'tier' ? `${who} does not allow this model with your key. Try another model or key.` : `The ${who} key was rejected. Check it in ${SETTINGS_WHERE}.`
    case 'NETWORK': return `Couldn't reach ${who}. Check the connection.`
    case 'TIMEOUT': return `${who} took too long.`
    case 'OVERLOADED': return `${who} is overloaded right now.`
    case 'SAFETY_BLOCK': return `${who} refused this.`
    case 'BAD_REQUEST': return `${who} could not handle that request.`
    case 'STREAM_DROP': return `${who} cut off in the middle of its answer.`
    case 'EMPTY': return `${who} returned nothing.`
    case 'MALFORMED_TOOL': return `${who} made a mistake while using a tool.`
    case 'CONTEXT_OVERFLOW': return `That was too long for ${who}.`
    case 'TRUNCATED': return `${who}'s answer was cut off.`
    case 'RECITATION': return `${who} would not answer without quoting a source.`
    case 'NO_PROVIDER': return e.message
    case 'ABORTED': return 'Stopped.'
    default: return e.message
  }
}
