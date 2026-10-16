import type { KeyFamily, ModelPreset, ModelsApi, ModelsStatus } from '@shared/bridge'

// A stateful stand-in for the `models` bridge (Settings > Models in the browser / bench / `?mock`): the same shapes the main process pushes,
// with one healthy Gemini key, a second one resting, a rejected OpenRouter key and the voice on its first rung. The commands change this
// state and push it to subscribers, so the page can be built and screenshotted without the app.
const family = (key: string, f: KeyFamily): KeyFamily => (/^AIza/.test(key) ? 'gemini' : /^sk-or-/.test(key) ? 'openrouter' : f)

export function createModelsMock(): ModelsApi {
  const now = Date.now()
  let s: ModelsStatus = {
    mode: 'online',
    using: { providerId: 'gemini-flash', model: 'gemini-flash-latest', label: 'Gemini Flash' },
    backups: 2,
    requestsToday: 38,
    voice: { rung: 'live', model: 'gemini-3.8-live' },
    preset: 'quality',
    offlineLocal: true,
    providers: [
      { id: 'gemini-flash', family: 'gemini', label: 'Google Gemini', enabled: true, model: 'gemini-flash-latest', caps: ['tools', 'vision', 'audio', 'search'], state: 'ok', usedToday: 31,
        keys: [{ ref: 'gemini', hint: '7Qx2', state: 'ok' }, { ref: 'gemini#2', hint: 'a91c', state: 'resting', until: now + 14 * 60_000, note: 'rate limited' }] },
      { id: 'gemini-lite', family: 'gemini', label: 'Gemini Flash-Lite', enabled: true, model: 'gemini-flash-lite-latest', caps: ['tools', 'vision', 'audio', 'search'], state: 'ok', usedToday: 7, keys: [{ ref: 'gemini', hint: '7Qx2', state: 'ok' }] },
      { id: 'openrouter', family: 'openrouter', label: 'OpenRouter', enabled: true, model: 'meta-llama/llama-3.3-70b-instruct:free', caps: ['tools'], state: 'rejected', usedToday: 0, note: 'key rejected', keys: [{ ref: 'openrouter', hint: 'f3d0', state: 'rejected', note: 'key rejected' }] },
      { id: 'ollama', family: 'ollama', label: 'Ollama (local)', enabled: false, model: '', caps: [], state: 'off', usedToday: 0, keys: [] },
    ],
  }
  const cbs = new Set<(x: ModelsStatus) => void>()
  const push = () => { s = { ...s }; cbs.forEach(cb => cb(s)) }
  const refsOf = (f: KeyFamily) => s.providers.filter(p => p.family === f).flatMap(p => p.keys.map(k => k.ref))
  return {
    status: async () => s,
    onStatus: cb => { cbs.add(cb); return () => { cbs.delete(cb) } },
    async addKey({ family: f, key, baseUrl }) {
      const fam = family(key.trim(), f)
      if (key.trim().length < 8) return { ok: false, error: 'That does not look like a key.' }
      if (fam === 'other' && !baseUrl) return { ok: false, error: 'Paste the address of the service too (it ends in /v1).' }
      const ref = `${fam}#${refsOf(fam).length + 1}`
      s.providers = s.providers.map(p => (p.family === fam ? { ...p, enabled: true, state: 'ok' as const, keys: [...p.keys, { ref, hint: key.trim().slice(-4), state: 'ok' as const }] } : p))
      s.backups = s.providers.filter(p => p.enabled && p.state === 'ok').length - 1
      push()
      return { ok: true, ref, providerId: s.providers.find(p => p.family === fam)?.id }
    },
    async removeKey(ref) {
      s.providers = s.providers.map(p => ({ ...p, keys: p.keys.filter(k => k.ref !== ref) }))
      push()
      return { ok: true }
    },
    async test(target) {
      const hit = s.providers.find(p => p.id === target || p.keys.some(k => k.ref === target))
      if (!hit) return { ok: false, ms: 0, error: 'Nothing by that name.' }
      if (hit.state === 'rejected') return { ok: false, ms: 140, error: 'The OpenRouter key was rejected.' }
      return { ok: true, ms: 420, reply: 'ok' }
    },
    async setPreset(p: ModelPreset) { s.preset = p; push() },
    async setOfflineLocal(on: boolean) { s.offlineLocal = on; push() },
  }
}
