import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../settings'

// The Google AI Studio key, encrypted with Windows DPAPI (safeStorage) so it is unreadable to other users and apps
// that cannot decrypt for this user. It is only ever read in the main process and sent to Google.
const file = join(dataDir, 'voice.key')
let cached: string | null | undefined

export function hasKey() { return getKey() !== null }

export function getKey(): string | null {
  if (cached !== undefined) return cached
  try {
    cached = existsSync(file) && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(readFileSync(file)) : null
  } catch { cached = null }
  return cached
}

export function setKey(key: string): boolean {
  const k = key.trim()
  if (!/^[\w-]{20,}$/.test(k) || !safeStorage.isEncryptionAvailable()) return false
  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(file, safeStorage.encryptString(k))
    cached = k
    return true
  } catch { return false }
}

export function clearKey() {
  cached = null
  try { rmSync(file, { force: true }) } catch { /* nothing to remove */ }
}
