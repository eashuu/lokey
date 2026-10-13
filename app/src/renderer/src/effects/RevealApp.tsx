import { useEffect, useRef } from 'react'

const EASE = 'cubic-bezier(.215,.61,.355,1)'

/** Transient full-screen page: the new wallpaper grows as a circle from the click point (clip-path via WAAPI). */
export function RevealApp() {
  const root = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const fx = window.lokeyFx
    let dead = false
    fx?.onStart(async ({ src, x, y, ms }) => {
      const im = img.current, el = root.current
      if (!im || !el || dead) return
      im.src = src
      try { await im.decode() } catch { /* shown anyway */ }
      if (dead) return
      const w = window.innerWidth, h = window.innerHeight // the window covers the display; use the real viewport
      const r = Math.ceil(Math.hypot(Math.max(x, w - x), Math.max(y, h - y))) + 4
      const at = `at ${x}px ${y}px`
      im.style.clipPath = `circle(0px ${at})`
      fx.ready()
      // two frames so the (just shown) window has painted the empty state before the circle starts
      requestAnimationFrame(() => requestAnimationFrame(async () => {
        const grow = im.animate({ clipPath: [`circle(0px ${at})`, `circle(${r}px ${at})`] }, { duration: ms, easing: EASE, fill: 'forwards' })
        try { await grow.finished } catch { /* cancelled */ }
        // hold ~250 ms so the real wallpaper is in place, then fade out 150 ms
        await new Promise(res => setTimeout(res, 250))
        try { await el.animate({ opacity: [1, 0] }, { duration: 150, fill: 'forwards' }).finished } catch { /* ignore */ }
        fx.done()
      }))
    })
    return () => { dead = true }
  }, [])

  return (
    <div ref={root} style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'transparent' }}>
      <img ref={img} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', clipPath: 'circle(0px at 50% 50%)' }} />
    </div>
  )
}
