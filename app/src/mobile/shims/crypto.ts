// Node's crypto, the sync parts the core uses: createHash (sha256, sha1), randomBytes/randomInt/randomUUID, timingSafeEqual.
import { Buffer } from './buffer'

const te = new TextEncoder()
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n))
const K256 = Uint32Array.from('428a2f98 71374491 b5c0fbcf e9b5dba5 3956c25b 59f111f1 923f82a4 ab1c5ed5 d807aa98 12835b01 243185be 550c7dc3 72be5d74 80deb1fe 9bdc06a7 c19bf174 e49b69c1 efbe4786 0fc19dc6 240ca1cc 2de92c6f 4a7484aa 5cb0a9dc 76f988da 983e5152 a831c66d b00327c8 bf597fc7 c6e00bf3 d5a79147 06ca6351 14292967 27b70a85 2e1b2138 4d2c6dfc 53380d13 650a7354 766a0abb 81c2c92e 92722c85 a2bfe8a1 a81a664b c24b8b70 c76c51a3 d192e819 d6990624 f40e3585 106aa070 19a4c116 1e376c08 2748774c 34b0bcb5 391c0cb3 4ed8aa4a 5b9cca4f 682e6ff3 748f82ee 78a5636f 84c87814 8cc70208 90befffa a4506ceb bef9a3f7 c67178f2'.split(' '), h => parseInt(h, 16))

/** pad per MD-style length encoding (big-endian bit length) */
function pad(data: Uint8Array): Uint8Array {
  const n = data.length, total = (((n + 9 + 63) >> 6) << 6)
  const out = new Uint8Array(total)
  out.set(data); out[n] = 0x80
  const dv = new DataView(out.buffer)
  dv.setUint32(total - 8, Math.floor((n * 8) / 2 ** 32)); dv.setUint32(total - 4, (n * 8) >>> 0)
  return out
}

function sha256(data: Uint8Array): Uint8Array {
  const h = Uint32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19)
  const p = pad(data), dv = new DataView(p.buffer), w = new Uint32Array(64)
  for (let o = 0; o < p.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4)
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0 }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh
  }
  const out = new Uint8Array(32), odv = new DataView(out.buffer)
  h.forEach((x, i) => odv.setUint32(i * 4, x))
  return out
}

function sha1(data: Uint8Array): Uint8Array {
  const h = Uint32Array.of(0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0)
  const p = pad(data), dv = new DataView(p.buffer), w = new Uint32Array(80)
  for (let o = 0; o < p.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4)
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let [a, b, c, d, e] = h
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6]
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0
      e = d; d = c; c = rotl(b, 30); b = a; a = t
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e
  }
  const out = new Uint8Array(20), odv = new DataView(out.buffer)
  h.forEach((x, i) => odv.setUint32(i * 4, x))
  return out
}

class Hash {
  private chunks: Uint8Array[] = []
  constructor(private algo: string) { if (!/^(sha256|sha1)$/i.test(algo)) throw new Error(`hash ${algo} is not available on Android`) }
  update(d: string | Uint8Array): this { this.chunks.push(typeof d === 'string' ? te.encode(d) : d); return this }
  digest(): Buffer
  digest(enc: 'hex' | 'base64' | 'base64url' | 'latin1'): string
  digest(enc?: 'hex' | 'base64' | 'base64url' | 'latin1'): Buffer | string {
    const all = Buffer.concat(this.chunks)
    const b = Buffer.from(/^sha1$/i.test(this.algo) ? sha1(all) : sha256(all))
    return enc ? b.toString(enc) : b
  }
}
export const createHash = (algo: string) => new Hash(algo)

export const randomBytes = (n: number): Buffer => { const b = Buffer.alloc(n); crypto.getRandomValues(b); return b }
export const randomInt = (a: number, b?: number): number => {
  const [lo, hi] = b === undefined ? [0, a] : [a, b]
  const span = hi - lo, lim = Math.floor(2 ** 32 / span) * span
  const u = new Uint32Array(1)
  do crypto.getRandomValues(u); while (u[0] >= lim)
  return lo + (u[0] % span)
}
export const randomUUID = () => crypto.randomUUID()
export const timingSafeEqual = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length')
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}
export const webcrypto = crypto
export default { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual, webcrypto }
