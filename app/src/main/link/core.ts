import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Pure, Electron-free pieces of Lokey Link: private-LAN check, one-time pairing code, hashed device tokens, rate limit.
export type Scope = 'agent' | 'view' | 'notify' // deliberately no 'control': no mouse/keyboard remote control in this version
export const ALL_SCOPES: Scope[] = ['agent', 'view', 'notify']

/** True only for loopback, RFC1918, link-local and IPv6 unique-local/link-local addresses. */
export function isPrivateAddr(raw: string | undefined): boolean {
  if (!raw) return false
  let a = raw.toLowerCase().replace(/^::ffff:/, '')
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a)
  if (m) {
    const [x, y] = [Number(m[1]), Number(m[2])]
    if ([m[1], m[2], m[3], m[4]].some(p => Number(p) > 255)) return false
    return x === 10 || x === 127 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 169 && y === 254)
  }
  a = a.split('%')[0]
  return a === '::1' || /^f[cd][0-9a-f]{2}:/.test(a) || /^fe[89ab][0-9a-f]:/.test(a)
}

const sha = (s: string) => createHash('sha256').update(s).digest()
const eq = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b)

export class Pairing {
  private code = ''
  private expires = 0
  private left = 0
  constructor(private ttlMs = 120_000, private maxAttempts = 5) {}
  issue(now = Date.now()): { code: string; expiresAt: number } {
    this.code = String(randomInt(0, 1_000_000)).padStart(6, '0'); this.expires = now + this.ttlMs; this.left = this.maxAttempts
    return { code: this.code, expiresAt: this.expires }
  }
  /** One-time: a correct code is consumed; five wrong guesses or two minutes kill it. */
  attempt(code: string, now = Date.now()): boolean {
    if (!this.code || now > this.expires || this.left <= 0) { this.code = ''; return false }
    this.left--
    const ok = eq(sha(String(code)), sha(this.code))
    if (ok || this.left <= 0) this.code = ''
    return ok
  }
  get active() { return !!this.code }
}

export interface Device { id: string; name: string; hash: string; scopes: Scope[]; created: number; lastSeen: number }
export type DevicePublic = Omit<Device, 'hash'>

export class Devices {
  private list: Device[] = []
  constructor(private file: string | null = null) {
    if (file) try { this.list = JSON.parse(readFileSync(file, 'utf8')) } catch { /* first run */ }
  }
  private save() { if (this.file) try { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file, JSON.stringify(this.list, null, 2)) } catch { /* in-memory only */ } }
  /** The token is returned once and only its SHA-256 is kept. */
  add(name: string, scopes: Scope[] = ALL_SCOPES): { id: string; token: string } {
    const token = randomBytes(32).toString('base64url')
    const id = randomUUID().slice(0, 8)
    this.list.push({ id, name: String(name || 'Phone').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'Phone', hash: sha(token).toString('hex'), scopes, created: Date.now(), lastSeen: 0 })
    this.save()
    return { id, token }
  }
  verify(token: string): Device | null {
    const h = sha(String(token))
    let found: Device | null = null
    for (const d of this.list) if (eq(h, Buffer.from(d.hash, 'hex'))) found = d // no early exit
    return found
  }
  touch(id: string) { const d = this.list.find(x => x.id === id); if (d && Date.now() - d.lastSeen > 30_000) { d.lastSeen = Date.now(); this.save() } }
  revoke(id: string): boolean { const n = this.list.length; this.list = this.list.filter(d => d.id !== id); this.save(); return this.list.length < n }
  all(): DevicePublic[] { return this.list.map(({ hash: _h, ...d }) => d) }
}

/** Per-address failure counter with exponential backoff (2^n seconds after 5 failures, capped at 15 min). */
export class Limiter {
  private m = new Map<string, { n: number; until: number }>()
  blocked(ip: string, now = Date.now()) { return (this.m.get(ip)?.until ?? 0) > now }
  fail(ip: string, now = Date.now()) {
    const e = this.m.get(ip) ?? { n: 0, until: 0 }
    e.n++
    if (e.n >= 5) e.until = now + Math.min(2 ** (e.n - 4), 900) * 1000
    this.m.set(ip, e)
  }
  ok(ip: string) { this.m.delete(ip) }
}
