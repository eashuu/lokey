import { useEffect, useRef, useState } from 'react'
import type { LassoEvent } from '@shared/voice'

// #lasso page: a transparent canvas over the whole display.
//  - armed (tap mode): the screen is dimmed a little, the pointer is a crosshair, and the MOUSE draws: press and drag for a loop,
//    hold Shift for a box. Letting go sends the stroke to the app, the loop closes, pulses once and fades. Right click cancels.
//  - hold mode: click-through, the app sends the pointer path while the keys are held and this page just draws it.
// The render loop runs only while there is something to show.
type Pt = { x: number; y: number }

export function LassoApp() {
  const ref = useRef<HTMLCanvasElement>(null)
  const [hint, setHint] = useState('')
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const cv = ref.current!
    const g = cv.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(innerWidth * dpr)
    cv.height = Math.round(innerHeight * dpr)
    g.scale(dpr, dpr)
    let pts: Pt[] = []
    let raf = 0
    let endedAt = 0
    let startedAt = 0
    let isArmed = false
    let drawing = false
    let box: { a: Pt; b: Pt } | null = null

    const path = (list: Pt[], closeT: number) => {
      const p = new Path2D()
      if (box) { p.rect(Math.min(box.a.x, box.b.x), Math.min(box.a.y, box.b.y), Math.abs(box.b.x - box.a.x), Math.abs(box.b.y - box.a.y)); return p }
      p.moveTo(list[0].x, list[0].y)
      for (let i = 1; i < list.length - 1; i++) {
        const mx = (list[i].x + list[i + 1].x) / 2, my = (list[i].y + list[i + 1].y) / 2
        p.quadraticCurveTo(list[i].x, list[i].y, mx, my)
      }
      const last = list[list.length - 1]
      p.lineTo(last.x, last.y)
      if (closeT > 0) { const f = list[0]; p.lineTo(last.x + (f.x - last.x) * closeT, last.y + (f.y - last.y) * closeT) }
      return p
    }
    const stroke = (list: Pt[], alpha: number, closeT: number) => {
      if (!box && list.length < 2) return
      const p = path(list, closeT)
      g.lineCap = 'round'; g.lineJoin = 'round'
      g.globalAlpha = alpha
      g.shadowColor = 'rgba(110,185,255,.95)'; g.shadowBlur = 14
      g.strokeStyle = 'rgba(150,205,255,.85)'; g.lineWidth = 3.4
      g.stroke(p)
      g.shadowBlur = 0
      g.strokeStyle = 'rgba(240,250,255,.98)'; g.lineWidth = 1.5
      g.stroke(p)
      g.globalAlpha = 1
    }

    const frame = (now: number) => {
      g.clearRect(0, 0, innerWidth, innerHeight)
      if (!endedAt) {
        // oldest part of a long stroke thins out so the circle you are drawing stays the focus
        stroke(pts.length > 700 ? pts.slice(-700) : pts, Math.min(1, (now - startedAt) / 120), 0)
        raf = requestAnimationFrame(frame)
        return
      }
      const t = (now - endedAt) / 1000
      const close = Math.min(1, t / 0.22)
      const fade = t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.55)
      stroke(pts, fade, box ? 0 : close)
      if (fade > 0) raf = requestAnimationFrame(frame)
      else g.clearRect(0, 0, innerWidth, innerHeight)
    }
    const begin = () => { pts = []; box = null; endedAt = 0; startedAt = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame) }
    const reset = () => { cancelAnimationFrame(raf); isArmed = false; drawing = false; box = null; pts = []; g.clearRect(0, 0, innerWidth, innerHeight); setArmed(false); setHint('') }

    // ---- drawing with the mouse (armed) ----
    const down = (e: PointerEvent) => {
      if (!isArmed) return
      if (e.button === 2) { window.lokeyLasso?.cancel(); return }
      if (e.button !== 0) return
      drawing = true
      begin()
      pts.push({ x: e.clientX, y: e.clientY })
      if (e.shiftKey) box = { a: pts[0], b: pts[0] }
      setHint('')
    }
    const move = (e: PointerEvent) => {
      if (!drawing) return
      const p = { x: e.clientX, y: e.clientY }
      if (box) { box.b = p; pts = [box.a, { x: box.b.x, y: box.a.y }, box.b, { x: box.a.x, y: box.b.y }] } // the four corners go to the app
      else if (pts.length < 4000) { const l = pts[pts.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) >= 2) pts.push(p) }
    }
    const up = () => {
      if (!drawing) return
      drawing = false
      const size = box ? Math.hypot(box.b.x - box.a.x, box.b.y - box.a.y) : pts.length
      if (size < (box ? 12 : 8)) { box = null; pts = []; endedAt = 0; cancelAnimationFrame(raf); g.clearRect(0, 0, innerWidth, innerHeight); setHint('Draw a loop around it'); return } // too small: keep waiting
      endedAt = performance.now()
      isArmed = false
      setArmed(false)
      window.lokeyLasso?.stroke(pts.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })))
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('contextmenu', e => e.preventDefault())

    window.lokeyOverlay?.on('lasso', (d: LassoEvent) => {
      if (d.type === 'arm') { reset(); isArmed = true; setArmed(true); setHint(d.hint ?? '') }
      else if (d.type === 'start') { pts = []; box = null; endedAt = 0; startedAt = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame) }
      else if (d.type === 'point') { if (d.pts) pts.push(...d.pts) }
      else if (d.type === 'end') endedAt = performance.now()
      else if (d.type === 'cancel') reset()
    })
    window.lokeyOverlay?.ready('lasso')
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [])

  return (
    <>
      <style>{'html, body, #root { background: transparent !important; margin: 0; overflow: hidden; } @keyframes lk-hint { from { opacity: 0; transform: translate(-50%, -8px) scale(.96) } to { opacity: 1; transform: translate(-50%, 0) } }'}</style>
      <div style={{ position: 'fixed', inset: 0, background: armed ? 'rgba(6,10,20,.2)' : 'transparent', cursor: armed ? 'crosshair' : 'default', transition: 'background .18s' }} />
      <canvas ref={ref} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', background: 'transparent', pointerEvents: 'none' }} />
      {hint && (
        <div style={{ position: 'fixed', left: '50%', top: 84, transform: 'translateX(-50%)', padding: '9px 18px', borderRadius: 18, background: '#0a0a0b', color: '#fff', fontSize: 13, fontWeight: 500, fontFamily: '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif', boxShadow: '0 10px 24px -8px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.1)', animation: 'lk-hint .3s cubic-bezier(.22,1,.36,1) both', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{hint}</div>
      )}
    </>
  )
}
