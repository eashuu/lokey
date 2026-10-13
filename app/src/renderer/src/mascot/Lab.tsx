import { useEffect, useRef } from 'react'
import { MascotGL } from './gl'
import { NEUTRAL, type Params } from './rig'
import { GALLERY, POSES } from './poses'
import { SOUL_SKINS } from '@/island/skins'
import { P as GLOW, paint as paintGlow } from '@/effects/GlowApp'

// Visual QA sheet (`Lokey.exe --lab <dir>`): every pose rendered once at a representative moment, labelled, on one
// canvas. Hash query: names=a,b,c  size=px  cols=n  skin=id  at=seconds (default: 40% of the pose length).
const STATES = ['idle', 'sleep', 'hear', 'think', 'talk', 'write', 'look', 'hum', 'muted']

export function Lab() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    void (async () => {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
    if (q.get('fx') === 'glowlayer') {
      // transparent full-screen glow for compositing into README art: w,h in px, state thinking|speaking
      const st = (q.get('state') ?? 'thinking') as 'thinking' | 'speaking'
      const cvs = ref.current!
      paintGlow(cvs, GLOW[st].reach, GLOW[st].color, { w: Number(q.get('w') ?? 1600), h: Number(q.get('h') ?? 900) })
      ;(window as unknown as { __labPng: string }).__labPng = cvs.toDataURL('image/png')
      ;(window as unknown as { __labDone: string }).__labDone = '[]'
      return
    }
    if (q.get('fx') === 'glow') {
      // the edge glow on a dark and a light background, 640x400 each, with the numeric alpha at the very border
      const cvs = ref.current!
      cvs.width = 1300; cvs.height = 420
      const g2 = cvs.getContext('2d')!
      const tile = document.createElement('canvas')
      const out: string[] = []
      ;(['thinking', 'speaking'] as const).forEach((st, i) => {
        paint: {
          paintGlow(tile, GLOW[st].reach, GLOW[st].color, { w: 640, h: 400 })
          const d = tile.getContext('2d')!.getImageData(0, 0, 640, 400).data
          out.push(st + ' alpha@edge=' + d[3 + 4 * 320] + ' @mid=' + d[3 + 4 * (200 * 640 + 320)] + ' @reach=' + d[3 + 4 * (200 * 640 + Math.round(Math.min(640, 400) * GLOW[st].reach))])
          g2.fillStyle = i === 0 ? '#23262d' : '#e9e6df'
          g2.fillRect(i * 650, 0, 640, 420)
          g2.globalAlpha = GLOW[st].base * 2.2
          g2.drawImage(tile, i * 650, 10)
          g2.globalAlpha = 1
        }
      })
      ;(window as unknown as { __labDone: string }).__labDone = JSON.stringify(out)
      return
    }
    const names = q.get('names')?.split(',') ?? [...STATES, ...GALLERY.map(g => g.name)]
    const size = Number(q.get('size') ?? 200)
    const cols = Number(q.get('cols') ?? 6)
    const skin = SOUL_SKINS[q.get('skin') ?? 'puff']?.palette ?? SOUL_SKINS.puff.palette
    const at = q.get('at')
    const rows = Math.ceil(names.length / cols)
    const cv = ref.current!
    cv.width = cols * size
    cv.height = rows * (size + (q.get('bg') === 'none' ? 0 : 22))
    const g = cv.getContext('2d')!
    const bare = q.get('bg') === 'none'
    if (!bare) { g.fillStyle = '#15171c'; g.fillRect(0, 0, cv.width, cv.height) }
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
        const y = Math.floor(i / cols) * (size + (bare ? 0 : 22))
        if (!p) { log.push('unknown pose ' + n); return }
        const t = at ? Number(at) : (p.dur ?? 1.5) * 0.4
        const P: Params = { ...NEUTRAL, ...p.f(t, { gx: 0, gy: 0, level: 0.7 }) }
        gl.draw(P, { top: skin.top, bottom: skin.bottom, glow: skin.glow, ink: skin.ink, foot: skin.foot ?? skin.bottom, form: skin.form ?? 0 }, t, 1, 1.08)
        g.drawImage(off, x, bare ? y : y + 22)
        if (!bare) { g.fillStyle = '#9aa3b2'; g.font = '13px Segoe UI, sans-serif'; g.fillText(n, x + 10, y + 16) }
      })
    } catch (e) {
      log.push(String(e))
    }
    if (bare) (window as unknown as { __labPng: string }).__labPng = cv.toDataURL('image/png')
    ;(window as unknown as { __labDone: string }).__labDone = JSON.stringify(log)
    })()
  }, [])
  return <canvas ref={ref} style={{ display: 'block' }} />
}
