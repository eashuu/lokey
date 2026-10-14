import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrainRole, ProviderConfig } from '@shared/bridge'
import { dataDir, settings } from '../settings'
import { getSecret } from '../agent/keystore'
import { GeminiProvider } from './providers/gemini'
import { OpenAiProvider } from './providers/openai'
import { ProviderError, type ChatRequest, type ChatResponse, type LlmProvider } from './types'

// Which model answers a request. Providers are listed in the order they should be tried; a request names a ROLE (fast = cheap
// classification and summaries, main = the agent loop, heavy = hard problems) and the router walks the providers that serve that
// role, skipping the ones that are off, have no key, hit their daily limit or just failed (rate limited / down: skipped for a
// while). Every call is counted per provider per day so the free tiers can be budgeted.
export interface ProviderUsage { requests: number; in: number; out: number; errors: number; last?: string }
interface UsageFile { day: string; providers: Record<string, ProviderUsage> }

const usageFile = join(dataDir, 'usage.json')
const today = () => new Date().toDateString()
const COOL_MS = 60_000
const COOL_429_MS = 150_000

export class Router {
  private usage: UsageFile = { day: today(), providers: {} }
  private cooling = new Map<string, number>()
  private built = new Map<string, { sig: string; p: LlmProvider }>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  /** `cfg` and `key` are functions so tests can stand in for settings and the key store */
  constructor(private cfg: () => ProviderConfig[] = () => settings.value.brain.providers, private key: (ref: string) => string | null = getSecret, persist = true) {
    if (persist) { try { const u = JSON.parse(readFileSync(usageFile, 'utf8')) as UsageFile; if (u.day === today()) this.usage = u } catch { /* first run */ } }
    this.persist = persist
  }
  private persist: boolean

  private build(c: ProviderConfig): LlmProvider {
    const sig = JSON.stringify([c.kind, c.baseUrl, c.model])
    const hit = this.built.get(c.id)
    if (hit && hit.sig === sig) return hit.p
    const p = c.kind === 'gemini' ? new GeminiProvider(c.id, c.name, c.model, () => this.key(c.keyRef)) : new OpenAiProvider(c.id, c.name, c.model, c.baseUrl, () => this.key(c.keyRef))
    this.built.set(c.id, { sig, p })
    return p
  }

  private ready(c: ProviderConfig): boolean {
    if (!c.enabled || !c.model.trim()) return false
    if (c.kind === 'gemini' && !this.key(c.keyRef)) return false
    if (c.kind === 'openai' && !c.baseUrl.trim()) return false
    return true
  }

  private roll() { if (this.usage.day !== today()) this.usage = { day: today(), providers: {} } }
  private u(id: string) { this.roll(); return (this.usage.providers[id] ??= { requests: 0, in: 0, out: 0, errors: 0 }) }

  /** the providers that may serve `role` right now, in the order they will be tried */
  candidates(role: BrainRole): ProviderConfig[] {
    const now = Date.now()
    return this.cfg().filter(c => c.roles.includes(role) && this.ready(c) && (c.dailyLimit <= 0 || this.u(c.id).requests < c.dailyLimit) && (this.cooling.get(c.id) ?? 0) <= now)
  }

  async chat(role: BrainRole, req: ChatRequest): Promise<ChatResponse> {
    let list = this.candidates(role)
    if (!list.length) {
      // everything is cooling down or limited: better to try a cooling one than to fail outright
      list = this.cfg().filter(c => c.roles.includes(role) && this.ready(c))
      if (!list.length) throw new ProviderError(`No model is set up for "${role}". Add a Gemini key or enable a provider in Settings > Brain.`, 0, false)
    }
    let last: unknown
    for (const c of list) {
      const p = this.build(c)
      try {
        const r = await p.chat(req)
        const u = this.u(c.id)
        u.requests++; u.in += r.usage.in; u.out += r.usage.out; u.last = new Date().toISOString()
        this.save()
        return r
      } catch (e) {
        if (req.signal?.aborted) throw e
        last = e
        const u = this.u(c.id)
        u.errors++; u.requests++
        this.save()
        if (e instanceof ProviderError && e.retryable) this.cooling.set(c.id, Date.now() + (e.status === 429 ? COOL_429_MS : COOL_MS))
      }
    }
    throw last instanceof Error ? last : new Error(String(last))
  }

  /** the first provider for a role that is a Gemini one (search grounding and vision-heavy calls need it) */
  gemini(role: BrainRole): GeminiProvider | null {
    const c = this.candidates(role).find(x => x.kind === 'gemini') ?? this.cfg().find(x => x.kind === 'gemini' && this.ready(x))
    return c ? (this.build(c) as GeminiProvider) : null
  }

  async test(id: string): Promise<{ ok: boolean; ms: number; reply?: string; error?: string }> {
    const c = this.cfg().find(x => x.id === id)
    if (!c) return { ok: false, ms: 0, error: 'unknown provider' }
    const t0 = Date.now()
    try {
      if (!this.ready(c)) return { ok: false, ms: 0, error: c.enabled ? (c.kind === 'gemini' ? 'no key saved' : 'choose a model and base URL') : 'switched off' }
      const r = await this.build(c).chat({ system: 'Reply with exactly: ok', messages: [{ role: 'user', text: 'ping' }], maxTokens: 16, temperature: 0 })
      return { ok: true, ms: Date.now() - t0, reply: r.text.slice(0, 40) }
    } catch (e) { return { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message.slice(0, 160) : String(e) } }
  }

  getUsage(): Record<string, ProviderUsage> { this.roll(); return { ...this.usage.providers } }

  private save() {
    if (!this.persist || this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(usageFile, JSON.stringify(this.usage)) } catch { /* the meter is a convenience */ }
    }, 1500)
    this.saveTimer.unref?.()
  }
}

export const router = new Router()
