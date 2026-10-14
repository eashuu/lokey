// Same exports as main/agent/keystore.ts (it replaces that file in the mobile build). Secrets live in the Android Keystore, reached through the
// native plugin (`secret.get / secret.set / secret.clear`, params { name, value }; get answers { value }). Callers read them
// synchronously, so everything is loaded into a cache once at boot (`loadSecrets`). Without the plugin (browser testing) they are kept in
// localStorage, XOR-obfuscated with a per-install random key: NOT secure storage, only keeps a key from sitting there in plain text.
import { nativeCall, NativeUnavailable, hasNative } from '../native'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../../main/settings'

const cache = new Map<string, string | null>()
const idxFile = join(dataDir, 'secrets.idx')
const safeName = (ref: string) => ref.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40)

// ---- localStorage fallback ----------------------------------------------------------------------------------------------------------------
const ls = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }, del: (k: string) => { try { localStorage.removeItem(k) } catch { /* nothing */ } } }
const obKey = () => { let k = ls.get('lokey.sec.k'); if (!k) { k = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''); ls.set('lokey.sec.k', k) } return k }
const xor = (s: Uint8Array) => { const k = obKey(); return s.map((b, i) => b ^ k.charCodeAt(i % k.length)) }
export const obfuscate = (v: string) => btoa(String.fromCharCode(...xor(new TextEncoder().encode(v))))
export const deobfuscate = (v: string) => new TextDecoder().decode(xor(Uint8Array.from(atob(v), c => c.charCodeAt(0))))

const names = (): string[] => { try { return JSON.parse(readFileSync(idxFile, 'utf8')) as string[] } catch { return [] } }
const remember = (n: string) => { const l = names(); if (!l.includes(n)) { mkdirSync(dataDir, { recursive: true }); writeFileSync(idxFile, JSON.stringify([...l, n])) } }

/** loads every stored secret into the cache; call (and await) before the core is used */
export async function loadSecrets(extra: string[] = []): Promise<void> {
  const refs = [...new Set(['gemini', ...names(), ...extra.map(safeName)].filter(Boolean))]
  await Promise.all(refs.map(async ref => {
    let v: string | null = null
    try {
      const r = await nativeCall<{ value?: string | null; ok?: boolean } | string | null>('secret.get', { name: ref })
      v = typeof r === 'string' ? r : r?.value ?? null
    } catch (e) {
      if (!(e instanceof NativeUnavailable)) return
      const o = ls.get(`lokey.sec.${ref}`)
      try { v = o ? deobfuscate(o) : null } catch { v = null }
    }
    cache.set(ref, v || null)
  }))
}

function store(ref: string, v: string) {
  cache.set(ref, v)
  remember(ref)
  if (hasNative()) void nativeCall<{ ok?: boolean }>('secret.set', { name: ref, value: v }).then(r => { if (r?.ok === false) ls.set(`lokey.sec.${ref}`, obfuscate(v)) }, () => ls.set(`lokey.sec.${ref}`, obfuscate(v)))
  else ls.set(`lokey.sec.${ref}`, obfuscate(v))
}

export function getSecret(ref: string): string | null { return cache.get(safeName(ref)) ?? null }
export const hasSecret = (ref: string) => getSecret(ref) !== null
export const hasKey = () => getKey() !== null
export const getKey = () => getSecret('gemini')
export function setKey(key: string): boolean { const k = key.trim(); if (!/^[\w-]{20,}$/.test(k)) return false; store('gemini', k); return true }
export function clearKey() { clearSecret('gemini') }
export function setSecret(ref: string, value: string): boolean {
  if (ref === 'gemini') return setKey(value)
  const n = safeName(ref), v = value.trim()
  if (!n || v.length < 4) return false
  store(n, v)
  return true
}
export function clearSecret(ref: string) {
  const n = safeName(ref)
  cache.set(n, null)
  ls.del(`lokey.sec.${n}`)
  if (hasNative()) void nativeCall('secret.clear', { name: n }).catch(() => undefined)
}
