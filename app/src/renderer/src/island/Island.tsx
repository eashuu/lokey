import { useCallback, useEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { hitProps, reset as resetHit } from '@/lib/hit'
import { animSpeed } from '@/lib/motion'
import { buildPath } from './shapePath'
import { MENU_BASE, MORPH, NOTCH_BASE, morphKind, paramsFor, peekParams, type Shape, type View } from './shapes'
import { MenuContent } from './Panel'
import { Caption } from './Caption'
import { Held } from './Held'
import { PeekRow } from './Peek'
import { Soul } from './Soul'
import { useIsland } from './store'

/**
 * The island: one path (shapePath.ts) animated from five numbers, drawn as the fill and reused as the clip for
 * the content. States and timings follow docs/UI-SPEC.md; nothing here uses springs.
 */
export function Island() {
  const shape = useIsland(s => s.shape)
  const view = useIsland(s => s.view)
  const mode = useIsland(s => s.mode)
  const peek = useIsland(s => s.peek)
  const soulMode = useIsland(s => s.soul)
  const heldPhase = useIsland(s => s.heldPhase)
  const isl = useData(s => s.settings.island)
  const scale = useData(s => s.settings.appearance.scale)
  const k = scale * isl.size

  const [size, setSize] = useState({ w: innerWidth, h: innerHeight })
  useEffect(() => {
    const on = () => setSize({ w: innerWidth, h: innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const cx = size.w / 2

  const start = paramsFor(isl.rest, view, k)
  const depth = useMotionValue(start.depth)
  const width = useMotionValue(start.width)
  const corner = useMotionValue(start.corner)
  const rampW = useMotionValue(start.rampW)
  const rampH = useMotionValue(start.rampH)
  const path = useTransform([depth, width, corner, rampW, rampH], ([d, w, c, rw, rh]: number[]) =>
    buildPath({ depth: d, width: w, corner: c, rampW: rw, rampH: rh }, cx))
  const clip = useTransform(path, p => `path("${p}")`)

  // ---- morph whenever the target shape changes ------------------------------------------------------
  const prev = useRef<{ shape: Shape; view: View }>({ shape: isl.rest, view })
  const peeking = !!peek && shape !== 'menu'
  useEffect(() => {
    const next = { shape: peeking ? ('awake' as Shape) : shape, view }
    const kind = peeking ? 'notch' : morphKind(prev.current, next)
    prev.current = next
    const p = peeking ? peekParams(k) : paramsFor(shape, view, k)
    const m = MORPH[kind]
    const speed = animSpeed()
    const duration = speed <= 0 ? 0 : m.duration / speed
    const ctl = ([[depth, p.depth], [width, p.width], [corner, p.corner], [rampW, p.rampW], [rampH, p.rampH]] as const)
      .map(([mv, to]) => animate(mv, to, { duration, ease: m.ease }))
    return () => ctl.forEach(c => c.stop())
  }, [shape, view, peeking, k, depth, width, corner, rampW, rampH])

  // ---- mounted menu content (kept alive while the shape closes) -------------------------------------
  const [mount, setMount] = useState(shape === 'menu')
  const [shown, setShown] = useState<View>(view)
  useEffect(() => {
    if (shape === 'menu') { setMount(true); setShown(view); return }
    const t = setTimeout(() => setMount(false), 520)
    return () => clearTimeout(t)
  }, [shape, view])

  // ---- triggers -------------------------------------------------------------------------------------
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastWheel = useRef(0)
  const cancel = () => clearTimeout(timer.current)
  const st = () => useIsland.getState()

  const onEnter = useCallback(() => {
    hitProps.onPointerEnter()
    cancel()
    if (isl.trigger !== 'scroll' && st().shape === 'sleep') timer.current = setTimeout(() => st().wake('hover'), isl.hoverDelayMs)
  }, [isl.trigger, isl.hoverDelayMs])

  const onLeave = useCallback(() => {
    hitProps.onPointerLeave()
    cancel()
    const s = st()
    if (s.mode !== 'hover') return
    if (s.shape === 'menu') timer.current = setTimeout(() => st().closeMenu(), isl.closeDelayMs)
    else if (s.shape === 'awake' && s.rest === 'sleep') timer.current = setTimeout(() => st().sleep(), isl.closeDelayMs)
  }, [isl.closeDelayMs])

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (isl.trigger === 'hover' || !isl.scrollToOpen) return
    const now = performance.now()
    if (now - lastWheel.current < 380) return
    const s = st()
    if (e.deltaY > 0) {
      lastWheel.current = now
      if (s.shape !== 'menu') s.openMenu('music', 'hover')
      else if (s.view === 'music') s.setView(isl.startTab)
    } else if (e.deltaY < 0 && s.shape === 'menu' && s.view === isl.startTab) {
      lastWheel.current = now
      s.setView('music')
    }
  }, [isl.trigger, isl.scrollToOpen, isl.startTab])

  const onClick = useCallback(() => {
    const s = st()
    if (s.shape !== 'menu') s.openMenu(isl.startTab, 'pinned')
    else if (s.mode === 'hover') useIsland.setState({ mode: 'pinned' })
  }, [isl.startTab])

  useEffect(() => { bridge.setFocusable(shape === 'menu' && mode === 'pinned') }, [shape, mode])
  useEffect(() => { useIsland.getState().setRest(isl.rest) }, [isl.rest])
  useEffect(() => () => cancel(), [])

  useEffect(() => bridge.onApp(e => {
    const s = st()
    if (e.type === 'toggle-island') { if (s.shape === 'menu') s.closeMenu(); else s.openMenu(isl.startTab, 'pinned') }
    else if (e.type === 'open-island') s.openMenu(e.tab ?? isl.startTab, 'pinned')
    else if (e.type === 'close-island') { if (s.shape === 'menu') s.closeMenu(); else if (s.shape === 'awake' && s.rest === 'sleep') s.sleep() }
    else if (e.type === 'blur') { if (s.shape === 'menu' && s.mode === 'pinned') s.closeMenu(); resetHit() }
    else if (e.type === 'fullscreen' && e.full) { if (s.shape === 'menu') s.closeMenu(); resetHit() }
  }), [isl.startTab])

  // ---- layout ---------------------------------------------------------------------------------------
  const notchK = NOTCH_BASE * k
  const soulW = 210 * notchK
  const soulH = 74 * notchK
  const soulY = useTransform(depth, d => d - soulH)
  const soulOn = shape === 'awake' && !peeking
  const inMenu = shape === 'menu'
  const peekP = peekParams(k)
  const heldP = paramsFor('held', view, k)
  const menuW = paramsFor('menu', shown, k).width

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <svg width={size.w} height={size.h} viewBox={`0 -4 ${size.w} ${size.h}`} style={{ position: 'absolute', left: 0, top: -4, overflow: 'visible', filter: inMenu ? 'none' : 'drop-shadow(0 6px 14px rgba(0,0,0,.35))' }} aria-hidden>
        <defs>
          <linearGradient id="lk-glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#101012" />
            <stop offset="1" stopColor="#000000" />
          </linearGradient>
        </defs>
        <motion.path d={path} fill={inMenu ? 'var(--panel)' : 'url(#lk-glass)'} stroke={inMenu ? 'rgba(255,255,255,.10)' : 'none'} strokeWidth={1} />
      </svg>

      <motion.div
        data-hit
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onWheel={onWheel}
        onClick={onClick}
        style={{ position: 'absolute', inset: 0, clipPath: clip, pointerEvents: 'auto' }}
      >
        {peeking && peek && (
          <div style={{ position: 'absolute', top: 0, left: cx - peekP.width / 2, width: peekP.width, height: peekP.depth }}>
            <PeekRow peek={peek} />
          </div>
        )}
        {shape === 'held' && (
          <div style={{ position: 'absolute', top: 0, left: cx - heldP.width / 2, width: heldP.width, height: heldP.depth }}>
            <Held width={heldP.width} height={heldP.depth} phase={heldPhase} />
          </div>
        )}
        {mount && (
          // content is invisible while the shape grows into place, then fades in; on close it fades out first
          <motion.div key={shown} initial={{ opacity: 0 }} animate={{ opacity: inMenu ? 1 : 0 }} transition={{ duration: inMenu ? 0.26 : 0.18, delay: inMenu ? 0.1 : 0, ease: 'linear' }} style={{ position: 'absolute', inset: 0 }}>
            <MenuContent view={shown} scale={MENU_BASE * k} left={cx - menuW / 2} />
          </motion.div>
        )}
      </motion.div>

      <Caption top={(NOTCH_BASE * 75 + 26) * k} scale={k} />

      <motion.div style={{ position: 'absolute', left: cx - soulW / 2, top: 0, y: soulY, width: soulW, height: soulH, opacity: soulOn ? 1 : 0, transition: 'opacity 300ms linear', pointerEvents: 'none' }}>
        <Soul width={soulW} height={soulH} mode={soulMode} active={soulOn} />
      </motion.div>
    </div>
  )
}
