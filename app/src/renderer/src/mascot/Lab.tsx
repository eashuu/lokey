import { useEffect, useRef } from 'react'
import { MascotGL } from './gl'
import { NEUTRAL, type Params } from './rig'
import { GALLERY, POSES } from './poses'
import { SOUL_SKINS } from '@/island/skins'

// Visual QA sheet (`Lokey.exe --lab <dir>`): every pose rendered once at a representative moment, labelled, on one
// canvas. Hash query: names=a,b,c  size=px  cols=n  skin=id  at=seconds (default: 40% of the pose length).
const STATES = ['idle', 'sleep', 'hear', 'think', 'talk', 'write', 'look', 'hum', 'muted']

export function Lab() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    void (async () => {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
    const names = q.get('names')?.split(',') ?? [...STATES, ...GALLERY.map(g => g.name)]
    const size = Number(q.get('size') ?? 200)
    const cols = Number(q.get('cols') ?? 6)
    const skin = SOUL_SKINS[q.get('skin') ?? 'drop']?.palette ?? SOUL_SKINS.drop.palette
    const at = q.get('at')
    const rows = Math.ceil(names.length / cols)
    const cv = ref.current!
    cv.width = cols * size
    cv.height = rows * (size + 22)
    const g = cv.getContext('2d')!
    g.fillStyle = '#15171c'
    g.fillRect(0, 0, cv.width, cv.height)
    const off = document.createElement('canvas')
    off.width = size
    off.height = size
    const log: string[] = []
    try {
      const gl = new MascotGL(off)
      gl.resize(size, size)
      while (!gl.ready()) await new Promise(r => setTimeout(r, 20))
      names.forEach((n, i) => {
        const p = POSES[n]
        const x = (i % cols) * size
        const y = Math.floor(i / cols) * (size + 22)
        if (!p) { log.push('unknown pose ' + n); return }
        const t = at ? Number(at) : (p.dur ?? 1.5) * 0.4
        const P: Params = { ...NEUTRAL, ...p.f(t, { gx: 0, gy: 0, level: 0.7 }) }
        gl.draw(P, { top: skin.top, bottom: skin.bottom, glow: skin.glow, ink: skin.ink }, t, 1, 1.08)
        g.drawImage(off, x, y + 22)
        g.fillStyle = '#9aa3b2'
        g.font = '13px Segoe UI, sans-serif'
        g.fillText(n, x + 10, y + 16)
      })
    } catch (e) {
      log.push(String(e))
    }
    ;(window as unknown as { __labDone: string }).__labDone = JSON.stringify(log)
    })()
  }, [])
  return <canvas ref={ref} style={{ display: 'block' }} />
}
