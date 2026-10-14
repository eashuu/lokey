// Where the island sits: on any edge of the screen, anywhere along it. Shared by the main process (where the overlay window goes)
// and the island (how its shape is drawn on that edge).
//
// Vocabulary: the island is always built as if it hung from the TOP edge: `u` runs along the edge, `v` into the screen. A
// placement maps (u, v) to the real window: top is identity, bottom mirrors v, left/right swap the axes. Menus and text are not
// rotated: only the outline is mapped, the content boxes are placed upright inside the mapped body.

export type Edge = 'top' | 'bottom' | 'left' | 'right'
export const EDGES: Edge[] = ['top', 'bottom', 'left', 'right']

export interface Placement {
  edge: Edge
  /** window pixels: where along the edge the island's centre is (x for top/bottom, y for left/right) */
  along: number
  /** overlay window size in px */
  w: number
  h: number
}

export interface Rect { x: number; y: number; w: number; h: number }

export const isSide = (e: Edge) => e === 'left' || e === 'right'

/** length of the edge direction for this placement */
export const alongLength = (p: Pick<Placement, 'edge' | 'w' | 'h'>) => (isSide(p.edge) ? p.h : p.w)

/** (u along, v depth) -> window coordinates */
export function mapPoint(p: Placement, u: number, v: number): { x: number; y: number } {
  switch (p.edge) {
    case 'top': return { x: u, y: v }
    case 'bottom': return { x: u, y: p.h - v }
    case 'left': return { x: v, y: u }
    case 'right': return { x: p.w - v, y: u }
  }
}

/** a rectangle given in the top frame (u0..u0+du along, v0..v0+dv deep) -> window rectangle */
export function mapRect(p: Placement, u0: number, v0: number, du: number, dv: number): Rect {
  switch (p.edge) {
    case 'top': return { x: u0, y: v0, w: du, h: dv }
    case 'bottom': return { x: u0, y: p.h - v0 - dv, w: du, h: dv }
    case 'left': return { x: v0, y: u0, w: dv, h: du }
    case 'right': return { x: p.w - v0 - dv, y: u0, w: dv, h: du }
  }
}

/** Rewrites an island outline (M/L/C/Z with absolute coordinates, built for the top edge with `cx` = the along coordinate) for this edge. */
export function mapPath(path: string, p: Placement): string {
  if (p.edge === 'top') return path
  const out: string[] = []
  for (const tok of path.split(/\s+/)) {
    out.push(tok)
  }
  // tokens: command letters and numbers; numbers come in (x y) pairs
  const res: string[] = []
  let pending: number | null = null
  for (const t of out) {
    if (/^[MLCZ]$/.test(t)) { res.push(t); pending = null; continue }
    const n = Number(t)
    if (pending === null) pending = n
    else { const q = mapPoint(p, pending, n); res.push(q.x.toFixed(2), q.y.toFixed(2)); pending = null }
  }
  return res.join(' ')
}

/**
 * The overlay window for a placement. `display` is the monitor in screen px, `size` the window size, `offset` 0..1 how far along the
 * edge the island is. The window sits flush on the chosen edge and slides along it, so the island can reach corners.
 */
export function windowFor(display: Rect, size: { w: number; h: number }, edge: Edge, offset: number): { bounds: Rect; placement: Placement } {
  const o = Math.max(0, Math.min(1, Number.isFinite(offset) ? offset : 0.5))
  const w = Math.min(size.w, display.w), h = Math.min(size.h, display.h)
  let x: number, y: number, along: number
  if (isSide(edge)) {
    const anchor = display.y + o * display.h
    y = Math.max(display.y, Math.min(display.y + display.h - h, anchor - h / 2))
    x = edge === 'left' ? display.x : display.x + display.w - w
    along = anchor - y
  } else {
    const anchor = display.x + o * display.w
    x = Math.max(display.x, Math.min(display.x + display.w - w, anchor - w / 2))
    y = edge === 'top' ? display.y : display.y + display.h - h
    along = anchor - x
  }
  return { bounds: { x: Math.round(x), y: Math.round(y), w, h }, placement: { edge, along, w, h } }
}

/** how close (px) to the end of an edge counts as "in the corner" */
export const CORNER_PX = 150

/** which edge and how far along it a screen point is nearest to; near a corner the offset snaps to exactly 0 or 1 (the island sits in the corner) */
export function nearestEdge(display: Rect, px: number, py: number): { edge: Edge; offset: number } {
  const dl = px - display.x, dr = display.x + display.w - px, dt = py - display.y, db = display.y + display.h - py
  const m = Math.min(dl, dr, dt, db)
  const edge: Edge = m === dt ? 'top' : m === db ? 'bottom' : m === dl ? 'left' : 'right'
  const len = isSide(edge) ? display.h : display.w
  const along = isSide(edge) ? py - display.y : px - display.x
  const offset = along <= CORNER_PX ? 0 : len - along <= CORNER_PX ? 1 : along / len
  return { edge, offset: Math.max(0, Math.min(1, offset)) }
}

export function placementSelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('placement: ' + m) }
  const d = { x: 0, y: 0, w: 1920, h: 1080 }
  const top = windowFor(d, { w: 1200, h: 760 }, 'top', 0.5)
  need(top.bounds.x === 360 && top.bounds.y === 0 && top.placement.along === 600, 'top centre')
  const corner = windowFor(d, { w: 1200, h: 760 }, 'top', 0)
  need(corner.bounds.x === 0 && corner.placement.along === 0, 'top-left corner: window pinned to the screen edge, island at its start')
  const right = windowFor(d, { w: 1200, h: 760 }, 'right', 0.5)
  need(right.bounds.x === 720 && right.bounds.y === 160 && right.placement.along === 380, 'right edge centre')
  const bottom = windowFor(d, { w: 1200, h: 760 }, 'bottom', 1)
  need(bottom.bounds.y === 320 && bottom.bounds.x === 720 && bottom.placement.along === 1200, 'bottom-right')
  const pl = { edge: 'left' as Edge, along: 300, w: 1200, h: 760 }
  need(JSON.stringify(mapPoint(pl, 300, 10)) === '{"x":10,"y":300}', 'left mapping')
  need(mapPath('M 10.00 -4 L 20.00 5.50 Z', { ...pl, edge: 'bottom' }) === 'M 10.00 764.00 L 20.00 754.50 Z', 'bottom path mirrors depth')
  const r = mapRect({ ...pl, edge: 'right' }, 100, 0, 200, 50)
  need(r.x === 1150 && r.w === 50 && r.y === 100 && r.h === 200, 'right rect')
  need(nearestEdge(d, 5, 500).edge === 'left' && nearestEdge(d, 960, 1070).edge === 'bottom' && nearestEdge(d, 960, 20).offset === 0.5, 'nearest edge')
  need(nearestEdge(d, 60, 10).offset === 0 && nearestEdge(d, 1900, 8).offset === 1 && nearestEdge(d, 6, 1070).offset === 1 && nearestEdge(d, 600, 8).offset > 0.3, 'corners snap to exactly 0 or 1')
  return 'placement ok'
}
