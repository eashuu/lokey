import { useEffect, useRef } from 'react'
import type { GlowState } from '@shared/bridge'
import { bridge } from '@/bridge'

type Live = Exclude<GlowState, 'off'>
const MAX = 0.3 // gradient boxes are sized for the biggest reach; smaller reaches scale them down from the edge
const P: Record<Live, { reach: number; base: number; cycle: number; color: string; breath: (phi: number) => number }> = {
  speaking: { reach: 0.21, base: 0.2, cycle: 1700, color: '84,168,255', breath: p => 1 + 0.85 * (0.5 - 0.5 * Math.cos(2 * Math.PI * p)) },
  thinking: { reach: 0.3, base: 0.19, cycle: 2600, color: '84,168,255', breath: p => 1 + 0.35 * Math.sin(2 * Math.PI * p) },
  research: { reach: 0.3, base: 0.19, cycle: 4200, color: '182,156,255', breath: p => 1 + 0.35 * Math.sin(2 * Math.PI * p) },
}
const smooth = (u: number) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u) }

// eased falloff (colour at the edge, transparent at the reach) instead of a plain linear ramp
const grad = (dir: string) => `linear-gradient(${dir}, rgba(var(--c),1) 0%, rgba(var(--c),.55) 22%, rgba(var(--c),.2) 52%, rgba(var(--c),.05) 80%, rgba(var(--c),0) 100%)`
const EDGES = [
  { dir: 'to bottom', box: { top: 0, left: 0, right: 0, height: `${MAX * 100}vmin` }, origin: 'top', scale: (k: number) => `scaleY(${k})` },
  { dir: 'to top', box: { bottom: 0, left: 0, right: 0, height: `${MAX * 100}vmin` }, origin: 'bottom', scale: (k: number) => `scaleY(${k})` },
  { dir: 'to right', box: { top: 0, bottom: 0, left: 0, width: `${MAX * 100}vmin` }, origin: 'left', scale: (k: number) => `scaleX(${k})` },
  { dir: 'to left', box: { top: 0, bottom: 0, right: 0, width: `${MAX * 100}vmin` }, origin: 'right', scale: (k: number) => `scaleX(${k})` },
]

/** Transient full-screen page: four edge gradients, one rAF loop that only runs while the glow is visible. */
export function GlowApp() {
  const wrap = useRef<HTMLDivElement>(null)
  const edges = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const wrapEl = wrap.current!
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    let still = mq.matches || false
    void bridge.settings.get().then(s => { still = still || s.appearance.reduceMotion }).catch(() => undefined)
    const off = bridge.settings.onChange(s => { still = mq.matches || s.appearance.reduceMotion })

    let state: GlowState = 'off'
    let want: Live = 'thinking' // last live state (kept while fading out)
    let env = 0 // fade envelope 0..1
    let from = 0 // envelope when the current fade started
    let fadeAt = 0
    let reach = P.thinking.reach
    let raf = 0
    let last = 0

    const paint = (t: number) => {
      const p = P[want]
      const mult = still ? 1 : p.breath((t % p.cycle) / p.cycle)
      wrapEl.style.opacity = String(Math.min(1, p.base * mult * env))
      const k = reach / MAX
      EDGES.forEach((e, i) => { const el = edges.current[i]; if (el) el.style.transform = e.scale(k) })
    }
    const frame = (t: number) => {
      const dt = last ? t - last : 16
      last = t
      const target = state === 'off' ? 0 : 1
      env = from + (target - from) * smooth((t - fadeAt) / (target ? 120 : 450))
      // ease the reach toward the active state's (thinking <-> speaking switches)
      reach += (P[want].reach - reach) * (1 - Math.exp(-dt / 120))
      paint(t)
      if (state === 'off' && env <= 0.001) { raf = 0; last = 0; wrapEl.style.opacity = '0'; return }
      raf = requestAnimationFrame(frame)
    }

    window.lokeyFx?.onGlow(s => {
      if (s === state) return
      const wasOff = state === 'off'
      state = s
      if (s !== 'off') {
        want = s
        wrapEl.style.setProperty('--c', P[s].color)
        if (wasOff) reach = P[s].reach
      }
      from = env
      fadeAt = performance.now()
      if (still) { // static glow: CSS fades, no loop
        wrapEl.style.transition = `opacity ${s === 'off' ? 450 : 120}ms ease`
        env = s === 'off' ? 0 : 1
        paint(0)
      } else {
        wrapEl.style.transition = 'none'
        if (!raf) raf = requestAnimationFrame(frame)
      }
    })
    return () => { cancelAnimationFrame(raf); off() }
  }, [])

  return (
    <div ref={wrap} style={{ position: 'fixed', inset: 0, opacity: 0, pointerEvents: 'none', background: 'transparent', ['--c' as string]: P.thinking.color }}>
      {EDGES.map((e, i) => (
        <div key={i} ref={el => { edges.current[i] = el }} style={{ position: 'absolute', ...e.box, background: grad(e.dir), transformOrigin: e.origin, willChange: 'transform' }} />
      ))}
    </div>
  )
}
