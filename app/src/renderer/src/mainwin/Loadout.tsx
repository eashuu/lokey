import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { AnimatePresence } from 'motion/react'
import { useData } from '@/lib/data'
import { clamp } from '@/lib/format'
import { Soul } from '@/island/Soul'
import { SOUL_SKINS } from '@/island/skins'
import type { SoulMode } from '@/island/store'
import { Picker } from './Picker'
import { PoseBar } from './PoseBar'
import { SLOTS, type SlotId } from './slots'

const N = 19                       // rope points
const CARD_W = 140, CARD_H = 54
const K = 15, C = 0.6 * 2 * Math.sqrt(K) // spring stiffness, damping at 0.6 of critical
const SPIN = (Math.PI * 2) / 80    // rad/s
const SPARK_EVERY = 3.2, SPARK_TRAVEL = 1.2

function useVisible() {
  const [v, setV] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const f = () => setV(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])
  return v
}

interface CardSim { x: number; y: number; vx: number; vy: number; dragging: boolean; started: boolean }
interface Rope { x: Float64Array; y: Float64Array; ox: Float64Array; oy: Float64Array; init: boolean }

export function Loadout() {
  const loadout = useData(s => s.settings.loadout)
  const reduce = useData(s => s.settings.appearance.reduceMotion)
  const visible = useVisible()
  const [picker, setPicker] = useState<SlotId | null>(null)
  const [soulMode, setSoulMode] = useState<SoulMode>('LISTENING')

  const stage = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const els = useRef<(HTMLDivElement | null)[]>([])
  const hov = useRef([false, false, false, false])
  const pickerOpen = useRef(false); pickerOpen.current = picker !== null
  const reduceRef = useRef(reduce); reduceRef.current = reduce
  const sim = useRef({
    w: 0, h: 0, theta: 0, spin: 1, t: 0,
    cards: SLOTS.map((): CardSim => ({ x: 0, y: 0, vx: 0, vy: 0, dragging: false, started: false })),
    ropes: SLOTS.map((): Rope => ({ x: new Float64Array(N), y: new Float64Array(N), ox: new Float64Array(N), oy: new Float64Array(N), init: false })),
  })
  const drag = useRef<{ i: number; id: number; sx: number; sy: number; dx: number; dy: number; moved: boolean } | null>(null)

  // stage size -> canvas backing store (DPR capped at 2)
  useEffect(() => {
    const el = stage.current, c = cv.current
    if (!el || !c) return
    const fit = () => {
      const r = el.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      sim.current.w = r.width; sim.current.h = r.height
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // the one animation loop: runs only while this page is mounted and the document is visible
  useEffect(() => {
    if (!visible) return
    const c = cv.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    let raf = 0, last = 0
    const S = sim.current

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.033, last ? (now - last) / 1000 : 0.016)
      last = now
      if (!S.w) return
      const still = reduceRef.current
      S.t += dt
      const hold = pickerOpen.current || hov.current.some(Boolean) || drag.current !== null || still
      S.spin += ((hold ? 0 : 1) - S.spin) * Math.min(1, dt * 2.5)
      S.theta += SPIN * S.spin * dt

      const cx = S.w / 2, cy = S.h / 2 + 6, rx = S.w * 0.34, ry = S.h * 0.3
      const hw = CARD_W / 2, hh = CARD_H / 2
      const dpr = c.width / S.w
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, S.w, S.h)
      g.lineWidth = 1.2
      g.lineCap = 'round'

      SLOTS.forEach((slot, i) => {
        const cs = S.cards[i], rope = S.ropes[i], el = els.current[i]
        const a = (slot.angle * Math.PI) / 180 + S.theta
        const tx = clamp(cx + rx * Math.cos(a), hw + 8, S.w - hw - 8)
        const ty = clamp(cy - ry * Math.sin(a), hh + 8, S.h - hh - 8)
        const delay = still ? 0 : 0.18 + 0.16 * i
        const k = clamp((S.t - delay) / 0.3, 0, 1)
        if (S.t >= delay) {
          if (!cs.started) { cs.started = true; if (still) { cs.x = tx; cs.y = ty } }
          if (!cs.dragging) {
            cs.vx += (K * (tx - cs.x) - C * cs.vx) * dt
            cs.vy += (K * (ty - cs.y) - C * cs.vy) * dt
            cs.x += cs.vx * dt; cs.y += cs.vy * dt
          }
          // soft frame hit-test: keep the card inside the stage, kill velocity into the wall
          const mx = clamp(cs.x, hw + 4, S.w - hw - 4), my = clamp(cs.y, hh + 4, S.h - hh - 4)
          if (mx !== cs.x) cs.vx = 0
          if (my !== cs.y) cs.vy = 0
          cs.x = mx; cs.y = my
        } else { cs.x = cx; cs.y = cy }
        if (el) {
          el.style.opacity = String(k)
          el.style.transform = `translate3d(${cs.x - hw}px,${cs.y - hh}px,0) scale(${0.6 + 0.4 * k})`
        }

        // rope: verlet chain pinned at the soul and at the card, slightly slack so it sags
        const { x, y, ox, oy } = rope
        if (!rope.init) {
          for (let j = 0; j < N; j++) { x[j] = ox[j] = cx; y[j] = oy[j] = cy }
          rope.init = true
        }
        const gr = 520 * dt * dt
        for (let j = 1; j < N - 1; j++) {
          const vx = (x[j] - ox[j]) * 0.985, vy = (y[j] - oy[j]) * 0.985
          ox[j] = x[j]; oy[j] = y[j]
          x[j] += vx; y[j] += vy + gr
        }
        x[0] = cx; y[0] = cy; x[N - 1] = cs.x; y[N - 1] = cs.y
        const rest = (Math.hypot(cs.x - cx, cs.y - cy) / (N - 1)) * 1.03
        for (let it = 0; it < 6; it++) {
          for (let j = 0; j < N - 1; j++) {
            const dx = x[j + 1] - x[j], dy = y[j + 1] - y[j]
            const d = Math.hypot(dx, dy) || 1e-6
            const w0 = j === 0 ? 0 : 1, w1 = j + 1 === N - 1 ? 0 : 1
            const f = (d - rest) / d / (w0 + w1 || 1)
            x[j] += dx * f * w0; y[j] += dy * f * w0
            x[j + 1] -= dx * f * w1; y[j + 1] -= dy * f * w1
          }
        }
        if (k <= 0) return
        g.globalAlpha = k
        g.strokeStyle = 'rgba(236,238,244,.84)'
        g.beginPath()
        g.moveTo(x[0], y[0])
        for (let j = 1; j < N - 1; j++) g.quadraticCurveTo(x[j], y[j], (x[j] + x[j + 1]) / 2, (y[j] + y[j + 1]) / 2)
        g.lineTo(x[N - 1], y[N - 1])
        g.stroke()
        // spark travelling soul -> card every 3.2 s, phase-shifted per rope
        const ph = ((((S.t - 0.9 - i * 0.8) % SPARK_EVERY) + SPARK_EVERY) % SPARK_EVERY)
        if (ph < SPARK_TRAVEL) {
          const u = ph / SPARK_TRAVEL, f = u * u * (3 - 2 * u) * (N - 1)
          const j = Math.min(N - 2, Math.floor(f)), r = f - j
          const px = x[j] + (x[j + 1] - x[j]) * r, py = y[j] + (y[j + 1] - y[j]) * r
          g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.arc(px, py, 4.5, 0, 6.283); g.fill()
          g.fillStyle = '#fff'; g.beginPath(); g.arc(px, py, 2, 0, 6.283); g.fill()
        }
        g.globalAlpha = 1
      })
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [visible])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const down = (e: RPointerEvent<HTMLDivElement>, i: number) => {
    if (e.button !== 0) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
    const p = local(e), c = sim.current.cards[i]
    drag.current = { i, id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: c.x - p.x, dy: c.y - p.y, moved: false }
  }
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return
    d.moved = true
    const c = sim.current.cards[d.i], p = local(e)
    c.dragging = true; c.vx = c.vy = 0
    c.x = p.x + d.dx; c.y = p.y + d.dy
  }
  const up = (e: RPointerEvent<HTMLDivElement>, cancel = false) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    sim.current.cards[d.i].dragging = false
    if (!d.moved && !cancel) setPicker(SLOTS[d.i].id)
  }

  const personality = loadout.personalities.find(p => p.id === loadout.personality)
  const values: Record<SlotId, string> = {
    soul: SOUL_SKINS[loadout.soul]?.name ?? loadout.soul,
    personality: personality?.name ?? '—',
    voice: loadout.voice,
    abilities: loadout.abilities.length ? `${loadout.abilities.length} on` : '—',
  }
  const palette = (SOUL_SKINS[loadout.soul] ?? SOUL_SKINS.drop).palette

  return (
    <div ref={stage} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 28, top: 8 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 650 }}>Loadout</h1>
        <div style={{ marginTop: 2, fontSize: 12, color: 'var(--muted)' }}>Shape how your spirit looks, sounds and acts.</div>
      </div>
      <canvas ref={cv} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      {/* the spirit inside a soft ring; opaque inside so rope ends emerge from its edge */}
      <div style={{ position: 'absolute', left: '50%', top: 'calc(50% + 6px)', width: 176, height: 176, marginLeft: -88, marginTop: -88, borderRadius: '50%', display: 'grid', placeItems: 'center', pointerEvents: 'none',
        boxSizing: 'border-box', border: '2px solid rgb(var(--ov) / .1)', background: `radial-gradient(circle, ${palette.glow}38 0%, ${palette.glow}14 55%, transparent 100%), var(--s1)` }}>
        <Soul width={150} height={150} mode={soulMode} active={visible} palette={palette} />
      </div>
      {SLOTS.map((s, i) => (
        <div key={s.id} ref={el => { els.current[i] = el }} className="lk-slot" role="button" tabIndex={0} aria-label={`${s.title}: ${values[s.id]}`}
          onPointerDown={e => down(e, i)} onPointerMove={move} onPointerUp={e => up(e)} onPointerCancel={e => up(e, true)}
          onPointerEnter={() => { hov.current[i] = true }} onPointerLeave={() => { hov.current[i] = false }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicker(s.id) } }}
          style={{ position: 'absolute', left: 0, top: 0, width: CARD_W, height: CARD_H, opacity: 0, borderRadius: 12, boxSizing: 'border-box', padding: '0 12px', display: 'flex', alignItems: 'center', gap: 10,
            background: 'linear-gradient(rgb(var(--ov) / .063), rgb(var(--ov) / .063)), var(--s2)' }}>
          <s.icon size={16} color={s.color} style={{ flex: 'none' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{values[s.id]}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{s.title}</div>
          </div>
        </div>
      ))}
      <div style={{ position: 'absolute', left: 28, right: 28, bottom: 8 }}><PoseBar mode={soulMode} onMode={setSoulMode} /></div>
      <AnimatePresence>{picker && <Picker key="picker" slot={picker} onClose={() => setPicker(null)} />}</AnimatePresence>
    </div>
  )
}
