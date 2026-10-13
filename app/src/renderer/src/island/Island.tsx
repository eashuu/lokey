import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useMotionValue, useTransform } from 'motion/react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { hitProps, reset as resetHit } from '@/lib/hit'
import { spring } from '@/lib/motion'
import { Pill, PILL_H_REM, PILL_W_REM, PEEK_W_REM } from './Pill'
import { Panel } from './Panel'
import { useIsland } from './store'

export const PANEL_W_REM = 36
export const MAX_H_REM = 27
const RADIUS_REM = 1.75
const EAR_REM = 1.25

function rem() { return parseFloat(getComputedStyle(document.documentElement).fontSize) }

/**
 * The island. The panel is laid out ONCE at its final size and revealed by animating clip-path, so no layout runs
 * per frame. Two springs (width, height) drive a clip-path inset; the fillet "ears" follow width via transform.
 */
export function Island() {
  const open = useIsland(s => s.open)
  const mode = useIsland(s => s.mode)
  const peek = useIsland(s => s.peek)
  const settings = useData(s => s.settings.island)
  const scale = useData(s => s.settings.appearance.scale)

  const [panelH, setPanelH] = useState(0)
  const px = useMemo(() => rem(), [scale]) // eslint-disable-line react-hooks/exhaustive-deps
  const panelW = PANEL_W_REM * px, maxH = MAX_H_REM * px, radius = RADIUS_REM * px, ear = EAR_REM * px
  const pillW = PILL_W_REM * px, pillH = PILL_H_REM * px, peekW = PEEK_W_REM * px

  const w = useMotionValue(pillW)
  const h = useMotionValue(pillH)
  const clip = useTransform([w, h], ([cw, ch]: number[]) => {
    const side = Math.max(0, (panelW - cw) / 2)
    return `inset(0px ${side.toFixed(2)}px ${Math.max(0, maxH - ch).toFixed(2)}px ${side.toFixed(2)}px round 0px 0px ${radius}px ${radius}px)`
  })
  const leftEar = useTransform(w, cw => -cw / 2 - ear)
  const rightEar = useTransform(w, cw => cw / 2)

  // target size from state
  useEffect(() => {
    if (open && panelH > 0) { spring(w, panelW); spring(h, Math.min(maxH, panelH)) }
    else if (peek) { spring(w, peekW); spring(h, pillH + 0.25 * px, 'fast') }
    else { spring(w, pillW, open ? 'spatial' : 'spatial'); spring(h, pillH) }
  }, [open, peek, panelH, panelW, maxH, pillW, pillH, peekW, px, w, h])

  // ---- hover / wheel / click triggers --------------------------------------------------------------
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const clear = () => { clearTimeout(timer.current) }
  const { openIsland, closeIsland } = useIsland.getState()

  const onEnter = useCallback(() => {
    hitProps.onPointerEnter()
    clear()
    const s = useIsland.getState()
    if (!s.open && settings.openOnHover) timer.current = setTimeout(() => openIsland('hover'), settings.hoverDelayMs)
  }, [settings.openOnHover, settings.hoverDelayMs, openIsland])

  const onLeave = useCallback(() => {
    hitProps.onPointerLeave()
    clear()
    const s = useIsland.getState()
    if (s.open && s.mode === 'hover') timer.current = setTimeout(() => closeIsland(), settings.closeDelayMs)
  }, [settings.closeDelayMs, closeIsland])

  const onWheel = useCallback((e: React.WheelEvent) => {
    const s = useIsland.getState()
    if (!s.open && e.deltaY > 0 && settings.scrollToOpen) openIsland('hover')
  }, [settings.scrollToOpen, openIsland])

  const onClickPill = useCallback(() => {
    const s = useIsland.getState()
    if (!s.open) openIsland('pinned')
    else if (s.mode === 'hover') useIsland.setState({ mode: 'pinned' })
  }, [openIsland])

  // pinned islands take keyboard focus (Esc, search); hover islands never steal focus
  useEffect(() => {
    bridge.setFocusable(open && mode === 'pinned')
    if (!open) clear()
  }, [open, mode])

  // app events from main
  useEffect(() => bridge.onApp(e => {
    const s = useIsland.getState()
    if (e.type === 'toggle-island') (s.open ? closeIsland : () => openIsland('pinned'))()
    else if (e.type === 'open-island') openIsland('pinned', e.tab)
    else if (e.type === 'close-island') closeIsland()
    else if (e.type === 'blur') { if (s.open && s.mode === 'pinned') closeIsland(); resetHit() }
    else if (e.type === 'fullscreen' && e.full) { closeIsland(); resetHit() }
  }), [openIsland, closeIsland])

  useLayoutEffect(() => { w.jump(pillW); h.jump(pillH) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: 'absolute', top: 0, left: '50%', width: panelW, height: maxH, marginLeft: -panelW / 2, pointerEvents: 'none' }}>
      <motion.div
        data-hit
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onWheel={onWheel}
        style={{ position: 'absolute', inset: 0, clipPath: clip, background: 'var(--bg)', pointerEvents: 'auto', willChange: 'clip-path' }}
      >
        <div onClick={onClickPill} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: pillH, display: 'flex', justifyContent: 'center', pointerEvents: open ? 'none' : 'auto' }}>
          <Pill visible={!open} />
        </div>
        <Panel open={open} onHeight={setPanelH} />
      </motion.div>
      <Ear side="left" x={leftEar} size={ear} />
      <Ear side="right" x={rightEar} size={ear} />
    </div>
  )
}

/** Concave fillet joining the island to the screen's top edge. */
function Ear({ side, x, size }: { side: 'left' | 'right'; x: ReturnType<typeof useTransform<number, number>>; size: number }) {
  const at = side === 'left' ? '0 100%' : '100% 100%'
  return (
    <motion.div
      aria-hidden
      style={{
        position: 'absolute', top: 0, left: '50%', width: size, height: size, x,
        background: `radial-gradient(circle at ${at}, transparent ${size - 0.5}px, var(--bg) ${size}px)`,
        pointerEvents: 'none',
      }}
    />
  )
}

