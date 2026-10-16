import type { KeyFamily, ModelCaps, ModelKeyStatus, ModelPreset, ModelProviderStatus, ModelsStatus, ProviderConfig } from '@shared/bridge'
import { capsOf, keysOf } from './catalog'
import type { Gateway } from './gateway'

// The data behind Settings > Models (docs/AI-FAILSAFE.md section 6), backend half: `models.status` is built from what the gateway already
// knows (nothing new is measured) and pushed when it changes, at most twice a second; the commands add and remove keys, test one, pick
// the ordering preset and the offline switch. The page itself is built elsewhere; the browser mock lives in renderer/src/bridge/modelsMock.ts.
export interface ModelsDeps {
  gw: Gateway
  cfg: () => ProviderConfig[]
  /** replace the provider list in settings */
  setProviders: (list: ProviderConfig[]) => void
  getSecret: (ref: string) => string | null
  setSecret: (ref: string, value: string) => boolean
  clearSecret: (ref: string) => void
  preset: () => ModelPreset
  offlineLocal: () => boolean
  setPreset: (p: ModelPreset) => void
  setOfflineLocal: (on: boolean) => void
  voice: () => { rung: ModelsStatus['voice']['rung']; model: string; note?: string }
  /** ask a server which models it has (default: a request to its /models list). Tests pass their own, so no test touches the network. */
  discover?: (a: { baseUrl: string; key: string; family: KeyFamily }) => Promise<{ model: string; caps?: Partial<ModelCaps> } | null>
}

export const familyOf = (c: ProviderConfig, gw: Pick<Gateway, 'isLocal'>): KeyFamily =>
  c.kind === 'gemini' ? 'gemini' : /openrouter\.ai/i.test(c.baseUrl) ? 'openrouter' : gw.isLocal(c) && /ollama|11434/i.test(c.id + c.baseUrl) ? 'ollama' : 'other'

/** the family a pasted key belongs to, by its prefix (null = cannot tell) */
export function detectFamily(key: string): KeyFamily | null {
  const k = key.trim()
  if (/^AIza[\w-]{30,}$/.test(k)) return 'gemini'
  if (/^sk-or-/.test(k)) return 'openrouter'
  return null
}

const capNames = (c: ProviderConfig) => { const k = capsOf(c); return (['tools', 'vision', 'audioIn', 'json', 'embed', 'search'] as const).filter(n => k[n]).map(n => (n === 'audioIn' ? 'audio' : n)) }

export function buildStatus(d: ModelsDeps, now = Date.now()): ModelsStatus {
  const st = d.gw.status()
  const by = new Map(st.providers.map(p => [p.id, p]))
  const providers: ModelProviderStatus[] = d.cfg().map(c => {
    const p = by.get(c.id)
    const have = keysOf(c).filter(r => d.getSecret(r))
    const ks = d.gw.keyStates(c).filter(k => have.includes(k.ref))
    const keys: ModelKeyStatus[] = ks.map(k => ({ ref: k.ref, hint: (d.getSecret(k.ref) ?? '').slice(-4), state: k.state, until: k.until, note: k.note }))
    const keyless = c.kind === 'openai' && d.gw.isLocal(c)
    let state: ModelProviderStatus['state'] = 'ok'
    if (!c.enabled || !c.model.trim() || (!keys.length && !keyless && c.kind === 'gemini')) state = 'off'
    else if (keys.length && keys.every(k => k.state === 'rejected')) state = 'rejected'
    else if (keys.length && keys.every(k => k.state === 'limit')) state = 'limit'
    else if (keys.length && !keys.some(k => k.state === 'ok')) state = 'resting'
    else if ((p?.restingUntil ?? 0) > now || p?.breaker === 'open') state = 'resting'
    return { id: c.id, family: familyOf(c, d.gw), label: c.name, enabled: c.enabled, keys, model: c.model, caps: capNames(c), state, usedToday: p?.requests ?? 0, note: p?.note || undefined }
  })
  const heads = d.gw.candidates('main')
  const recent = d.gw.traces({ limit: 30 }).find(t => t.ok && t.provider !== 'live' && t.provider !== '-' && now - t.at < 10 * 60_000 && heads.some(h => h.id === t.provider))
  const useC = (recent && heads.find(h => h.id === recent.provider)) || heads[0]
  const voice = d.voice()
  const mode: ModelsStatus['mode'] = st.offline ? 'offline' : !useC || !['live', 'live-alt'].includes(voice.rung) ? 'degraded' : 'online'
  return {
    mode,
    using: useC ? { providerId: useC.id, model: useC.model, label: useC.name } : null,
    backups: Math.max(0, heads.length - (useC ? 1 : 0)),
    requestsToday: st.providers.filter(p => p.id !== 'live').reduce((n, p) => n + p.requests, 0),
    voice, providers, preset: d.preset(), offlineLocal: d.offlineLocal(),
  }
}

