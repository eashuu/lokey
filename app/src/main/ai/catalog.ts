import type { BrainRole, ModelCaps, ProviderConfig } from '@shared/bridge'
import type { ChatRequest } from '../brain/types'

// The model catalog: which models exist (the providers the user set up in Settings > Brain, in the order they should be tried),
// what each can do, and which of them may serve a ROLE. Model ids live only in the settings defaults (shared/bridge.ts); nothing
// in the code names a model.
//
// Capabilities are inferred from the adapter kind and the model name, then overridden by `ProviderConfig.caps`, then widened by the
// roles the person ticked (a provider ticked for "transcribe" is taken to hear audio). They are NOT fetched from models.dev or
// OpenRouter yet (round-9 plan 3.1 mentions both): that needs a network call and a refresh policy of its own.
export const ROLES_ALL: BrainRole[] = ['fast', 'main', 'heavy', 'vision', 'ground', 'transcribe', 'search', 'embed', 'live']

/** when a role has no provider of its own, these roles' providers stand in (in this order) */
export const ROLE_FALLBACK: Record<BrainRole, BrainRole[]> = {
  fast: ['fast', 'main'], main: ['main'], heavy: ['heavy', 'main'], vision: ['vision', 'main'], ground: ['ground', 'vision', 'main'],
  transcribe: ['transcribe'], search: ['search'], embed: ['embed'], live: ['live'],
}

/** whole-request time limit per role (one attempt); the retry budget is 2 attempts per model and 4 models */
export const ROLE_DEADLINE_MS: Record<BrainRole, number> = { fast: 15_000, main: 60_000, heavy: 120_000, vision: 45_000, ground: 20_000, transcribe: 30_000, search: 45_000, embed: 15_000, live: 0 }
export const MAX_ATTEMPTS = 2
/** models tried for one request, the last-resort tail included (one slot of these is kept for the tail) */
export const MAX_CANDIDATES = 5
/** a model whose answer does not start (or goes quiet) for this long is given up on; the whole-call deadline is separate */
export const IDLE_MS = 20_000
/** FreeLLMAPI and similar routers have their own 45 s budget: a shorter deadline of ours would cut them off */
export const ROUTER_DEADLINE_MS = 50_000

/** the keys of a provider, first = primary (`keyRefs` is absent in files from before 0.9.0) */
export const keysOf = (c: ProviderConfig): string[] => (c.keyRefs?.length ? c.keyRefs : [c.keyRef])
/** the host a provider lives on (a failure of the host is a failure of every model there) */
export function hostOf(c: ProviderConfig): string {
  const u = c.baseUrl.trim()
  if (!u) return c.kind === 'gemini' ? 'gemini' : ''
  try { return new URL(u).host.toLowerCase() } catch { return u.toLowerCase() }
}
/** a local router that has its own time budget (FreeLLMAPI) */
export const isRouter = (c: ProviderConfig) => c.kind === 'openai' && (/freellm/i.test(c.id + c.name) || /:3001\b/.test(c.baseUrl))

const VISION_NAME = /vision|[-_]vl\b|llava|pixtral|gpt-4o|gpt-4\.1|gpt-5|gemini|claude|llama-?4|scout|maverick|qwen.*vl|molmo|gemma-?3/i

export function capsOf(c: ProviderConfig): ModelCaps {
  const m = c.model.toLowerCase()
  const isEmbed = /embed/.test(m)
  const gem = c.kind === 'gemini'
  const base: ModelCaps = isEmbed
    ? { tools: false, vision: false, audioIn: false, json: false, embed: true, search: false, ctx: 8192, maxOut: 0 }
    : { tools: true, vision: gem || VISION_NAME.test(m), audioIn: gem, json: true, embed: false, search: gem, ctx: gem ? 1_000_000 : 32_000, maxOut: 8192 }
  const out: ModelCaps = { ...base, ...c.caps }
  // the person's own role choice widens what we assume
  if (c.roles.includes('vision') || c.roles.includes('ground')) out.vision = true
  if (c.roles.includes('transcribe')) out.audioIn = true
  if (c.roles.includes('search')) out.search = true
  if (c.roles.includes('embed')) out.embed = true
  return out
}

/** the admission entries (`id|model|role`) for models that are already set up: they keep working, only newly added models are tested first */
export function grandfather(providers: ProviderConfig[], existing: string[] = []): string[] {
  const keys = new Set(existing)
  for (const p of providers) if (p.enabled && p.model.trim()) for (const r of p.roles) if (r === 'main' || r === 'ground') keys.add(`${p.id}|${p.model}|${r}`)
  return [...keys]
}

/** what a request asks of the model */
export type Need = Partial<Pick<ModelCaps, 'tools' | 'vision' | 'audioIn' | 'embed' | 'search'>>
export function needOf(role: BrainRole, req?: ChatRequest): Need {
  const n: Need = {}
  if (role === 'embed') n.embed = true
  else if (role === 'search') n.search = true
  else {
    if (role === 'transcribe') n.audioIn = true
    if (role === 'vision' || role === 'ground') n.vision = true
    if (req?.tools?.length) n.tools = true
    if (req?.messages.some(m => m.images?.length)) n.vision = true
    if (req?.messages.some(m => m.audio)) n.audioIn = true
  }
  return n
}
export const meets = (caps: ModelCaps, n: Need) => (Object.keys(n) as (keyof Need)[]).every(k => !n[k] || caps[k])

/** the providers that list `role` first, then the ones of its stand-in roles, in the user's order; each at most once */
export function forRole(role: BrainRole, cfgs: ProviderConfig[]): ProviderConfig[] {
  const out: ProviderConfig[] = []
  for (const r of ROLE_FALLBACK[role]) for (const c of cfgs) if (c.roles.includes(r) && !out.includes(c)) out.push(c)
  return out
}

/** a request is only as big as its text; used to skip models whose window clearly cannot hold it */
export const roughTokens = (req: ChatRequest) => Math.ceil((req.system.length + req.messages.reduce((n, m) => n + (m.text?.length ?? 0) + JSON.stringify(m.toolResult?.result ?? '').length + JSON.stringify(m.toolCalls ?? '').length, 0)) / 3.5)
