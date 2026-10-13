import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultSettings, type DeepPartial, type Settings } from '@shared/bridge'

export const dataDir = join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? '.', 'Lokey')
const file = join(dataDir, 'settings.json')

function merge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return (patch === undefined ? base : patch) as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in out)) continue // unknown keys are dropped, so old files never poison new builds
    out[k] = merge(out[k], v)
  }
  return out as T
}

class SettingsStore extends EventEmitter {
  value: Settings = defaultSettings

  load() {
    try { this.value = merge(defaultSettings, JSON.parse(readFileSync(file, 'utf8'))) } catch { this.value = structuredClone(defaultSettings) }
    // one-time upgrade: the new default spirit (puffball) and "follow Windows" theme replace values saved by older builds
    if ((this.value.migrated ?? 0) < 1) {
      this.value.loadout.soul = 'puff'
      this.value.appearance.theme = 'auto'
      this.value.migrated = 1
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
