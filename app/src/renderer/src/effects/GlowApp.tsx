import { useEffect, useRef } from 'react'
import type { GlowState } from '@shared/bridge'
import { bridge } from '@/bridge'

type Live = Exclude<GlowState, 'off'>
export const P: Record<Live, { reach: number; base: number; cycle: number; color: [number, number, number]; breath: (phi: number) => number }> = {
  speaking: { reach: 0.21, base: 0.2, cycle: 1700, color: [84, 168, 255], breath: p => 1 + 0.85 * (0.5 - 0.5 * Math.cos(2 * Math.PI * p)) },
  thinking: { reach: 0.3, base: 0.19, cycle: 2600, color: [84, 168, 255], breath: p => 1 + 0.35 * Math.sin(2 * Math.PI * p) },
  research: { reach: 0.3, base: 0.19, cycle: 4200, color: [182, 156, 255], breath: p => 1 + 0.35 * Math.sin(2 * Math.PI * p) },
}
const smooth = (u: number) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u) }
const SCALE = 0.5 // the canvas is drawn at half device resolution: the glow is smooth, the browser upsamples it

/** Edge falloff: 1 at the screen edge, ~.5 at 22% of the reach, ~.19 at 52%, fading to exactly 0 at the reach. */
const falloff = (t: number) => (t >= 1 ? 0 : Math.exp(-2.9 * t) * (1 - smooth(t)))

/**
 * Paints the whole glow once: each edge contributes its own 1-D falloff and the four are combined as "1 - product of
 * (1 - edge)", so corners add up smoothly (no overlapping rectangles, no diagonal seams). Triangular dither on the
 * 8-bit alpha keeps the long, faint tail from banding into visible steps.
 */
export function paint(cv: HTMLCanvasElement, reachFrac: number, rgb: [number, number, number], size?: { w: number; h: number }) {
  const w = size?.w ?? Math.max(2, Math.round(innerWidth * devicePixelRatio * SCALE))
  const h = size?.h ?? Math.max(2, Math.round(innerHeight * devicePixelRatio * SCALE))
  cv.width = w; cv.height = h
  const reach = Math.min(w, h) * reachFrac * 1.0
  const fx0 = new Float32Array(w), fx1 = new Float32Array(w), fy0 = new Float32Array(h), fy1 = new Float32Array(h)
  for (let x = 0; x < w; x++) { fx0[x] = falloff((x + 0.5) / reach); fx1[x] = falloff((w - x - 0.5) / reach) }
  for (let y = 0; y < h; y++) { fy0[y] = falloff((y + 0.5) / reach); fy1[y] = falloff((h - y - 0.5) / reach) }
  const g = cv.getContext('2d')!
  const img = g.createImageData(w, h)
  const d = img.data
  let i = 0
  for (let y = 0; y < h; y++) {
    const ky = (1 - fy0[y]) * (1 - fy1[y])
    for (let x = 0; x < w; x++, i += 4) {
      const a = (1 - ky * (1 - fx0[x]) * (1 - fx1[x])) * 255
      d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]
      d[i + 3] = a < 0.004 ? 0 : Math.max(0, Math.min(255, Math.round(a + Math.random() + Math.random() - 1)))
    }
  }
  g.putImageData(img, 0, 0)
}

/** Transient full-screen page: one pre-rendered glow canvas; the loop only animates opacity and runs only while visible. */
export function GlowApp() {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const wrapEl = wrap.current!
    const canvas = cv.current!
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    let still = mq.matches || false
    void bridge.settings.get().then(s => { still = still || s.appearance.reduceMotion }).catch(() => undefined)
    const off = bridge.settings.onChange(s => { still = mq.matches || s.appearance.reduceMotion })

    let state: GlowState = 'off'
    let want: Live = 'thinking' // last live state (kept while fading out)
    let env = 0 // fade envelope 0..1
    let from = 0 // envelope when the current fade started
    let fadeAt = 0
    let raf = 0
    let drawn = ''

    const ensurePainted = (s: Live) => {
      const key = `${s}:${innerWidth}x${innerHeight}`
      if (drawn !== key) { paint(canvas, P[s].reach, P[s].color); drawn = key }
    }
    const level = (t: number) => {
      const p = P[want]
      const mult = still ? 1 : p.breath((t % p.cycle) / p.cycle)
      wrapEl.style.opacity = String(Math.min(1, p.base * mult * env))
    }
    const frame = (t: number) => {
      const target = state === 'off' ? 0 : 1
      env = from + (target - from) * smooth((t - fadeAt) / (target ? 120 : 450))
      level(t)
      if (state === 'off' && env <= 0.001) { raf = 0; wrapEl.style.opacity = '0'; return }
      raf = requestAnimationFrame(frame)
    }

    window.lokeyFx?.onGlow(s => {
      if (s === state) return
      state = s
      if (s !== 'off') { want = s; ensurePainted(s) }
      from = env
      fadeAt = performance.now()
      if (still) { // static glow: CSS fades, no loop
        wrapEl.style.transition = `opacity ${s === 'off' ? 450 : 120}ms ease`
        env = s === 'off' ? 0 : 1
        level(0)
      } else {
        wrapEl.style.transition = 'none'
        if (!raf) raf = requestAnimationFrame(frame)
      }
    })
    return () => { cancelAnimationFrame(raf); off() }
  }, [])

  return (
    <div ref={wrap} style={{ position: 'fixed', inset: 0, opacity: 0, pointerEvents: 'none', background: 'transparent' }}>
      <style>{'html, body, #root { background: transparent !important; margin: 0; overflow: hidden; }'}</style>
      <canvas ref={cv} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
    </div>
  )
}
