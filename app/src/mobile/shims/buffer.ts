// Minimal Node Buffer for the WebView: a Uint8Array with the handful of methods the core uses (from/alloc/concat/byteLength, toString for
// utf8/base64/base64url/hex/ascii, little-endian reads/writes). Installed on globalThis by globals.ts.
const te = new TextEncoder()
const td = new TextDecoder()
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function b64encode(u: Uint8Array, url = false): string {
  let s = ''
  for (let i = 0; i < u.length; i += 3) {
    const n = (u[i] << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0)
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u.length ? B64[n & 63] : '=')
  }
  return url ? s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : s
}
function b64decode(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let o = 0
  for (let i = 0; i < s.length; i += 4) {
    const a = B64.indexOf(s[i]), b = B64.indexOf(s[i + 1]), c = i + 2 < s.length ? B64.indexOf(s[i + 2]) : -1, d = i + 3 < s.length ? B64.indexOf(s[i + 3]) : -1
    out[o++] = (a << 2) | (b >> 4)
    if (c >= 0) out[o++] = ((b & 15) << 4) | (c >> 2)
    if (d >= 0) out[o++] = ((c & 3) << 6) | d
  }
  return out.subarray(0, o)
}
const hex = (u: Uint8Array) => Array.from(u, x => x.toString(16).padStart(2, '0')).join('')
const unhex = (s: string) => { const o = new Uint8Array(s.length >> 1); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16); return o }

type Enc = string | undefined
export class Buffer extends Uint8Array {
  static from(v: any, encOrOffset?: any, length?: number): Buffer {
    let u: Uint8Array
    if (typeof v === 'string') {
      const e = (encOrOffset as Enc) ?? 'utf8'
      u = e === 'base64' || e === 'base64url' ? b64decode(v) : e === 'hex' ? unhex(v) : e === 'latin1' || e === 'binary' || e === 'ascii' ? Uint8Array.from(v, c => c.charCodeAt(0) & 255) : te.encode(v)
    } else if (v instanceof ArrayBuffer) u = new Uint8Array(v, typeof encOrOffset === 'number' ? encOrOffset : 0, length)
    else if (ArrayBuffer.isView(v)) u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
    else u = Uint8Array.from(v as ArrayLike<number>)
    return new Buffer(u.buffer as ArrayBuffer, u.byteOffset, u.byteLength)
  }
  static alloc(n: number, fill = 0): Buffer { const b = new Buffer(n); if (fill) b.fill(fill); return b }
  static allocUnsafe(n: number) { return new Buffer(n) }
  static isBuffer(x: unknown): x is Buffer { return x instanceof Buffer }
  static byteLength(s: string | ArrayBufferView | ArrayBuffer): number { return typeof s === 'string' ? te.encode(s).length : s.byteLength }
  static concat(list: Uint8Array[], total?: number): Buffer {
    const n = total ?? list.reduce((a, b) => a + b.length, 0)
    const out = new Buffer(n)
    let o = 0
    for (const b of list) { if (o >= n) break; out.set(b.subarray(0, n - o), o); o += b.length }
    return out
  }
  toString(enc: Enc = 'utf8', start = 0, end = this.length): string {
    const u = start === 0 && end === this.length ? this : this.subarray(start, end)
    if (enc === 'base64') return b64encode(u)
    if (enc === 'base64url') return b64encode(u, true)
    if (enc === 'hex') return hex(u)
    if (enc === 'latin1' || enc === 'binary' || enc === 'ascii') return Array.from(u, c => String.fromCharCode(c)).join('')
    return td.decode(u)
  }
  toJSON() { return { type: 'Buffer', data: Array.from(this) } }
  equals(o: Uint8Array) { return this.length === o.length && this.every((x, i) => x === o[i]) }
  slice(s?: number, e?: number): Buffer { return this.subarray(s, e) as Buffer }
  subarray(s?: number, e?: number): Buffer { const u = super.subarray(s, e); return new Buffer(u.buffer as ArrayBuffer, u.byteOffset, u.byteLength) }
  write(str: string, offset = 0, enc: Enc = 'utf8'): number { const b = Buffer.from(str, enc); this.set(b.subarray(0, this.length - offset), offset); return b.length }
  private dv() { return new DataView(this.buffer, this.byteOffset, this.byteLength) }
  readUInt32LE(o = 0) { return this.dv().getUint32(o, true) }
  readUInt16LE(o = 0) { return this.dv().getUint16(o, true) }
  readInt16LE(o = 0) { return this.dv().getInt16(o, true) }
  writeUInt32LE(v: number, o = 0) { this.dv().setUint32(o, v, true); return o + 4 }
  writeUInt16LE(v: number, o = 0) { this.dv().setUint16(o, v, true); return o + 2 }
  writeInt16LE(v: number, o = 0) { this.dv().setInt16(o, v, true); return o + 2 }
}
