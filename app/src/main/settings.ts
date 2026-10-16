import { EventEmitter } from 'node:events'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultSettings, type DeepPartial, type Settings } from '@shared/bridge'
import { grandfather } from './ai/catalog'

export const dataDir = join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? '.', 'Lokey')
const file = join(dataDir, 'settings.json')
const backupFile = join(dataDir, 'settings.pre-0.9.0.json')

/** Deep-merge a patch; a value whose type differs from its default's (or null) is dropped, so a bad file or call can't poison settings. */
export function merge<T>(base: T, patch: unknown): T {
  if (patch === undefined || patch === null) return base
  if (base === null) return patch as T // a nullable default (x: number | null) takes any value
  if (base === null || typeof base !== 'object' || Array.isArray(base)) {
    if (Array.isArray(base)) return (Array.isArray(patch) ? patch : base) as T
    return (typeof patch === typeof base ? patch : base) as T
  }
  if (typeof patch !== 'object' || Array.isArray(patch)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in out)) continue // unknown keys are dropped, so old files never poison new builds
    out[k] = merge(out[k], v)
  }
  return out as T
}

export function settingsSelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('settings: ' + m) }
  const d = { a: 1, s: 'x', b: true, o: { n: 2 }, l: ['t'], z: null as string | null }
  need(merge(d, { a: 'no' }).a === 1 && merge(d, { s: null }).s === 'x' && merge(d, { o: 5 }).o.n === 2, 'wrong types dropped')
  need(merge(d, { a: 7, o: { n: 3 }, extra: 1 }).a === 7 && merge(d, { o: { n: 3 } }).o.n === 3 && !('extra' in merge(d, { extra: 1 })), 'good values kept')
  need(merge(d, { z: 'v' }).z === 'v' && merge(d, null) === d && merge(d, { l: 'x' }).l[0] === 't', 'null and array mismatch rejected')
  return 'settings ok'
}

class SettingsStore extends EventEmitter {
  value: Settings = structuredClone(defaultSettings)

  load() {
    try { this.value = merge(structuredClone(defaultSettings), JSON.parse(readFileSync(file, 'utf8'))) } catch { this.value = structuredClone(defaultSettings) }
    // one-time upgrade: the new default spirit (puffball) and "follow Windows" theme replace values saved by older builds
    if ((this.value.migrated ?? 0) < 1) {
      this.value.loadout.soul = 'puff'
      this.value.appearance.theme = 'auto'
      this.value.migrated = 1
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, JSON.stringify(this.value, null, 2)) } catch { /* in-memory only */ }
    }
    // v2: the circle-to-ask chord moves off bare Ctrl+Shift (it is also Windows' keyboard-layout switch and fires on every shortcut)
    if ((this.value.migrated ?? 0) < 2) {
      if (this.value.voice.lassoKey === 'Ctrl+Shift') this.value.voice.lassoKey = 'Ctrl+Alt+L'
      this.value.migrated = 2
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, JSON.stringify(this.value, null, 2)) } catch { /* in-memory only */ }
    }
    // v3 (0.6.0): every model call goes through the gateway by role. Older saved provider lists get the new roles and an embeddings entry.
    if ((this.value.migrated ?? 0) < 3) {
      const def = defaultSettings.brain.providers
      const list = this.value.brain.providers
      const flash = list.find(p => p.id === 'gemini-flash')
      if (flash) for (const r of def.find(p => p.id === 'gemini-flash')!.roles) if (!flash.roles.includes(r)) flash.roles.push(r)
      if (!list.some(p => p.id === 'gemini-embed')) list.splice(Math.min(2, list.length), 0, structuredClone(def.find(p => p.id === 'gemini-embed')!))
      this.value.migrated = 3
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, JSON.stringify(this.value, null, 2)) } catch { /* in-memory only */ }
    }
    // v4 (0.7.x): the local Ollama entry for offline mode
    if ((this.value.migrated ?? 0) < 4) {
      const list = this.value.brain.providers
      if (!list.some(p => p.id === 'ollama')) list.push(structuredClone(defaultSettings.brain.providers.find(p => p.id === 'ollama')!))
      this.value.migrated = 4
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, JSON.stringify(this.value, null, 2)) } catch { /* in-memory only */ }
    }
    // v5 (0.8.x): a slot for a local screen-grounding model
    if ((this.value.migrated ?? 0) < 5) {
      const list = this.value.brain.providers
      if (!list.some(p => p.id === 'ollama-ground')) list.push(structuredClone(defaultSettings.brain.providers.find(p => p.id === 'ollama-ground')!))
      this.value.migrated = 5
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, JSON.stringify(this.value, null, 2)) } catch { /* in-memory only */ }
    }
    // v6 (0.8.x): the admission gate. Everything already set up counts as admitted, so nothing stops working; models added from now on are tested first.
    if ((this.value.migrated ?? 0) < 6) {
      this.value.brain.admitted = grandfather(this.value.brain.providers, this.value.brain.admitted)
      this.value.migrated = 6
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, JSON.stringify(this.value, null, 2)) } catch { /* in-memory only */ }
    }
    // v7 (0.8.5): the Flow tab joins the island's tab bar
    if ((this.value.migrated ?? 0) < 7) {
      if (!this.value.island.tabs.includes('agents')) this.value.island.tabs.push('agents')
      this.value.migrated = 7
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, JSON.stringify(this.value, null, 2)) } catch { /* in-memory only */ }
    }
    // v8 (0.9.0, docs/AI-FAILSAFE.md): a provider can hold several keys (keyRefs, the first is keyRef), the voice can name alternate Live models (voice.models) and the
    // chain has a preset (brain.preset). The three come from the defaults when missing; keyRefs is filled from keyRef. The file as it was is kept once as
    // settings.pre-0.9.0.json: to go back to 0.8.x close Lokey and copy that file over settings.json (0.8.x ignores the new fields and still reads keyRef).
    if ((this.value.migrated ?? 0) < 8) {
      try { if (existsSync(file) && !existsSync(backupFile)) copyFileSync(file, backupFile) } catch { /* no backup: the migration is still additive */ }
      for (const p of this.value.brain.providers) if (!p.keyRefs?.length) p.keyRefs = [p.keyRef]
      this.value.migrated = 8
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, JSON.stringify(this.value, null, 2)) } catch { /* in-memory only */ }
    }
    return this.value
  }

  set(patch: DeepPartial<Settings>) {
    this.value = merge(this.value, patch)
    try {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(file + '.tmp', JSON.stringify(this.value, null, 2))
      renameSync(file + '.tmp', file)
    } catch { /* keep running with in-memory settings */ }
    this.emit('changed', this.value)
    return this.value
  }
}

export const settings = new SettingsStore()
