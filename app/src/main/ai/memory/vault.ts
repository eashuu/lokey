import { getSecret, setSecret } from '../../agent/keystore'

// Encryption at rest for what Lokey remembers (decision D6, on by default). Memory content (the text of facts and lessons, names, episodes,
// the journal, the core block, embeddings) is stored as AES-256-GCM sealed blobs in lokey.db; only structure (ids, times, trust levels,
// flags) is readable without the key. The 32-byte key is generated on first use and kept by Windows' own protection (DPAPI through
// Electron's safeStorage, via keystore.ts): another Windows user, or a copy of lokey.db on another machine, cannot read the content.
// Limits, stated plainly: any program running as YOU can ask Windows for the key too (that is how DPAPI works); this is protection of the
// file at rest, not against malware in your session. The search index is built in memory (a temporary FTS5 table) so no plaintext
// index is ever written to disk.
type Crypto = typeof import('node:crypto')
const nodeCrypto = (): Crypto | null => {
  try { return ((globalThis as { process?: { getBuiltinModule?: (n: string) => unknown } }).process?.getBuiltinModule?.('node:crypto') as Crypto) ?? null } catch { return null }
}

const PREFIX = 'enc1:'

export class Vault {
  private key: Buffer | null
  /** `key` = 32 bytes. `null` = no encryption available: content is stored as readable text (and reported as such). */
  constructor(key: Buffer | null) { this.key = key && key.length === 32 ? key : null }

  get encrypting() { return !!this.key }

  private static cached: Vault | null = null
  /** the vault for the current setting: sealed with the Windows-protected key, or readable when the person turned encryption off */
  static current(encrypt: boolean): Vault { return encrypt ? (Vault.cached ??= Vault.fromKeystore()) : new Vault(null) }

  /** the key kept by Windows for this user, created on first use (null when safeStorage or node:crypto is unavailable) */
  static fromKeystore(): Vault {
    const c = nodeCrypto()
    if (!c) return new Vault(null)
    try {
      let b64 = getSecret('memory-key')
      if (!b64) { b64 = c.randomBytes(32).toString('base64'); if (!setSecret('memory-key', b64)) return new Vault(null) }
      return new Vault(Buffer.from(b64, 'base64'))
    } catch { return new Vault(null) }
  }

  seal(plain: string): string {
    const c = nodeCrypto()
    if (!this.key || !c) return plain
    const iv = c.randomBytes(12)
    const ci = c.createCipheriv('aes-256-gcm', this.key, iv)
    const ct = Buffer.concat([ci.update(plain, 'utf8'), ci.final()])
    return PREFIX + Buffer.concat([iv, ci.getAuthTag(), ct]).toString('base64')
  }

  /** content sealed with this key, or readable text written while encryption was off. Throws when the key does not fit. */
  open(stored: string): string {
    if (!stored.startsWith(PREFIX)) return stored
    const c = nodeCrypto()
    if (!this.key || !c) throw new Error('this memory is encrypted and the key is not available')
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64')
    const d = c.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
  }
}

export const isSealed = (s: string) => s.startsWith(PREFIX)
