import type { LyricLine } from './lyrics'

// The pure parts of the lyrics window's animation: turning lyric lines into a timeline of timed words and instrumental gaps,
// keyframe curves, and a damped spring. The look follows the "karaoke" style popularised by Spotify mods: each word is lit by a
// soft gradient sweep while it is sung, swells and floats a little, glows, and upcoming/past lines blur and fade with distance.
// Everything here is original code; only the idea (and a few tuning numbers, which are facts about a look) is shared.

export interface TWord { t0: number; t1: number; text: string }
export interface TLine { kind: 'line'; t0: number; t1: number; text: string; words: TWord[] }
export interface TGap { kind: 'gap'; t0: number; t1: number }
export type TItem = TLine | TGap

const GAP_MIN_MS = 4500          // silence longer than this between two lines shows the three dots
const SING_MS_PER_CHAR = 95
const LAST_LINE_MS = 5000

/**
 * Word start times for a line that has no word timing: spread over [t, end] by length, with a longer beat after a comma, full stop or
 * question mark (singers breathe there). Real word tags from the lyrics source (enhanced LRC) are used as they are.
 */
export function spreadWords(line: LyricLine, end: number): { t: number; w: string }[] {
  if (line.words?.length) return line.words
  const words = line.text.split(' ').filter(Boolean)
  if (!words.length) return []
  const weights = words.map(w => Array.from(w.replace(/[^\p{L}\p{N}]/gu, '')).length + 1 + (/[,;:]$/.test(w) ? 1.5 : /[.!?…]$/.test(w) ? 2.5 : 0))
  const total = weights.reduce((a, b) => a + b, 0)
  const span = Math.max(300, end - line.t)
  let acc = 0
  return words.map((w, i) => { const t = line.t + (acc / total) * span; acc += weights[i]; return { t, w } })
}

/** lines -> words with start/end times, plus "gap" items (three dots) for instrumental breaks and the intro */
export function buildTimeline(lines: LyricLine[], durationMs: number): TItem[] {
  const out: TItem[] = []
  const sorted = [...lines].sort((a, b) => a.t - b.t)
  const firstReal = sorted.find(l => l.text.trim())
  if (firstReal && firstReal.t > 5000) out.push({ kind: 'gap', t0: 500, t1: firstReal.t - 350 })
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i]
    const next = sorted[i + 1]?.t ?? (durationMs > l.t + 1000 ? durationMs : l.t + LAST_LINE_MS)
    if (!l.text.trim()) {
      if (next - l.t >= 2500) out.push({ kind: 'gap', t0: l.t, t1: next - 300 }) // an explicit instrumental marker
      continue
    }
    const est = Math.max(1400, Math.min(9000, Array.from(l.text).length * SING_MS_PER_CHAR))
    const end = Math.max(l.t + 400, Math.min(next - 150, l.t + est))
    const ws = spreadWords(l, end)
    const words: TWord[] = ws.map((w, k) => ({ t0: w.t, t1: Math.max(w.t + 120, Math.min(ws[k + 1]?.t ?? end, end)), text: w.w }))
    const t1 = Math.max(end, words[words.length - 1]?.t1 ?? end)
    out.push({ kind: 'line', t0: l.t, t1, text: l.text, words })
    const nextLine = sorted[i + 1]
    if (nextLine?.text.trim() && nextLine.t - t1 > GAP_MIN_MS) out.push({ kind: 'gap', t0: t1 + 600, t1: nextLine.t - 350 })
  }
  return out.sort((a, b) => a.t0 - b.t0)
}

/** index of the item being sung (or the one about to be: the last whose start has passed); -1 before the first */
export function activeItem(items: TItem[], tMs: number): number {
  let lo = 0, hi = items.length - 1, ans = -1
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (items[mid].t0 <= tMs) { ans = mid; lo = mid + 1 } else hi = mid - 1 }
  return ans
}