// ---- finding the model to use for a newly added key (one request to the server's /models list) -----------------------------------------
interface ListedModel { id?: string; context_length?: number; supported_parameters?: string[]; architecture?: { input_modalities?: string[] }; pricing?: { prompt?: string } }
export function pickModel(list: ListedModel[], family: KeyFamily): { model: string; caps?: Partial<ModelCaps> } | null {
  const usable = list.filter(m => m.id && !/embed|whisper|tts|moderation|rerank/i.test(m.id))
  if (!usable.length) return null
  if (family === 'openrouter') {
    const free = usable.filter(m => /:free$/i.test(m.id!) || m.pricing?.prompt === '0')
    const pool = (free.length ? free : usable).filter(m => (m.supported_parameters ?? ['tools']).includes('tools'))
    const best = [...(pool.length ? pool : free.length ? free : usable)].sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))[0]
    return { model: best.id!, caps: { tools: (best.supported_parameters ?? ['tools']).includes('tools'), vision: !!best.architecture?.input_modalities?.includes('image'), ctx: best.context_length || undefined } as Partial<ModelCaps> }
  }
  const auto = usable.find(m => m.id === 'auto')
  return { model: (auto ?? usable[0]).id! }
}
async function discoverReal(a: { baseUrl: string; key: string; family: KeyFamily }) {
  const r = await fetch(`${a.baseUrl.replace(/\/+$/, '')}/models`, { headers: a.key ? { Authorization: `Bearer ${a.key}` } : {}, signal: AbortSignal.timeout(8000) })
  if (!r.ok) return null
  const j = (await r.json()) as { data?: ListedModel[]; models?: { name?: string }[] }
  return pickModel(j.data ?? (j.models ?? []).map(m => ({ id: m.name })), a.family)
}

const BASE: Record<Exclude<KeyFamily, 'gemini' | 'other'>, { id: string; url: string }> = {
  openrouter: { id: 'openrouter', url: 'https://openrouter.ai/api/v1' },
  ollama: { id: 'ollama', url: 'http://localhost:11434/v1' },
}

export class ModelsService {
  constructor(private d: ModelsDeps) {}
  status() { return buildStatus(this.d) }

