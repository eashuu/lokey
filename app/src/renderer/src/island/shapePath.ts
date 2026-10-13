// Island outline generator. One closed path from five numbers; the same string drives the visible fill and the
// clip-path for the content, so the two can never drift apart. Geometry follows design spec section 1.

export interface ShapeParams {
  depth: number   // distance from the screen's top edge to the bottom of the body
  width: number   // body width
  corner: number  // bottom corner size
  rampW: number   // horizontal reach of the concave fillet at the screen edge
  rampH: number   // height of that fillet
}

const f = (n: number) => n.toFixed(2)

/** Path in overlay pixels; `cx` is the horizontal centre of the overlay. Starts above y=0 so no seam shows. */
export function buildPath({ depth: e, width: t, corner: a, rampW: s, rampH: i }: ShapeParams, cx: number): string {
  const r = cx - t / 2
  const n = cx + t / 2
  const l = Math.max(0.0001, Math.min(a, t / 2))
  const o = e - l
  const c = Math.max(0, Math.min(i, e - 0.5))
  // x of the body edge at the height where the ramp ends
  const edgeAt = (y: number) => {
    if (y <= o) return r
    const k = 1 - Math.sqrt(Math.max(0, (e - y) / l))
    return r + l * k * k
  }
  const d = edgeAt(c)
  const h = 2 * cx - d
  const handle = 0.72 * Math.min(i, c)

  const left: [number, number][] = []
  for (let y = Math.ceil(c); y < o; y += 1) left.push([r, y])
  for (let k = 0; k <= 24; k += 1) {
    const u = k / 24
    const y = e - l * (1 - u) * (1 - u)
    if (y >= c) left.push([r + l * u * u, y])
  }
  const right = [...left].reverse().map(([x, y]) => [2 * cx - x, y] as [number, number])

  const parts: string[] = [
    `M ${f(r - s)} -4`,
    `L ${f(r - s)} 0`,
    `C ${f(r - s + 0.72 * s)} 0 ${f(d)} ${f(c - handle)} ${f(d)} ${f(c)}`,
  ]
  for (const [x, y] of left) parts.push(`L ${f(x)} ${f(y)}`)
  for (const [x, y] of right) parts.push(`L ${f(x)} ${f(y)}`)
  parts.push(`L ${f(h)} ${f(c)}`)
  parts.push(`C ${f(h)} ${f(c - handle)} ${f(n + s - 0.72 * s)} 0 ${f(n + s)} 0`)
  parts.push(`L ${f(n + s)} -4 Z`)
  return parts.join(' ')
}
