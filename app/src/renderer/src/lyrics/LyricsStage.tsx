import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { DOT, Spring, WORD, activeItem, buildTimeline, type TItem } from '@shared/lyricsAnim'

// The animated lyrics. React draws the structure once per song; one requestAnimationFrame loop then writes styles straight to
// the elements (no re-render per frame):
//  - the line being sung is full brightness and a touch larger; others dim and blur with distance
//  - each word of the active line is lit by a soft gradient sweep as it is sung (--gp), swells, floats and glows (springs)
//  - three dots pulse through instrumental breaks and the intro
//  - the whole column is carried to keep the active line near the upper third, with a spring; the wheel scrolls it by hand
const LIFT_EM = 6 // the keyframe lift is tiny (in em); amplified so the float is visible
type WordRef = { el: HTMLElement; t0: number; t1: number; s: Spring; y: Spring; g: Spring }
type DotRef = { el: HTMLElement; s: Spring; y: Spring; g: Spring; o: Spring }
type LineRef = { el: HTMLElement; item: TItem; words: WordRef[]; dots: DotRef[]; state: '' | 'ns' | 'act' | 'sung' }

export interface StageProps {
  lines: { t: number; text: string }[]
  durationMs: number
  /** playback position in ms (called every frame) */
  getPos: () => number
  /** timing nudge in ms (positive = lyrics later) */
  offsetMs: number
  reduced: boolean
  onSeek: (ms: number) => void
}