  private nextRef(base: string, taken: Set<string>) { if (!taken.has(base)) return base; for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}` }

  async addKey(a: { family: KeyFamily; key: string; baseUrl?: string }): Promise<{ ok: boolean; ref?: string; providerId?: string; error?: string }> {
    const key = String(a.key ?? '').trim()
    let family: KeyFamily = a.family
    const seen = detectFamily(key)
    if (seen && seen !== family && !(family === 'other' && a.baseUrl)) family = seen            // the prefix wins over the row the person pressed
    if (family !== 'ollama' && key.length < 8) return { ok: false, error: 'That does not look like a key.' }
    const list = this.d.cfg().map(c => ({ ...c }))
    const taken = new Set(list.flatMap(c => keysOf(c)).filter(r => this.d.getSecret(r)))
    let c: ProviderConfig | undefined
    let ref = ''
    if (family === 'gemini') {
      const gem = list.filter(p => p.kind === 'gemini')
      if (!gem.length) return { ok: false, error: 'No Google model is set up to use this key.' }
      ref = this.nextRef('gemini', taken)
      for (const p of gem) { const refs = keysOf(p); if (!refs.includes(ref)) p.keyRefs = [...refs, ref] }
      c = gem.find(p => p.roles.includes('main')) ?? gem[0]
    } else if (family === 'openrouter' || family === 'ollama') {
      const b = BASE[family]
      c = list.find(p => p.id === b.id) ?? list.find(p => p.kind === 'openai' && p.baseUrl.replace(/\/+$/, '') === b.url)
      if (!c) { c = { id: b.id, name: family === 'ollama' ? 'Ollama (local)' : 'OpenRouter (free models)', kind: 'openai', baseUrl: b.url, model: '', enabled: true, keyRef: b.id, roles: family === 'ollama' ? ['fast', 'main'] : ['main'], dailyLimit: 0, ...(family === 'ollama' ? { local: true } : {}) }; list.push(c) }
      ref = this.nextRef(c.keyRef || b.id, taken)
      if (family !== 'ollama' || key) c.keyRefs = [...new Set([...(keysOf(c).filter(r => taken.has(r))), ref])]
    } else {
      const url = String(a.baseUrl ?? '').trim().replace(/\/+$/, '')
      if (!/^https?:\/\/[^\s/]+/i.test(url)) return { ok: false, error: 'Type the address of the server (like http://localhost:3001/v1).' }
      c = list.find(p => p.kind === 'openai' && p.baseUrl.replace(/\/+$/, '') === url)
      if (!c) {
        const host = new URL(url).host.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
        const id = this.nextRef(`custom-${host}`, new Set(list.map(p => p.id)))
        c = { id, name: new URL(url).host, kind: 'openai', baseUrl: url, model: '', enabled: true, keyRef: id, roles: ['fast', 'main'], dailyLimit: 0 }
        list.push(c)
      }
      ref = this.nextRef(c.keyRef, taken)
      c.keyRefs = [...new Set([...(keysOf(c).filter(r => taken.has(r))), ref])]
    }
    if (key && !this.d.setSecret(ref, key)) return { ok: false, error: 'Windows could not store the key safely, so it was not saved.' }
    c.enabled = true
    if (family !== 'gemini' && !c.model.trim()) {
      const found = await (this.d.discover ?? discoverReal)({ baseUrl: c.baseUrl, key, family }).catch(() => null)
      if (found) { c.model = found.model; if (found.caps) c.caps = { ...c.caps, ...found.caps } }
    }
    this.d.setProviders(list)
    this.d.gw.forgive(c, ref)
    const t = await this.d.gw.test(c.id, ref)
    if (!t.ok && /rejected|no credit|does not allow/i.test(t.error ?? '')) {      // a key the provider refuses is not kept
      await this.removeKey(ref)
      return { ok: false, error: t.error }
    }
    return { ok: true, ref, providerId: c.id, ...(t.ok ? {} : { error: `Saved, but not confirmed yet: ${t.error ?? 'no answer'}` }) }
  }

  async removeKey(ref: string): Promise<{ ok: boolean; error?: string }> {
    const r = String(ref ?? '')
    const list = this.d.cfg().map(c => ({ ...c }))
    const owners = list.filter(c => keysOf(c).includes(r))
    if (!owners.length) return { ok: false, error: 'No such key.' }
    for (const c of owners) {
      const rest = keysOf(c).filter(x => x !== r)
      c.keyRefs = rest.length ? rest : [c.keyRef]
      if (c.keyRef === r && rest.length) c.keyRef = rest[0]
      if (!rest.length && !this.d.gw.isLocal(c)) c.enabled = false             // nothing left to sign in with
    }
    this.d.clearSecret(r)
    this.d.setProviders(list)
    this.d.gw.emitChange()
    return { ok: true }
  }

  /** a provider id, or one key ref of a provider: one cheap request */
  async test(target: string): Promise<{ ok: boolean; ms: number; reply?: string; error?: string }> {
    const t = String(target ?? '')
    const byId = this.d.cfg().find(c => c.id === t)
    if (byId) return this.d.gw.test(byId.id)
    const owner = this.d.cfg().find(c => keysOf(c).includes(t))
    if (!owner) return { ok: false, ms: 0, error: 'No such key or model.' }
    return this.d.gw.test(owner.id, t)
  }
  async setPreset(p: ModelPreset) { if (p === 'quality' || p === 'fast' || p === 'save') { this.d.setPreset(p); this.d.gw.emitChange() } }
  async setOfflineLocal(on: boolean) { this.d.setOfflineLocal(on === true); this.d.gw.emitChange() }
}

/** pushes at most twice a second */
export function makePusher(send: (s: ModelsStatus) => void, build: () => ModelsStatus, wait = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null, last = 0
  return () => {
    if (timer) return
    timer = setTimeout(() => { timer = null; last = Date.now(); try { send(build()) } catch { /* a failing page must not break the gateway */ } }, Math.max(0, wait - (Date.now() - last)))
    timer.unref?.()
  }
}
