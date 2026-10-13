import { useEffect } from 'react'
import { Brain } from './brain'
import { MascotGL } from './gl'
import { SOUL_SKINS } from '@/island/skins'

// Animation reel for README art (`Lokey.exe --lab <dir> --lab-page reel --lab-query "names=wave,jump&size=360"`): the
// real Brain + Rig + shader, stepped at a fixed 24 fps. The main process pulls frames with window.__reel.frame(i)
// (transparent PNG data URLs) and encodes them. Each action plays to its end or `cap` seconds, whichever is first.
export function Reel() {
  useEffect(() => {
    void (async () => {
      const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
      const names = (q.get('names') ?? 'wave,jump,celebrate').split(',')
      const size = Number(q.get('size') ?? 360)
      const cap = Number(q.get('cap') ?? 2.6)
      const fps = 24
      const skin = SOUL_SKINS[q.get('skin') ?? 'puff']?.palette ?? SOUL_SKINS.puff.palette
      const cv = document.createElement('canvas')
      cv.width = cv.height = size
      const gl = new MascotGL(cv)
      gl.resize(size, size)
      while (!gl.ready()) await new Promise(r => setTimeout(r, 20))
      const brain = new Brain(() => undefined)
      brain.wake()
      const dt = 1 / fps
      let t = 0
      let idx = -1
      let since = 0
      let calls = 0
      const frame = (i: number): string => {
        calls++
        if (i === 0) { t = 0; idx = -1; since = 99 }
        // start the next action when the last one ended (or hit the cap)
        if (idx < names.length - 1 && (!brain.busy || since > cap)) {
          if (brain.busy) brain.cancel()
          idx++
          brain.play(names[idx])
          since = 0
        }
        const P = brain.update(dt, { mode: 'LISTENING', awake: true, music: false, calm: false, fidget: false })
        gl.draw(P, { top: skin.top, bottom: skin.bottom, glow: skin.glow, ink: skin.ink, foot: skin.foot ?? skin.bottom, form: skin.form ?? 0 }, t, 1, 1.08)
        t += dt
        since += dt
        return cv.toDataURL('image/png')
      }
      // lets the caller know how many frames the whole reel needs (each action capped, plus a settle second)
      const total = Math.round((names.length * cap + 1) * fps)
      ;(window as unknown as { __reel: unknown }).__reel = { frame, total, fps, calls: () => calls }
      ;(window as unknown as { __labDone: string }).__labDone = '[]'
    })()
  }, [])
  return null
}