export function LyricsStage({ lines, durationMs, getPos, offsetMs, reduced, onSeek }: StageProps) {
  const items = useMemo(() => buildTimeline(lines, durationMs), [lines, durationMs])
  const stage = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const refs = useRef<LineRef[]>([])
  const live = useRef({ getPos, offsetMs, reduced })
  live.current = { getPos, offsetMs, reduced }

  // gather the elements once the structure exists
  useLayoutEffect(() => {
    const tr = track.current
    if (!tr) return
    refs.current = items.map((item, i) => {
      const el = tr.children[i] as HTMLElement
      if (item.kind === 'line') {
        const words = [...el.querySelectorAll<HTMLElement>('.wd')].map((w, k) => ({
          el: w, t0: item.words[k].t0, t1: item.words[k].t1,
          s: new Spring(WORD.scale(0), ...WORD.spring.scale), y: new Spring(WORD.lift(0), ...WORD.spring.lift), g: new Spring(0, ...WORD.spring.glow),
        }))
        return { el, item, words, dots: [], state: '' }
      }
      const dots = [...el.querySelectorAll<HTMLElement>('.dt')].map(d => ({ el: d, s: new Spring(DOT.scale(0), 0.7, 0.6), y: new Spring(0, 1.25, 0.4), g: new Spring(0, 1, 0.5), o: new Spring(DOT.fade(0), 1, 0.5) }))
      return { el, item, words: [], dots, state: '' }
    })
  }, [items])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const scroll = new Spring(0, 1.7, 0.92)
    const manual = new Spring(0, 2.2, 1)
    let manualUntil = 0
    let lastActive = -2
    let sizeH = 600
    const ro = new ResizeObserver(() => { sizeH = stage.current?.clientHeight ?? sizeH })
    if (stage.current) { ro.observe(stage.current); sizeH = stage.current.clientHeight }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      manual.target = Math.max(-4000, Math.min(4000, manual.target - e.deltaY))
      manualUntil = performance.now() + 3200
    }
    stage.current?.addEventListener('wheel', onWheel, { passive: false })

    const writeWord = (w: WordRef, state: 'ns' | 'act' | 'sung', p: number, dt: number, snap: boolean) => {
      const q = state === 'act' ? p : state === 'sung' ? 1 : 0
      w.s.target = WORD.scale(q); w.y.target = WORD.lift(q); w.g.target = WORD.glow(q)
      if (snap) { w.s.snap(w.s.target); w.y.snap(w.y.target); w.g.snap(w.g.target) } else { w.s.step(dt); w.y.step(dt); w.g.step(dt) }
      const gp = state === 'ns' ? -20 : state === 'sung' ? 100 : -20 + 120 * p
      const st = w.el.style
      st.setProperty('--gp', gp.toFixed(1))
      st.transform = live.current.reduced ? '' : `translate3d(0, ${(w.y.x * LIFT_EM).toFixed(4)}em, 0) scale(${w.s.x.toFixed(4)})`
      const g = Math.max(0, w.g.x)
      st.textShadow = g > 0.02 && !live.current.reduced ? `0 0 ${(4 + 2 * g).toFixed(1)}px rgba(255,255,255,${Math.min(g * 0.35, 1).toFixed(3)})` : ''
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const R = refs.current
      if (!R.length) return
      const t = live.current.getPos() + live.current.offsetMs
      const a = activeItem(items, t)
      const jumped = Math.abs(a - lastActive) > 2 // a seek: settle everything at once instead of animating across the song
      lastActive = a

      for (let i = 0; i < R.length; i++) {
        const near = jumped || Math.abs(i - a) <= 3
        const r = R[i]
        const it = r.item
        const state: 'ns' | 'act' | 'sung' = t < it.t0 ? 'ns' : t >= it.t1 ? 'sung' : 'act'
        if (r.state !== state) {
          r.el.classList.remove('ns', 'act', 'sung'); r.el.classList.add(state); r.state = state
        }
        const d = Math.abs(i - a)
        if (r.el.dataset.d !== String(Math.min(d, 6))) { r.el.dataset.d = String(Math.min(d, 6)); r.el.style.setProperty('--b', `${Math.min(d, 5.4) * 1.25}px`) }
        if (it.kind === 'line') {
          if (!near && !jumped) continue
          for (const w of r.words) {
            const ws = t < w.t0 ? 'ns' : t >= w.t1 ? 'sung' : 'act'
            writeWord(w, state === 'act' ? ws : state, (t - w.t0) / Math.max(1, w.t1 - w.t0), dt, jumped || state !== 'act' && Math.abs(i - a) > 2)
          }
        } else {
          const show = t >= it.t0 - 600 && t < it.t1 + 200
          r.el.classList.toggle('show', show)
          const span = Math.max(1, it.t1 - it.t0)
          r.dots.forEach((dt0, k) => {
            const p = Math.max(0, Math.min(1, ((t - it.t0) / span) * r.dots.length - k))
            const q = state === 'sung' ? 1 : state === 'ns' ? 0 : p
            dt0.s.target = DOT.scale(q); dt0.y.target = DOT.lift(q); dt0.g.target = DOT.glow(q); dt0.o.target = DOT.fade(q)
            if (jumped) { dt0.s.snap(dt0.s.target); dt0.y.snap(dt0.y.target); dt0.g.snap(dt0.g.target); dt0.o.snap(dt0.o.target) } else { dt0.s.step(dt); dt0.y.step(dt); dt0.g.step(dt); dt0.o.step(dt) }
            const st = dt0.el.style
            st.transform = `translate3d(0, ${(dt0.y.x * 1.6).toFixed(3)}em, 0) scale(${dt0.s.x.toFixed(3)})`
            st.opacity = Math.max(0.15, dt0.o.x).toFixed(3)
            st.boxShadow = dt0.g.x > 0.02 ? `0 0 ${(4 + 6 * dt0.g.x).toFixed(1)}px rgba(255,255,255,${Math.min(dt0.g.x * 0.9, 1).toFixed(2)})` : ''
          })
        }
      }

      // carry the column so the active line sits in the upper third
      const act = R[Math.max(0, a)]
      if (act) {
        scroll.target = sizeH * 0.33 - (act.el.offsetTop + act.el.offsetHeight / 2)
        if (jumped && lastActive >= 0) scroll.snap(scroll.target)
      }
      if (now > manualUntil && manual.target !== 0) manual.target = 0
      scroll.step(dt); manual.step(dt)
      if (track.current) track.current.style.transform = `translate3d(0, ${(scroll.x + manual.x).toFixed(1)}px, 0)`
    }
    raf = requestAnimationFrame(frame)
    const el = stage.current
    return () => { cancelAnimationFrame(raf); ro.disconnect(); el?.removeEventListener('wheel', onWheel) }
  }, [items])

  return (
    <div ref={stage} className="lw-stage">
      <div ref={track} className="lw-track">
        {items.map((it, i) =>
          it.kind === 'line' ? (
            <div key={i} className="ln ns" onClick={() => onSeek(Math.max(0, it.t0 - offsetMs))}>
              {it.words.map((w, k) => <span key={k} className="wd">{w.text}</span>)}
            </div>
          ) : (
            <div key={i} className="ln gap ns"><span className="dt" /><span className="dt" /><span className="dt" /></div>
          ),
        )}
        <div style={{ height: '60%' }} />
      </div>
    </div>
  )
}
