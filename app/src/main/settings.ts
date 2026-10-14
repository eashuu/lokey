import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultSettings, type DeepPartial, type Settings } from '@shared/bridge'

export const dataDir = join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? '.', 'Lokey')
const file = join(dataDir, 'settings.json')

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