/** a smooth curve through (t, value) keyframes (monotone cubic: no overshoot between points) */
export function makeSpline(pts: [number, number][]): (t: number) => number {
  const n = pts.length
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]))
  const m = new Array<number>(n)
  m[0] = d[0]; m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b
    if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i] }
  }
  return (t: number) => {
    if (t <= xs[0]) return ys[0]
    if (t >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (t > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i], u = (t - xs[i]) / h, u2 = u * u, u3 = u2 * u
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1]
  }
}

/** damped spring toward `target`; `freq` in Hz, `damp` 1 = no overshoot, below 1 = bouncy */
export class Spring {
  x: number
  v = 0
  constructor(public target: number, public freq: number, public damp: number) { this.x = target }
  step(dt: number): number {
    const w = 2 * Math.PI * this.freq
    let left = Math.min(dt, 0.1)
    while (left > 1e-5) {
      const h = Math.min(left, 1 / 240)
      left -= h
      this.v += (w * w * (this.target - this.x) - 2 * this.damp * w * this.v) * h
      this.x += this.v * h
    }
    return this.x
  }
  snap(v: number) { this.target = v; this.x = v; this.v = 0 }
}

/** the look of one sung word, as functions of its progress 0..1 */
export const WORD = {
  scale: makeSpline([[0, 0.95], [0.7, 1.0505], [1, 1]]),
  lift: makeSpline([[0, 0.01], [0.9, -1 / 60], [1, 0]]),      // in em, scaled up a little by the renderer
  glow: makeSpline([[0, 0], [0.15, 1], [0.6, 1], [1, 0]]),
  spring: { scale: [0.88, 0.64], lift: [1.45, 0.4], glow: [1.18, 0.56] } as Record<'scale' | 'lift' | 'glow', [number, number]>,
}
/** the three dots of an instrumental break */
export const DOT = {
  scale: makeSpline([[0, 0.75], [0.7, 1.05], [1, 1]]),
  lift: makeSpline([[0, 0], [0.9, -0.12], [1, 0]]),
  glow: makeSpline([[0, 0], [0.6, 1], [1, 1]]),
  fade: makeSpline([[0, 0.35], [0.6, 1], [1, 1]]),
}

export function lyricsAnimSelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('lyricsAnim: ' + m) }
  const L = (t: number, text: string): LyricLine => ({ t, text })
  const tl = buildTimeline([L(9000, 'first line here'), L(13000, 'second'), L(14000, ''), L(21000, 'after the break')], 40000)
  need(tl[0].kind === 'gap' && tl[0].t1 < 9000, 'intro dots before a late first line')
  const lines = tl.filter((x): x is TLine => x.kind === 'line')
  need(lines.length === 3 && lines[0].words.length === 3 && lines[0].words[0].t0 === 9000 && lines[0].t1 <= 12850, 'words are timed inside the line')
  need(lines[0].words.every((w, i, a) => w.t1 > w.t0 && (i === 0 || w.t0 >= a[i - 1].t0)), 'word times increase')
  need(tl.some(x => x.kind === 'gap' && x.t0 === 14000), 'an empty line becomes an instrumental gap')
  need(activeItem(tl, 0) === -1 && tl[activeItem(tl, 9500)].t0 === 9000 && activeItem(tl, 99999) === tl.length - 1, 'active item lookup')
  const s = makeSpline([[0, 0.95], [0.7, 1.0505], [1, 1]])
  need(Math.abs(s(0) - 0.95) < 1e-9 && Math.abs(s(0.7) - 1.0505) < 1e-9 && Math.abs(s(1) - 1) < 1e-9 && s(0.85) > 1 && s(0.85) < 1.0505, 'spline passes through its keyframes')
  const sp = new Spring(0, 1.45, 0.4)
  sp.target = 1
  let peak = 0
  for (let i = 0; i < 240; i++) peak = Math.max(peak, sp.step(1 / 60))
  need(peak > 1.05 && Math.abs(sp.x - 1) < 0.02, 'underdamped spring overshoots then settles')
  return 'lyricsAnim ok'
}
