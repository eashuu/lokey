import { useEffect, useRef } from 'react'
import type { LassoEvent } from '@shared/voice'

// #lasso page: a transparent, click-through canvas over the whole display. Draws the pointer path as a thin glowing
// light-blue stroke while the key is held; on release the loop closes, pulses once and fades away. The render loop runs
// only while there is something to show.
export function LassoApp() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!
    const g = cv.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(innerWidth * dpr)
    cv.height = Math.round(innerHeight * dpr)
    g.scale(dpr, dpr)
    let pts: { x: number; y: number }[] = []
    let raf = 0
    let endedAt = 0
    let startedAt = 0

    const stroke = (list: { x: number; y: number }[], alpha: number, closeT: number) => {
      if (list.length < 2) return
      const path = new Path2D()
      path.moveTo(list[0].x, list[0].y)
      for (let i = 1; i < list.length - 1; i++) {
        const mx = (list[i].x + list[i + 1].x) / 2, my = (list[i].y + list[i + 1].y) / 2
        path.quadraticCurveTo(list[i].x, list[i].y, mx, my)
      }
      const last = list[list.length - 1]
      path.lineTo(last.x, last.y)
      if (closeT > 0) { const f = list[0]; path.lineTo(last.x + (f.x - last.x) * closeT, last.y + (f.y - last.y) * closeT) }
      g.lineCap = 'round'; g.lineJoin = 'round'
      g.globalAlpha = alpha
      g.shadowColor = 'rgba(110,185,255,.95)'; g.shadowBlur = 14
      g.strokeStyle = 'rgba(150,205,255,.85)'; g.lineWidth = 3.4
      g.stroke(path)
      g.shadowBlur = 0
      g.strokeStyle = 'rgba(240,250,255,.98)'; g.lineWidth = 1.5
      g.stroke(path)
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
      stroke(pts, fade, close)
      if (fade > 0) raf = requestAnimationFrame(frame)
      else g.clearRect(0, 0, innerWidth, innerHeight)
    }

    window.lokeyOverlay?.on('lasso', (d: LassoEvent) => {
      if (d.type === 'start') { pts = []; endedAt = 0; startedAt = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(frame) }
      else if (d.type === 'point') { if (d.pts) pts.push(...d.pts) }
      else if (d.type === 'end') endedAt = performance.now()
      else if (d.type === 'cancel') { cancelAnimationFrame(raf); g.clearRect(0, 0, innerWidth, innerHeight) }
    })
    window.lokeyOverlay?.ready('lasso')
    return () => cancelAnimationFrame(raf)
  }, [])
  return (<><style>{'html, body, #root { background: transparent !important; margin: 0; overflow: hidden; }'}</style><canvas ref={ref} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', background: 'transparent' }} /></>)
}
