// Draws the spirit-drop icon (original artwork) to PNG with no dependencies.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

function crc32(buf) {
  let c, crc = ~0
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c }
  return ~crc >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) { const [r, g, b, a] = pixel(x / size, y / size, size); const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
// signed distance to a "drop": circle at bottom + tapered point at top
function sdDrop(x, y) {
  const cx = 0.5, cy = 0.64, r = 0.3
  const dCircle = Math.hypot(x - cx, y - cy) - r
  // triangle-ish tip approximated by a capsule from circle top to the tip
  const tipY = 0.05
  const t = Math.min(1, Math.max(0, (y - tipY) / (cy - tipY)))
  const half = r * Math.pow(t, 1.45)
  const dTip = Math.abs(x - cx) - half
  const dY = Math.max(tipY - y, y - cy)
  const dCone = Math.max(dTip, dY)
  return Math.min(dCircle, dCone)
}
const mix = (a, b, t) => a + (b - a) * t
function pixel(u, v, size) {
  const aa = 1.5 / size
  const d = sdDrop(u, v)
  const cover = Math.min(1, Math.max(0, 0.5 - d / aa))
  if (cover <= 0) return [0, 0, 0, 0]
  const t = Math.min(1, Math.max(0, (v - 0.1) / 0.8))
  let r = mix(233, 47, t), g = mix(248, 120, t), b = mix(255, 232, t)
  // eyes
  for (const ex of [0.385, 0.615]) {
    const e = Math.hypot((u - ex) / 0.05, (v - 0.64) / 0.07)
    if (e < 1) { r = 13; g = 42; b = 85 }
  }
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(cover * 255)]
}
writeFileSync('resources/icon.png', png(256, pixel))
writeFileSync('resources/tray.png', png(32, pixel))
console.log('icons written')
