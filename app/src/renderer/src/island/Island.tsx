import { useCallback, useEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { setRegion } from '@/lib/region'
import { animSpeed } from '@/lib/motion'
import { buildPath } from './shapePath'
import { reactToPoke } from './reactions'
import { MENU_BASE, MORPH, NOTCH_BASE, morphKind, paramsFor, peekParams, type Shape, type View } from './shapes'
import { MenuContent } from './Panel'
import { Caption } from './Caption'
import { Held } from './Held'
import { PeekRow } from './Peek'
import { Soul } from './Soul'
import { skinPalette } from './skins'
import { useIsland } from './store'
import { usePlace } from './place'
import { PlaceEditor } from './PlaceEditor'
import { isSide, mapPath, mapRect, type Placement } from '@shared/placement'
import type { ShapeParams } from './shapePath'

/**
 * The island: one path (shapePath.ts) animated from five numbers, drawn as the fill and reused as the clip for
 * the content. States and timings follow the design spec; nothing here uses springs.
 */
// exposed for the injected-event UI test (`--uitest`)
;(window as unknown as { __island: typeof useIsland }).__island = useIsland

/** the hit region must stay inside the window (a corner placement pushes the outer ramp past the screen edge) */
const clipRect = (r: { x: number; y: number; w: number; h: number }, W: number, H: number) => {
  const x = Math.max(0, r.x), y = Math.max(0, r.y)
  return { x, y, w: Math.max(1, Math.min(W, r.x + r.w) - x), h: Math.max(1, Math.min(H, r.y + r.h) - y) }
}

export function Island() {
  const shape = useIsland(s => s.shape)
  const view = useIsland(s => s.view)
  const mode = useIsland(s => s.mode)
  const peek = useIsland(s => s.peek)
  const soulMode = useIsland(s => s.soul)
  const heldPhase = useIsland(s => s.heldPhase)
  const isl = useData(s => s.settings.island)
  const skin = useData(s => s.settings.loadout?.soul)
  const scale = useData(s => s.settings.appearance.scale)
  const k = scale * isl.size

  const [size, setSize] = useState({ w: innerWidth, h: innerHeight })
  useEffect(() => {
    const on = () => setSize({ w: innerWidth, h: innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  // ---- placement: the island hangs from any screen edge. Everything is built as if from the top edge (u along, v deep) and mapped ----
  const place = usePlace(s => s.place)
  const edge = place.edge
  const side = isSide(edge)
  const pl: Placement = { edge, along: place.along, w: size.w, h: size.h }
  const plRef = useRef(pl)
  plRef.current = pl
  const L = side ? size.h : size.w
  /** on the side edges the awake/held/peek pills swap their two sizes (the content inside stays upright); the sleeping sliver just turns */
  const frameOf = (p: ShapeParams, sh: Shape): ShapeParams => (side && sh !== 'sleep' ? { ...p, depth: p.width, width: p.depth } : p)
  // in a corner (along = 0 or the far end) the body sits flush against the screen corner; elsewhere it keeps a small margin from the ends
  const atStart = place.along <= 1, atEnd = place.along >= L - 1
  const clampAlong = (p: ShapeParams) => {
    const half = p.width / 2, m = atStart || atEnd ? 0 : p.rampW + 8
    return atStart ? half : atEnd ? L - half : Math.max(half + m, Math.min(L - half - m, place.along))
  }

  const hair = isl.sleepLook === 'hairline'
  const peeking = !!peek && shape !== 'menu'
  const target = frameOf(peeking ? peekParams(k) : paramsFor(shape, view, k, hair), peeking ? 'awake' : shape)
  const start = frameOf(paramsFor(isl.rest, view, k, hair), isl.rest)
  const depth = useMotionValue(start.depth)
  const width = useMotionValue(start.width)
  const corner = useMotionValue(start.corner)
  const rampW = useMotionValue(start.rampW)
  const rampH = useMotionValue(start.rampH)
  const alongMV = useMotionValue(clampAlong(start))
  const tick = useMotionValue(0)
  const path = useTransform([depth, width, corner, rampW, rampH, alongMV, tick], ([d, w, c, rw, rh, a]: number[]) =>
    mapPath(buildPath({ depth: d, width: w, corner: c, rampW: rw, rampH: rh }, a), plRef.current))
  const clip = useTransform(path, p => `path("${p}")`)

  // moved to another edge / window resized: jump (the slide-in below covers it), and redraw the outline for the new mapping
  useEffect(() => { alongMV.set(clampAlong(target)); tick.set(tick.get() + 1) }, [edge, place.along, size.w, size.h]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- morph whenever the target shape changes ------------------------------------------------------
  const prev = useRef<{ shape: Shape; view: View }>({ shape: isl.rest, view })
  useEffect(() => {
    const next = { shape: peeking ? ('awake' as Shape) : shape, view }
    const kind = peeking ? 'notch' : morphKind(prev.current, next)
    prev.current = next
    const p = target
    const m = MORPH[kind]
    const speed = animSpeed()
    const duration = speed <= 0 ? 0 : m.duration / speed
    const ctl = ([[depth, p.depth], [width, p.width], [corner, p.corner], [rampW, p.rampW], [rampH, p.rampH], [alongMV, clampAlong(p)]] as const)
      .map(([mv, to]) => animate(mv, to, { duration, ease: m.ease }))
    return () => ctl.forEach(c => c.stop())
  }, [shape, view, peeking, k, hair, edge, depth, width, corner, rampW, rampH]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- window region: the overlay is shaped to the island so the rest of the screen belongs to other apps ----
  const caption = useIsland(s => s.caption)
  useEffect(() => {
    if (place.editing) return // the editor owns the region (the whole display) while the island is being moved (the whole display) while the island is being moved
    const p = target
    // a sleeping island only owns the pixels it draws: the shadow margin of an open menu would block clicks on whatever sits under it (browser tab strips)
    const m = (!peeking && shape === 'sleep' ? 2 : !peeking && shape === 'awake' ? 10 : 26) * k // room for the drop shadow (fully faded before the region edge) and the ramps' anti-aliasing
    const along = clampAlong(p)
    const extAlong = p.width + 2 * (p.rampW + m)
    const rect = clipRect(mapRect(pl, along - extAlong / 2, 0, extAlong, p.depth + m), size.w, size.h)
    const more = caption && edge === 'top' ? [{ x: along - 320 * k, y: 0, w: 640 * k, h: (NOTCH_BASE * 75 + 26 + 90) * k }] : []
    const kind = peeking ? 'notch' : morphKind(prev.current, { shape, view })
    setRegion(rect, (MORPH[kind].duration / Math.max(0.1, animSpeed() || 1)) * 1000, more)
  }, [shape, view, peeking, k, caption, hair, edge, place.along, place.editing, size.w, size.h, atStart, atEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- mounted menu content (kept alive while the shape closes) -------------------------------------
  const [mount, setMount] = useState(shape === 'menu')
  const shownRef = useRef<View>(view)
  if (shape === 'menu') shownRef.current = view
  const shown = shownRef.current
  useEffect(() => {
    if (shape === 'menu') { setMount(true); return }
    const t = setTimeout(() => setMount(false), 360)
    return () => clearTimeout(t)
  }, [shape])

  // ---- triggers -------------------------------------------------------------------------------------
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const lastWheel = useRef(0)
  const cancel = () => clearTimeout(timer.current)
  const st = () => useIsland.getState()

  const onEnter = useCallback(() => {
    cancel()
    if (isl.trigger !== 'scroll' && isl.openOnHover && st().shape === 'sleep') timer.current = setTimeout(() => st().wake('hover'), isl.hoverDelayMs)
  }, [isl.trigger, isl.openOnHover, isl.hoverDelayMs])

  const onLeave = useCallback(() => {
    cancel()
    const s = st()
    if (s.mode !== 'hover') return
    if (s.shape === 'menu') timer.current = setTimeout(() => st().closeMenu(), isl.closeDelayMs)
    else if (s.shape === 'awake' && s.rest === 'sleep') timer.current = setTimeout(() => st().sleep(), isl.closeDelayMs)
  }, [isl.closeDelayMs])

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (isl.trigger === 'hover' || !isl.scrollToOpen) return
    // scrolling a list or a text box inside the menu is never a request to change view (scrolling up used to flip back to Music)
    if (st().shape === 'menu' && (e.target as Element | null)?.closest?.('.scroll-y, input, textarea, [data-noflip]')) return
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

  // Pressing the notch opens the menu (on press, not release: a lost mouse-up can never swallow it); it never pins.
  // Pinning (keyboard focus) is only for text fields. The click that follows finds the menu already open and does nothing.
  const onClick = useCallback(() => {
    const s = st()
    if (s.shape !== 'menu') s.openMenu(isl.startTab, 'hover')
  }, [isl.startTab])
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    reactToPoke()
    cancel()
    const s = st()
    if (s.shape !== 'menu') s.openMenu(isl.startTab, 'hover')
  }, [isl.startTab])

  useEffect(() => { bridge.setFocusable(shape === 'menu' && mode === 'pinned') }, [shape, mode])
  useEffect(() => { useIsland.getState().setRest(isl.rest) }, [isl.rest])
  useEffect(() => () => cancel(), [])

  useEffect(() => bridge.on('foreground.changed', () => {
    const s = st()
    if (s.shape === 'menu' && s.mode === 'pinned') setTimeout(() => { const t = st(); if (t.shape === 'menu' && t.mode === 'pinned') t.closeMenu() }, 150)
  }), [])

  useEffect(() => bridge.onApp(e => {
    const s = st()
    if (e.type === 'toggle-island') { if (s.shape === 'menu') s.closeMenu(); else s.openMenu(isl.startTab, 'pinned') }
    else if (e.type === 'open-island') {
      const tab = e.tab ?? isl.startTab
      if (e.toggle && s.shape === 'menu' && s.view === tab) s.closeMenu() // the same shortcut again closes it
      else s.openMenu(tab, 'pinned')
    }
    else if (e.type === 'close-island') { if (s.shape === 'menu') s.closeMenu(); else if (s.shape === 'awake' && s.rest === 'sleep') s.sleep() }
    else if (e.type === 'blur') { if (s.shape === 'menu' && s.mode === 'pinned') s.closeMenu() }
    else if (e.type === 'fullscreen' && e.full) { if (s.shape === 'menu') s.closeMenu() }
  }), [isl.startTab])

  // ---- layout ---------------------------------------------------------------------------------------
  const notchK = NOTCH_BASE * k
  const soulW = 210 * notchK
  const soulH = 74 * notchK
  // the mascot rides the far end of the awake pill, whichever edge that is
  const soulLeft = useTransform([depth, alongMV], ([d, a]: number[]) => (side ? (edge === 'left' ? d - soulW : size.w - d) : a - soulW / 2))
  const soulTop = useTransform([depth, alongMV], ([d, a]: number[]) => (edge === 'top' ? d - soulH : edge === 'bottom' ? size.h - d : a - soulH / 2))
  const soulOn = shape === 'awake' && !peeking
  const inMenu = shape === 'menu'
  const upright = (p: ShapeParams, sh: Shape) => { const f = frameOf(p, sh); const a = clampAlong(f); return mapRect(pl, a - f.width / 2, 0, f.width, f.depth) }
  const peekRect = upright(peekParams(k), 'awake')
  const heldRect = upright(paramsFor('held', view, k), 'held')
  const menuRect = upright(paramsFor('menu', shown, k), 'menu')
  const shadow = edge === 'top' ? '0 4px 9px' : edge === 'bottom' ? '0 -4px 9px' : edge === 'left' ? '4px 0 9px' : '-4px 0 9px'
  const slide = { top: { x: 0, y: -26 }, bottom: { x: 0, y: 26 }, left: { x: -26, y: 0 }, right: { x: 26, y: 0 } }[edge]

  if (place.editing) return <PlaceEditor />

  return (
    <motion.div key={edge} initial={{ opacity: 0, ...slide }} animate={{ opacity: 1, x: 0, y: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <svg width={size.w + 8} height={size.h + 8} viewBox={`-4 -4 ${size.w + 8} ${size.h + 8}`} style={{ position: 'absolute', left: -4, top: -4, overflow: 'visible', filter: inMenu ? 'none' : `drop-shadow(${shadow} rgba(0,0,0,.30))` }} aria-hidden>
        <defs>
          <linearGradient id="lk-glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#101012" />
            <stop offset="1" stopColor="#000000" />
          </linearGradient>
        </defs>
        <motion.path d={path} fill="url(#lk-glass)" />
        <motion.path d={path} className={inMenu ? 'lk-panel-path on' : 'lk-panel-path'} strokeWidth={1} />
      </svg>

      <motion.div
        data-hit
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onClick={onClick}
        style={{ position: 'absolute', inset: 0, clipPath: clip, pointerEvents: 'auto' }}
      >
        {peeking && peek && (
          <div style={{ position: 'absolute', left: peekRect.x, top: peekRect.y, width: peekRect.w, height: peekRect.h }}>
            <PeekRow peek={peek} />
          </div>
        )}
        {shape === 'held' && (
          <div style={{ position: 'absolute', left: heldRect.x, top: heldRect.y, width: heldRect.w, height: heldRect.h }}>
            <Held width={heldRect.w} height={heldRect.h} phase={heldPhase} />
          </div>
        )}
        {mount && (
          // content appears together with the shape (no delay, no scale): a short fade only. The wrapper changes only
          // between the music island and the menu, so switching tabs never re-animates the frame or the tab bar.
          <motion.div
            key={shown === 'music' ? 'music' : 'menu'}
            initial={{ opacity: 0 }}
            animate={{ opacity: inMenu ? 1 : 0 }}
            transition={{ duration: inMenu ? 0.16 : 0.1, ease: 'linear' }}
            style={{ position: 'absolute', inset: 0 }}
          >
            <MenuContent view={shown} scale={MENU_BASE * k} left={menuRect.x} top={menuRect.y} />
          </motion.div>
        )}
      </motion.div>

      {edge === 'top' && <Caption top={(NOTCH_BASE * 75 + 26) * k} scale={k} />}

      <motion.div style={{ position: 'absolute', left: soulLeft, top: soulTop, width: soulW, height: soulH, opacity: soulOn ? 1 : 0, transition: 'opacity 300ms linear', pointerEvents: 'none' }}>
        <Soul width={soulW} height={soulH} mode={soulMode} active={soulOn} palette={skinPalette(skin)} />
      </motion.div>
    </motion.div>
  )
}
