import { useEffect, useRef } from 'react'
import type { SoulMode } from './store'

// The island's mascot: a glowing water-drop spirit with a face and two little hands (original artwork).
// It only runs a render loop while `active`; when the island sleeps or the menu is open nothing is scheduled.

export interface SoulPalette { top: string; bottom: string; glow: string; ink: string; foot?: string; /** 0 = water drop, 1 = round puffball */ form?: number }
export const DEFAULT_PALETTE: SoulPalette = { top: '#FFE3EF', bottom: '#FFA6CD', glow: '#FF7FB8', ink: '#2A1740', foot: '#E5457A', form: 1 }

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a))})`
}

/** Teardrop outline: pointed tip at the top (curling by `sway`), wide soft belly at the bottom. */
function drop(g: CanvasRenderingContext2D, cx: number, base: number, h: number, w: number, sway: number, squash: number) {
  const top = base - h
  const bw = w * (1 + squash)
  g.beginPath()
  g.moveTo(cx + sway, top)
  g.bezierCurveTo(cx + bw * 0.12 + sway * 0.6, top + h * 0.28, cx + bw * 0.5, base - h * 0.42, cx + bw * 0.5, base - h * 0.2)
  g.bezierCurveTo(cx + bw * 0.5, base + h * 0.02, cx + bw * 0.22, base, cx, base)
  g.bezierCurveTo(cx - bw * 0.22, base, cx - bw * 0.5, base + h * 0.02, cx - bw * 0.5, base - h * 0.2)
  g.bezierCurveTo(cx - bw * 0.5, base - h * 0.42, cx - bw * 0.12 + sway * 0.6, top + h * 0.28, cx + sway, top)
  g.closePath()
}

export function Soul2D({ width, height, mode, active, palette = DEFAULT_PALETTE }: { width: number; height: number; mode: SoulMode; active: boolean; palette?: SoulPalette }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const palRef = useRef(palette)
  palRef.current = palette

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    cv.width = Math.round(width * dpr)
    cv.height = Math.round(height * dpr)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, width, height)
    if (!active) return

    let raf = 0
    let last = 0
    let t = Math.random() * 10
    let nextBlink = 1.4 + Math.random() * 2.5
    let blink = 0 // 0..1, 1 = closed
    let talk = 0
    let look = 0  // eyes looking up (thinking)
    let open = 0  // mouth open amount (talking / yawning)

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
      last = now
      t += dt
      const m = modeRef.current
      const p = palRef.current

      // behaviour targets per mode
      const talking = m === 'TALKING'
      const yawn = m === 'YAWNING'
      const think = m === 'THINKING'
      talk = talking ? (0.45 + 0.55 * Math.abs(Math.sin(t * 9.5)) * (0.6 + 0.4 * Math.sin(t * 3.1))) : 0
      open += ((talking ? talk : yawn ? 1 : 0) - open) * Math.min(1, dt * 14)
      look += ((think ? 1 : 0) - look) * Math.min(1, dt * 6)
      nextBlink -= dt
      if (nextBlink <= 0 && !yawn) { blink = 1; nextBlink = 2.2 + Math.random() * 3.2 }
      blink = Math.max(0, blink - dt * 7)
      const eyeClose = yawn ? 1 : m === 'MUTED' ? 0.75 : Math.sin(Math.min(1, blink) * Math.PI)

      const unit = Math.min(width, height)
      const H = unit * 0.78
      const W = H * 0.74
      const bob = Math.sin(t * (talking ? 6 : 2.2)) * unit * (talking ? 0.018 : 0.012)
      const sway = Math.sin(t * 1.7) * W * 0.06 + (think ? Math.sin(t * 3.4) * W * 0.05 : 0)
      const squash = talking ? talk * 0.05 : 0
      const cx = width / 2
      const base = height - unit * 0.1 + bob

      g.clearRect(0, 0, width, height)

      // halo
      const haloR = Math.min(H * 1.05, width / 2, height / 2 + H * 0.2)
      const halo = g.createRadialGradient(cx, base - H * 0.42, 0, cx, base - H * 0.42, haloR)
      halo.addColorStop(0, rgba(p.glow, 0.42))
      halo.addColorStop(1, rgba(p.glow, 0))
      g.fillStyle = halo
      g.beginPath()
      g.arc(cx, base - H * 0.42, haloR, 0, Math.PI * 2)
      g.fill()

      // body
      const body = g.createLinearGradient(0, base - H, 0, base)
      body.addColorStop(0, p.top)
      body.addColorStop(1, p.bottom)
      g.fillStyle = body
      drop(g, cx, base, H, W, sway, squash)
      g.fill()
      // inner highlight
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.beginPath()
      g.ellipse(cx - W * 0.16, base - H * 0.38, W * 0.09, H * 0.12, -0.35, 0, Math.PI * 2)
      g.fill()

      // hands (little round nubs at the lower sides)
      const handY = base - H * 0.2 + Math.sin(t * 2.6) * unit * 0.01
      g.fillStyle = body
      for (const s of [-1, 1]) {
        g.beginPath()
        g.arc(cx + s * (W * 0.54), handY - (talking ? Math.abs(Math.sin(t * 6 + s)) * unit * 0.03 : 0), unit * 0.085, 0, Math.PI * 2)
        g.fill()
      }

      // face
      const eyeY = base - H * 0.36 - look * H * 0.05
      const eyeDX = W * 0.17 + look * W * 0.01
      g.fillStyle = p.ink
      for (const s of [-1, 1]) {
        g.beginPath()
        g.ellipse(cx + s * eyeDX + look * W * 0.02, eyeY, unit * 0.034, unit * 0.05 * (1 - eyeClose * 0.92), 0, 0, Math.PI * 2)
        g.fill()
      }
      // mouth
      const mouthY = base - H * 0.2
      g.fillStyle = p.ink
      g.strokeStyle = p.ink
      g.lineWidth = Math.max(1, unit * 0.016)
      g.lineCap = 'round'
      if (open > 0.08) {
        g.beginPath()
        g.ellipse(cx, mouthY + open * unit * 0.01, unit * 0.04, unit * (0.015 + open * 0.05), 0, 0, Math.PI * 2)
        g.fill()
      } else if (think) {
        g.beginPath()
        g.arc(cx, mouthY, unit * 0.018, 0, Math.PI * 2)
        g.fill()
      } else {
        g.beginPath()
        g.arc(cx, mouthY - unit * 0.012, unit * 0.04, 0.2 * Math.PI, 0.8 * Math.PI)
        g.stroke()
      }
      // cheeks
      g.fillStyle = 'rgba(255,140,170,0.35)'
      for (const s of [-1, 1]) {
        g.beginPath()
        g.ellipse(cx + s * W * 0.3, eyeY + unit * 0.07, unit * 0.04, unit * 0.025, 0, 0, Math.PI * 2)
        g.fill()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [width, height, active])

  return <canvas ref={ref} style={{ width, height, display: 'block' }} aria-hidden />
}
