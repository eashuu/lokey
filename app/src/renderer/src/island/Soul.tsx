import { useEffect, useRef, useState } from 'react'
import { Brain } from '@/mascot/brain'
import { mascot } from '@/mascot/bus'
import { Emotes } from '@/mascot/Emotes'
import { MascotGL } from '@/mascot/gl'
import { useData } from '@/lib/data'
import { DEFAULT_PALETTE, Soul2D, type SoulPalette } from './Soul2D'
import type { SoulMode } from './store'

export { DEFAULT_PALETTE }
export type { SoulPalette }

// The island's mascot. 3D (WebGL2 raymarched character, mascot/*) where possible, the flat 2D drawing otherwise
// (no WebGL2, shader failure, or too small to see the third dimension). The GL context only exists while `active`.

let glFailed = false

export interface SoulProps {
  width: number
  height: number
  mode: SoulMode
  active: boolean
  palette?: SoulPalette
  /** thumbnails: no emotes, no pointer tracking, no bus actions */
  quiet?: boolean
  /** world half-height of the view (bigger = smaller character); default fits the character with room for a jump */
  frame?: number
}

const to2d = (m: SoulMode) => (m === 'HEARING' ? 'LISTENING' : m === 'WRITING' || m === 'LOOKING' ? 'THINKING' : m)

export function Soul(props: SoulProps) {
  const [failed, setFailed] = useState(glFailed)
  if (failed || Math.min(props.width, props.height) < 18) return <Soul2D {...props} mode={to2d(props.mode)} />
  return <Soul3D {...props} onFail={() => { glFailed = true; setFailed(true) }} />
}

function Soul3D({ width, height, mode, active, palette = DEFAULT_PALETTE, quiet, frame, onFail }: SoulProps & { onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode
  const palRef = useRef(palette)
  palRef.current = palette
  const brain = useRef<Brain | null>(null)
  const music = useRef(false)
  const calm = useRef(false)
  const failRef = useRef(onFail)
  failRef.current = onFail

  useEffect(() => {
    const read = () => {
      const s = useData.getState()
      music.current = !!s.media?.hasSession && !!s.media.playing
      calm.current = !!s.settings.appearance.reduceMotion
    }
    read()
    return useData.subscribe(read)
  }, [])

  useEffect(() => {
    const el = host.current
    if (!el || !active) return
    let gl: MascotGL
    const cv = document.createElement('canvas')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    cv.style.cssText = `width:${width}px;height:${height}px;display:block;opacity:0;transition:opacity .18s linear`
    try {
      gl = new MascotGL(cv)
      gl.resize(Math.round(width * dpr), Math.round(height * dpr))
    } catch (e) {
      console.warn('3D mascot unavailable, using 2D:', e)
      failRef.current()
      return
    }
    el.appendChild(cv)
    const fr = frame ?? (Math.min(width, height) < 60 ? 0.9 : 1.08)
    const b = (brain.current ??= new Brain(k => { if (!quiet) mascot.emote(k) }))
    b.wake()
    const off = quiet ? () => undefined : mascot.on(e => { if (e.type === 'play') b.play(e.name) })

    // pointer -> eye contact (read in the loop, never measured per event)
    let px = NaN
    let py = NaN
    const onMove = (e: PointerEvent) => { px = e.clientX; py = e.clientY }
    const onLeave = () => { px = NaN; mascot.lookAway() }
    if (!quiet) { window.addEventListener('pointermove', onMove, { passive: true }); document.addEventListener('pointerleave', onLeave) }

    let raf = 0
    let last = 0
    let t0 = performance.now()
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 15) return // 60 fps cap on high-refresh displays
      try { if (!gl.ready()) return } catch (e) { console.warn('3D mascot unavailable, using 2D:', e); cancelAnimationFrame(raf); failRef.current(); return }
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
      last = now
      if (!quiet && px === px) {
        const r = el.getBoundingClientRect()
        mascot.look((px - (r.left + r.width / 2)) / Math.max(120, r.width * 0.9), -(py - (r.top + r.height * 0.55)) / Math.max(90, r.height * 1.2))
        px = NaN
      }
      const m = modeRef.current
      const P = b.update(dt, { mode: m, awake: m !== 'MUTED', music: music.current, calm: calm.current || !!quiet })
      const p = palRef.current
      gl.draw(P, { top: p.top, bottom: p.bottom, glow: p.glow, ink: p.ink, foot: p.foot ?? p.bottom, form: p.form ?? 0 }, (now - t0) / 1000, 1, fr)
      if (cv.style.opacity !== '1') cv.style.opacity = '1'
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      off()
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      gl.dispose()
      cv.remove()
    }
  }, [active, width, height, quiet, frame])

  return (
    <div style={{ position: 'relative', width, height }}>
      <div ref={host} style={{ width, height }} aria-hidden />
      {!quiet && active && <Emotes width={width} height={height} />}
    </div>
  )
}
