import { useEffect } from 'react'
import { bridge } from '@/bridge'
import { isSide, nearestEdge, type Edge } from '@shared/placement'
import { usePlace } from './place'

// Moving the island. The overlay window covers the whole display while this is shown and the island itself is hidden; a ghost
// follows the pointer and snaps to the nearest screen edge, or to a corner when the pointer is close to one.
//  hold: the move chord (default Win+Shift) is held; the main process sends the pointer position and drops the island when the
//        chord is released. No mouse button is involved, so nothing can lose a click.
//  pick: started from the tray or Settings; click where the island should go (Esc or right click cancels).
export function PlaceEditor() {
  const mode = usePlace(s => s.place.editing)
  const pt = usePlace(s => s.cursor)
  const W = innerWidth, H = innerHeight

  useEffect(() => {
    bridge.setRegion([{ x: 0, y: 0, w: W, h: H }]) // the whole screen belongs to us until the island is dropped
  }, [W, H])

  const here = mode === 'pick' ? pick(pt, W, H) : pick(pt, W, H)
  return (
    <div
      onPointerMove={e => { if (mode === 'pick') usePlace.setState({ cursor: { x: e.clientX, y: e.clientY } }) }}
      onPointerDown={e => {
        if (mode !== 'pick') return
        if (e.button === 0) { const n = nearestEdge({ x: 0, y: 0, w: W, h: H }, e.clientX, e.clientY); bridge.place.commit(n.edge, n.offset) }
        else if (e.button === 2) bridge.place.cancel()
      }}
      onContextMenu={e => e.preventDefault()}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', cursor: 'grabbing', background: 'rgba(8,12,22,.32)', fontFamily: 'var(--font-island)' }}
    >
      {(['top', 'bottom', 'left', 'right'] as Edge[]).map(e => <EdgeGuide key={e} edge={e} on={here?.edge === e} />)}
      {here && <Ghost edge={here.edge} offset={here.offset} W={W} H={H} />}
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', padding: '10px 18px', borderRadius: 18, background: '#0a0a0b', color: '#fff', fontSize: 13, fontWeight: 500, boxShadow: '0 10px 24px -8px rgba(0,0,0,.55), inset 0 0 0 1px rgba(255,255,255,.1)', pointerEvents: 'none', opacity: pt ? 0 : 1, transition: 'opacity .2s' }}>
        {mode === 'pick' ? 'Click where the island should live (near a corner for a corner) · Esc to cancel' : 'Move the pointer to an edge or corner · let go of the keys to drop it'}
      </div>
    </div>
  )
}

function pick(pt: { x: number; y: number } | null, W: number, H: number) { return pt ? nearestEdge({ x: 0, y: 0, w: W, h: H }, pt.x, pt.y) : null }

function EdgeGuide({ edge, on }: { edge: Edge; on: boolean }) {
  const t = 5
  const pos = edge === 'top' ? { left: 0, right: 0, top: 0, height: t } : edge === 'bottom' ? { left: 0, right: 0, bottom: 0, height: t } : edge === 'left' ? { top: 0, bottom: 0, left: 0, width: t } : { top: 0, bottom: 0, right: 0, width: t }
  return <div style={{ position: 'absolute', ...pos, background: 'var(--accent, #62b6ff)', opacity: on ? 0.95 : 0.18, boxShadow: on ? '0 0 22px var(--accent, #62b6ff)' : 'none', transition: 'opacity .15s' }} />
}

function Ghost({ edge, offset, W, H }: { edge: Edge; offset: number; W: number; H: number }) {
  const len = 170, th = 14
  const side = isSide(edge)
  const L = side ? H : W
  // a corner is flush with the screen corner; anywhere else keeps a small margin
  const along = offset <= 0 ? len / 2 : offset >= 1 ? L - len / 2 : Math.max(len / 2 + 6, Math.min(L - len / 2 - 6, offset * L))
  const style = side
    ? { top: along - len / 2, width: th, height: len, ...(edge === 'left' ? { left: 0, borderRadius: '0 9px 9px 0' } : { right: 0, borderRadius: '9px 0 0 9px' }) }
    : { left: along - len / 2, width: len, height: th, ...(edge === 'top' ? { top: 0, borderRadius: '0 0 9px 9px' } : { bottom: 0, borderRadius: '9px 9px 0 0' }) }
  return (
    <>
      {(offset <= 0 || offset >= 1) && <CornerMark edge={edge} offset={offset} />}
      <div style={{ position: 'absolute', background: '#050506', boxShadow: '0 0 0 1.5px var(--accent, #62b6ff), 0 8px 24px rgba(0,0,0,.5)', transition: 'left .06s linear, top .06s linear', ...style }} />
    </>
  )
}

/** a quarter-circle glow in the corner the island will snap into */
function CornerMark({ edge, offset }: { edge: Edge; offset: number }) {
  const start = offset <= 0
  const left = edge === 'left' || (!isSide(edge) && start), top = edge === 'top' || (isSide(edge) && start)
  return <div style={{ position: 'absolute', width: 120, height: 120, [left ? 'left' : 'right']: 0, [top ? 'top' : 'bottom']: 0, background: `radial-gradient(circle at ${left ? '0%' : '100%'} ${top ? '0%' : '100%'}, color-mix(in srgb, var(--accent, #62b6ff) 55%, transparent), transparent 70%)`, pointerEvents: 'none' }} />
}
