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

// ---- other providers' keys (FreeLLMAPI, OpenRouter, Groq...), same protection, one file per name ----------------------------------
const secrets = new Map<string, string | null>()
const safeName = (ref: string) => ref.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)

export function getSecret(ref: string): string | null {
  if (ref === 'gemini') return getKey()
  const n = safeName(ref)
  if (!n) return null
  if (secrets.has(n)) return secrets.get(n) ?? null
  let v: string | null = null
  try { const f = join(dataDir, `secret-${n}.key`); v = existsSync(f) && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(readFileSync(f)) : null } catch { v = null }
  secrets.set(n, v)
  return v
}

export function hasSecret(ref: string) { return getSecret(ref) !== null }

export function setSecret(ref: string, value: string): boolean {
  if (ref === 'gemini') return setKey(value)
  const n = safeName(ref), v = value.trim()
  if (!n || v.length < 4 || !safeStorage.isEncryptionAvailable()) return false
  try { mkdirSync(dataDir, { recursive: true }); writeFileSync(join(dataDir, `secret-${n}.key`), safeStorage.encryptString(v)); secrets.set(n, v); return true } catch { return false }
}

export function clearSecret(ref: string) {
  if (ref === 'gemini') { clearKey(); return }
  const n = safeName(ref)
  secrets.set(n, null)
  try { rmSync(join(dataDir, `secret-${n}.key`), { force: true }) } catch { /* nothing to remove */ }
}
