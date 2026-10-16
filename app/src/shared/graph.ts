// The "Flow" island tab: what Lokey is doing, as a small left-to-right map (coming up -> Lokey -> helpers working). Pure code (no DOM,
// no Electron): the main process sends a GraphSnapshot, the renderer turns it into nodes + routes with buildGraph() and draws them.
//
// Layout = a left lane, a right lane and a stack in the middle. Left: scheduled items and to-dos (they flow INTO Lokey). Right: the
// helpers (Lokey sends them OUT). Middle: Lokey, the models ("engines"), connectors and the activity strip. Every line is an
// orthogonal "bus" route (stubs -> a spine -> a trunk to the core), so a line never crosses a card by construction, and
// graphSelfCheck() proves it for every possible slot. A node keeps its slot for as long as it exists (assignSlots is "sticky").

export interface GJob { id: string; role: string; title: string; goal?: string; status: 'running' | 'done' | 'failed' | 'stopped' | 'interrupted' | 'parked'; kind: string; backend: string; startedAt: number; endedAt?: number; steps: number; line: string; result?: string; model?: string; /** parked: carries on by itself at this time */ until?: number; /** parked: why (RATE_MINUTE, QUOTA_DAY...) */ waitKind?: string }
export interface GSched { id: string; title: string; runAt: number; repeat?: string; status: 'pending' | 'missed' }
export interface GLoop { id: string; what: string; who?: string; due?: number }
export interface GModel { id: string; name: string; model: string; state: 'serving' | 'idle' | 'resting'; roles: string[]; requests: number; tokens: number; note: string; until?: number }
export interface GMcp { id: string; name: string; ok: boolean; tools: number; error?: string }
/** something that happened lately. Additive: a feed without `events` still gets them from deriveEvents(). */
export interface GEvent { id: string; at: number; kind: 'start' | 'done' | 'fail' | 'retry' | 'info'; text: string; sub?: string }
/** a model call was rerouted from one model to another (the gateway's fallback); `from`/`to` are model ids */
export interface GReroute { from: string; to: string; at: number; role?: string }
export interface GraphSnapshot { at: number; voice: string; offline: boolean; jobs: GJob[]; schedule: GSched[]; loops: GLoop[]; models: GModel[]; mcp: GMcp[]; events?: GEvent[]; reroutes?: GReroute[] }
export interface GTodo { id: string; text: string; due: number | null }

export type NodeKind = 'core' | 'job' | 'sched' | 'todo' | 'model' | 'mcp' | 'more'
export type NodeState = 'active' | 'ok' | 'bad' | 'warn' | 'idle'
/** `label` is always the full text (the view wraps it, never cuts it); `sub` is the one-line ticker; `glyph` picks the icon; `pct` is 0..1
 *  for a countdown ring; `act` is the one-tap action of a failed / parked / interrupted job */
export interface GNode { id: string; kind: NodeKind; label: string; sub: string; state: NodeState; glyph?: string; pct?: number; act?: 'retry' | 'resume' | 'open'; ref?: { type: 'job' | 'sched' | 'loop' | 'todo' | 'model' | 'mcp'; id: string }; x: number; y: number; w: number; h: number }
export type EdgeKind = 'spawned' | 'scheduled' | 'waiting' | 'uses'
export interface GEdge { from: string; to: string; kind: EdgeKind; live: boolean }
export type Pt = [number, number]

export const GRAPH_W = 844
export const GRAPH_H = 368
export const CORE = { x: 422, y: 95, r: 30 }
export const MAX_NODES = 24
export const SPINE_L = 230, SPINE_R = 614, BUS_Y = 141
/** boxes the middle column keeps for text: the headline above the core, the captions, the activity strip */
export const HEADLINE = { x: 322, y: 4, w: 200, h: 54 }
export const ACTIVITY = { x: 244, y: 250, w: 356, h: 114 }
export const CAPTIONS = { engines: { x: 244, y: 130, w: 52, h: 11 }, mcp: { x: 244, y: 206, w: 70, h: 11 } }

interface Region { kind: Exclude<NodeKind, 'core' | 'more'>; x: number; y: number; cols: number; rows: number; cap: number; caption: string; nw: number; nh: number; cw: number; ch: number }
// 3 + 3 + 5 + 3 + 3 = 17 slots
export const REGIONS: Region[] = [
  { kind: 'sched', x: 0, y: 22, cols: 1, rows: 3, cap: 3, caption: 'Coming up', nw: 216, nh: 46, cw: 0, ch: 50 },
  { kind: 'todo', x: 0, y: 196, cols: 1, rows: 3, cap: 3, caption: 'Waiting on you', nw: 216, nh: 46, cw: 0, ch: 50 },
  { kind: 'job', x: 628, y: 22, cols: 1, rows: 5, cap: 5, caption: 'Working', nw: 216, nh: 58, cw: 0, ch: 62 },
  { kind: 'model', x: 244, y: 158, cols: 3, rows: 1, cap: 3, caption: 'Engines', nw: 114, nh: 34, cw: 121, ch: 0 },
  { kind: 'mcp', x: 244, y: 220, cols: 3, rows: 1, cap: 3, caption: 'Connectors', nw: 114, nh: 26, cw: 121, ch: 0 },
]
export const regionOf = (k: NodeKind) => REGIONS.find(r => r.kind === k)

/** where slot i of a region sits */
export function slotRect(r: Region, i: number) {
  const c = i % r.cols, row = Math.floor(i / r.cols)
  return { x: r.x + c * r.cw, y: r.y + row * r.ch, w: r.nw, h: r.nh }
}

/** Sticky slot assignment. `order` is the priority order of ids; `prev` the slots they held before. When more ids than
 *  slots exist, the last slot is kept for a "+N" node. Returns id -> slot for the ids that are shown. */
export function assignSlots(prev: Record<string, number>, order: string[], cap: number): Record<string, number> {
  const usable = order.length > cap ? cap - 1 : cap
  const shown = order.slice(0, Math.max(0, usable))
  const out: Record<string, number> = {}
  const taken = new Set<number>()
  for (const id of shown) if (prev[id] !== undefined && prev[id] < usable && !taken.has(prev[id])) { out[id] = prev[id]; taken.add(prev[id]) }
  let next = 0
  for (const id of shown) {
    if (id in out) continue
    while (taken.has(next)) next++
    out[id] = next; taken.add(next)
  }
  return out
}

const ROLE_LABEL: Record<string, string> = { general: 'Worker', researcher: 'Researcher', writer: 'Writer', operator: 'Operator', coder: 'Coder', second_screen: 'Second screen' }
export const roleLabel = (r: string) => ROLE_LABEL[r] ?? r
const RECENT_MS = 30 * 60_000
const RING_MS = 60 * 60_000   // a schedule's countdown ring fills over its last hour

export function fmtAgo(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}
export function fmtIn(ms: number) {
  if (ms < 45_000) return 'now'
  if (ms < 3_600_000) return `in ${Math.max(1, Math.round(ms / 60_000))} min`
  const h = Math.floor(ms / 3_600_000)
  return ms < 86_400_000 ? `in ${h} h ${Math.round((ms % 3_600_000) / 60_000)} min` : `in ${Math.round(ms / 86_400_000)} d`
}

/** what the activity strip shows when the feed carries no events of its own: job starts, finishes and failures of the last 30 minutes (newest first) */
export function deriveEvents(s: GraphSnapshot, now = s.at): GEvent[] {
  const out: GEvent[] = []
  for (const j of s.jobs) {
    const who = roleLabel(j.role), sub = j.title
    if (now - j.startedAt < RECENT_MS && j.status !== 'interrupted') out.push({ id: `s:${j.id}`, at: j.startedAt, kind: 'start', text: `${who} started`, sub })
    if (j.endedAt && now - j.endedAt < RECENT_MS) {
      if (j.status === 'done') out.push({ id: `e:${j.id}`, at: j.endedAt, kind: 'done', text: `${who} finished`, sub })
      else if (j.status === 'failed') out.push({ id: `e:${j.id}`, at: j.endedAt, kind: 'fail', text: `${who} failed`, sub })
      else if (j.status === 'stopped') out.push({ id: `e:${j.id}`, at: j.endedAt, kind: 'info', text: `${who} stopped`, sub })
    }
    if (j.status === 'parked') out.push({ id: `p:${j.id}`, at: j.endedAt ?? j.startedAt, kind: 'retry', text: `${who} is waiting for a model`, sub })
  }
  return out.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1))
}
/** feed events + derived ones, newest first, unique ids */
export function mergeEvents(s: GraphSnapshot, now = s.at): GEvent[] {
  const seen = new Set<string>()
  return [...(s.events ?? []), ...deriveEvents(s, now)].filter(e => !seen.has(e.id) && seen.add(e.id)).sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1))
}

type Slots = Record<NodeKind, Record<string, number>>
export const emptySlots = (): Slots => ({ core: {}, job: {}, sched: {}, todo: {}, model: {}, mcp: {}, more: {} })

const glyphOf = (j: GJob) => (j.backend === 'claude' ? 'claude' : j.backend === 'codex' ? 'codex' : j.role)

/** Snapshot (+ the renderer's own to-dos) -> positioned nodes and edges. `slots` is updated in place (it is the "memory" that keeps nodes still). */
export function buildGraph(s: GraphSnapshot, todos: GTodo[], now: number, slots: Slots): { nodes: GNode[]; edges: GEdge[]; hidden: number } {
  const nodes: GNode[] = [], edges: GEdge[] = []
  let hidden = 0
  const voiceWord = s.voice === 'idle' ? (s.offline ? 'offline' : 'ready') : s.voice === 'connecting' ? 'waking' : s.voice
  const busy = s.voice !== 'idle' || s.jobs.some(j => j.status === 'running')
  nodes.push({ id: 'core', kind: 'core', label: 'Lokey', sub: voiceWord, state: busy ? 'active' : 'idle', x: CORE.x - CORE.r, y: CORE.y - CORE.r, w: CORE.r * 2, h: CORE.r * 2 })

  const place = (kind: Exclude<NodeKind, 'core' | 'more'>, items: { id: string; make: (n: Pick<GNode, 'x' | 'y' | 'w' | 'h'>) => GNode }[]) => {
    const r = regionOf(kind)!
    const mem = slots[kind]
    const got = assignSlots(mem, items.map(i => i.id), r.cap)
    for (const k of Object.keys(mem)) delete mem[k]
    Object.assign(mem, got)
    for (const it of items) if (it.id in got) nodes.push(it.make(slotRect(r, got[it.id])))
    if (items.length > r.cap) {
      const extra = items.length - (r.cap - 1)
      hidden += extra
      const q = slotRect(r, r.cap - 1)
      nodes.push({ id: `more:${kind}`, kind: 'more', label: `+${extra}`, sub: kind === 'job' ? 'more helpers' : kind === 'sched' ? 'more coming up' : kind === 'todo' ? 'more waiting' : kind === 'model' ? 'more engines' : 'more connectors', state: 'idle', ...q })
    }
  }

  // helpers: running first, then the ones that need you (interrupted, parked, failed), then the recent ones (30 min), newest first
  const rank = (j: GJob) => (j.status === 'running' ? 0 : j.status === 'parked' || j.status === 'interrupted' ? 1 : j.status === 'failed' ? 2 : 3)
  const jobs = s.jobs
    .filter(j => j.status === 'running' || j.status === 'interrupted' || j.status === 'parked' || now - (j.endedAt ?? j.startedAt) < RECENT_MS)
    .sort((a, b) => rank(a) - rank(b) || b.startedAt - a.startedAt || (a.id < b.id ? -1 : 1))
  place('job', jobs.map(j => ({
    id: 'job:' + j.id,
    make: p => {
      const who = roleLabel(j.role)
      const sub = j.status === 'running' ? (j.line || `${who} · ${j.steps} step${j.steps === 1 ? '' : 's'}`)
        : j.status === 'done' ? `${who} · done ${fmtAgo(now - (j.endedAt ?? j.startedAt))} ago`
        : j.status === 'interrupted' ? 'Interrupted'
        : j.status === 'parked' ? `Waiting${j.until ? ' · ' + fmtIn(j.until - now) : ' for a model'}`
        : j.status === 'failed' ? (j.line || `${who} · failed`) : `${who} · stopped`
      const act = j.status === 'failed' || j.status === 'stopped' ? 'retry' : j.status === 'interrupted' ? 'resume' : j.status === 'parked' ? 'open' : undefined
      return { id: 'job:' + j.id, kind: 'job', label: j.title, sub, state: j.status === 'running' ? 'active' : j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : 'warn', glyph: glyphOf(j), act, ref: { type: 'job', id: j.id }, ...p }
    },
  })))

  const sched = s.schedule.filter(t => t.status === 'pending').sort((a, b) => a.runAt - b.runAt || (a.id < b.id ? -1 : 1))
  place('sched', sched.map(t => ({
    id: 'sched:' + t.id,
    make: p => ({ id: 'sched:' + t.id, kind: 'sched', label: t.title, sub: (t.repeat ? t.repeat + ' · ' : '') + fmtIn(t.runAt - now), state: t.runAt - now < 60_000 ? 'active' : 'idle', pct: Math.max(0.04, Math.min(1, 1 - (t.runAt - now) / RING_MS)), ref: { type: 'sched', id: t.id }, ...p }),
  })))

  type Row = { id: string; text: string; due: number | null; type: 'loop' | 'todo'; who?: string }
  const rows: Row[] = [
    ...s.loops.map(l => ({ id: l.id, text: l.who ? `${l.what} (${l.who})` : l.what, due: l.due ?? null, type: 'loop' as const })),
    ...todos.map(t => ({ id: t.id, text: t.text, due: t.due, type: 'todo' as const })),
  ].sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || (a.id < b.id ? -1 : 1))
  place('todo', rows.map(r => ({
    id: `${r.type}:${r.id}`,
    make: p => ({ id: `${r.type}:${r.id}`, kind: 'todo', label: r.text, sub: r.due ? (r.due < now ? 'overdue' : fmtIn(r.due - now)) : r.type === 'loop' ? 'you said you would' : 'to do', state: r.due && r.due < now ? 'warn' : 'idle', glyph: r.type, ref: { type: r.type, id: r.id }, ...p }),
  })))

  const models = [...s.models].sort((a, b) => ({ serving: 0, resting: 1, idle: 2 })[a.state] - ({ serving: 0, resting: 1, idle: 2 })[b.state] || (a.id < b.id ? -1 : 1))
  place('model', models.map(m => ({
    id: 'model:' + m.id,
    make: p => ({ id: 'model:' + m.id, kind: 'model', label: m.name, sub: m.state === 'serving' ? 'answering' : m.state === 'resting' ? (m.until && m.until > now ? `resting ${fmtAgo(m.until - now)}` : 'resting') : 'standby', state: m.state === 'serving' ? 'active' : m.state === 'resting' ? 'warn' : 'idle', ref: { type: 'model', id: m.id }, ...p }),
  })))

  place('mcp', s.mcp.map(m => ({
    id: 'mcp:' + m.id,
    make: p => ({ id: 'mcp:' + m.id, kind: 'mcp', label: m.name, sub: m.ok ? `${m.tools} tool${m.tools === 1 ? '' : 's'}` : 'not connected', state: m.ok ? 'ok' : 'bad', ref: { type: 'mcp', id: m.id }, ...p }),
  })))

  // edges: schedules and waiting items flow in, helpers and engines flow out; running helpers also point at the model that serves them
  const has = new Set(nodes.map(n => n.id))
  for (const n of nodes) {
    if (n.kind === 'job') edges.push({ from: 'core', to: n.id, kind: 'spawned', live: n.state === 'active' })
    else if (n.kind === 'sched') edges.push({ from: n.id, to: 'core', kind: 'scheduled', live: n.state === 'active' })
    else if (n.kind === 'todo') edges.push({ from: n.id, to: 'core', kind: 'waiting', live: false })
    else if (n.kind === 'model') edges.push({ from: 'core', to: n.id, kind: 'uses', live: n.state === 'active' })
  }
  for (const j of jobs) if (j.status === 'running' && j.model && has.has('job:' + j.id) && has.has('model:' + j.model)) edges.push({ from: 'job:' + j.id, to: 'model:' + j.model, kind: 'uses', live: true })
  return { nodes, edges, hidden }
}

/** The route of an edge as an orthogonal polyline (null for edges that are not drawn as lines, like helper -> model, which the view shows as a highlight). */
export function edgeRoute(a: GNode, b: GNode): Pt[] | null {
  const cy = (n: GNode) => n.y + n.h / 2, cx = (n: GNode) => n.x + n.w / 2
  if (b.kind === 'core' && (a.kind === 'sched' || a.kind === 'todo')) return [[a.x + a.w, cy(a)], [SPINE_L, cy(a)], [SPINE_L, CORE.y], [CORE.x - CORE.r, CORE.y]]
  if (a.kind === 'core' && b.kind === 'job') return [[CORE.x + CORE.r, CORE.y], [SPINE_R, CORE.y], [SPINE_R, cy(b)], [b.x, cy(b)]]
  if (a.kind === 'core' && b.kind === 'model') return cx(b) === CORE.x ? [[CORE.x, CORE.y + CORE.r], [CORE.x, b.y]] : [[CORE.x, CORE.y + CORE.r], [CORE.x, BUS_Y], [cx(b), BUS_Y], [cx(b), b.y]]
  return null
}

/** a polyline with rounded corners as an SVG path */
export function roundedPath(pts: Pt[], r = 8): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1], [x, y] = pts[i], [x1, y1] = pts[i + 1]
    const l0 = Math.hypot(x - x0, y - y0), l1 = Math.hypot(x1 - x, y1 - y), k = Math.min(r, l0 / 2, l1 / 2)
    if (k < 0.5) { d += ` L${x} ${y}`; continue }
    d += ` L${(x - ((x - x0) / l0) * k).toFixed(1)} ${(y - ((y - y0) / l0) * k).toFixed(1)} Q${x} ${y} ${(x + ((x1 - x) / l1) * k).toFixed(1)} ${(y + ((y1 - y) / l1) * k).toFixed(1)}`
  }
  const last = pts[pts.length - 1]
  return d + ` L${last[0]} ${last[1]}`
}

/** The thin base lines (each drawn once, so overlapping routes do not darken): per side one trunk, one spine, a stub per node. */
export function busLines(nodes: GNode[]): { d: string; kind: 'bus' | 'wait'; id: string }[] {
  const out: { d: string; kind: 'bus' | 'wait'; id: string }[] = []
  const left = nodes.filter(n => n.kind === 'sched' || n.kind === 'todo'), right = nodes.filter(n => n.kind === 'job')
  const side = (list: GNode[], x: number, trunkEnd: number, inward: boolean) => {
    if (!list.length) return
    const ys = list.map(n => n.y + n.h / 2)
    const lo = Math.min(CORE.y, ...ys), hi = Math.max(CORE.y, ...ys)
    out.push({ id: 'trunk' + x, d: `M${x} ${CORE.y} L${trunkEnd} ${CORE.y}`, kind: 'bus' })
    if (hi > lo) out.push({ id: 'spine' + x, d: `M${x} ${lo} L${x} ${hi}`, kind: 'bus' })
    for (const n of list) { const y = n.y + n.h / 2, e = inward ? n.x + n.w : n.x; out.push({ id: 'stub' + n.id, d: `M${x} ${y} L${e} ${y}`, kind: n.kind === 'todo' ? 'wait' : 'bus' }) }
  }
  side(left, SPINE_L, CORE.x - CORE.r, true)
  side(right, SPINE_R, CORE.x + CORE.r, false)
  const eng = nodes.filter(n => n.kind === 'model')
  if (eng.length) {
    const xs = eng.map(n => n.x + n.w / 2)
    const lo = Math.min(CORE.x, ...xs), hi = Math.max(CORE.x, ...xs)
    out.push({ id: 'drop', d: `M${CORE.x} ${CORE.y + CORE.r} L${CORE.x} ${BUS_Y}`, kind: 'bus' })
    if (hi > lo) out.push({ id: 'bus', d: `M${lo} ${BUS_Y} L${hi} ${BUS_Y}`, kind: 'bus' })
    for (const n of eng) { const x = n.x + n.w / 2; out.push({ id: 'drop' + n.id, d: `M${x} ${BUS_Y} L${x} ${n.y}`, kind: 'bus' }) }
  }
  return out
}

const inside = (x: number, y: number, r: { x: number; y: number; w: number; h: number }) => x > r.x + 0.5 && x < r.x + r.w - 0.5 && y > r.y + 0.5 && y < r.y + r.h - 0.5
/** does an axis-aligned segment pass through the inside of a rectangle? */
function segHits(a: Pt, b: Pt, r: { x: number; y: number; w: number; h: number }) {
  if (a[0] === b[0]) return a[0] > r.x + 0.5 && a[0] < r.x + r.w - 0.5 && Math.max(a[1], b[1]) > r.y + 0.5 && Math.min(a[1], b[1]) < r.y + r.h - 0.5
  if (a[1] === b[1]) return a[1] > r.y + 0.5 && a[1] < r.y + r.h - 0.5 && Math.max(a[0], b[0]) > r.x + 0.5 && Math.min(a[0], b[0]) < r.x + r.w - 0.5
  return inside(a[0], a[1], r) || inside(b[0], b[1], r)
}

/** Self-check: every possible slot sits inside the panel and overlaps nothing (the core, the headline, captions and the activity strip included);
 *  every route of every possible node avoids every other rectangle; nodes keep their slot when others come and go; the cap holds; overflow
 *  becomes "+N"; building twice gives the same picture. Throws on a failure. */
export function graphSelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('graph: ' + m) }
  type R = { id: string; x: number; y: number; w: number; h: number }
  const fixed: R[] = [{ id: 'core', x: CORE.x - CORE.r, y: CORE.y - CORE.r, w: CORE.r * 2, h: CORE.r * 2 }, { id: 'headline', ...HEADLINE }, { id: 'activity', ...ACTIVITY }, { id: 'cap-engines', ...CAPTIONS.engines }, { id: 'cap-mcp', ...CAPTIONS.mcp }]
  const slots: R[] = []
  for (const r of REGIONS) for (let i = 0; i < r.cap; i++) slots.push({ id: `${r.kind}${i}`, ...slotRect(r, i) })
  const rects = [...fixed, ...slots]
  need(slots.length <= MAX_NODES, 'at most 24 slots')
  for (const a of rects) need(a.x >= 0 && a.y >= 0 && a.x + a.w <= GRAPH_W && a.y + a.h <= GRAPH_H, `${a.id} inside the panel`)
  for (const [i, a] of rects.entries()) for (const b of rects.slice(i + 1)) need(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} overlaps ${b.id}`)
  // every route of every possible slot: no segment goes through any rectangle (its own endpoints only touch the border)
  const mk = (kind: NodeKind, r: R): GNode => ({ id: r.id, kind, label: '', sub: '', state: 'idle', x: r.x, y: r.y, w: r.w, h: r.h })
  const core = mk('core', fixed[0])
  for (const r of REGIONS) for (let i = 0; i < r.cap; i++) {
    const n = mk(r.kind, { id: `${r.kind}${i}`, ...slotRect(r, i) })
    const route = r.kind === 'sched' || r.kind === 'todo' ? edgeRoute(n, core) : r.kind === 'job' || r.kind === 'model' ? edgeRoute(core, n) : null
    if (!route) continue
    for (let k = 0; k + 1 < route.length; k++) for (const o of rects) need(!segHits(route[k], route[k + 1], o), `a line to ${n.id} crosses ${o.id}`)
  }
  need(Math.abs(SPINE_L - (REGIONS[0].x + REGIONS[0].nw)) >= 8 && SPINE_R > CORE.x + CORE.r && SPINE_R < REGIONS[2].x, 'the spines sit in the gutters')
  // sticky slots
  const prev = assignSlots({}, ['a', 'b', 'c', 'd'], 8)
  const after = assignSlots(prev, ['a', 'c', 'd', 'e', 'b'], 8)
  need(after.a === prev.a && after.c === prev.c && after.d === prev.d && after.b === prev.b, 'existing nodes keep their slot')
  need(after.e === 4, 'a new node takes the first free slot (4)')
  const gone = assignSlots(after, ['a', 'c', 'd', 'e'], 8)
  need(gone.e === 4 && gone.d === prev.d, 'removing a node moves nobody')
  const over = assignSlots({}, Array.from({ length: 12 }, (_, i) => 'x' + i), 8)
  need(Object.keys(over).length === 7 && new Set(Object.values(over)).size === 7 && Math.max(...Object.values(over)) < 7, 'overflow keeps the last slot for +N')
  // a full snapshot: caps hold, ids are unique, deterministic, stable
  const now = 1_000_000
  const snap: GraphSnapshot = {
    at: now, voice: 'idle', offline: false,
    jobs: Array.from({ length: 12 }, (_, i) => ({ id: 'j' + i, role: 'general', title: 'job ' + i, status: i < 2 ? 'running' : 'done', kind: 'task', backend: 'api', startedAt: now - i * 1000, steps: i, line: '', model: 'm1' } as GJob)),
    schedule: Array.from({ length: 6 }, (_, i) => ({ id: 's' + i, title: 's' + i, runAt: now + (i + 1) * 60_000, status: 'pending' as const })),
    loops: Array.from({ length: 5 }, (_, i) => ({ id: 'l' + i, what: 'l' + i })),
    models: [{ id: 'm1', name: 'M1', model: 'm', state: 'serving', roles: ['main'], requests: 1, tokens: 1, note: '' }, { id: 'm2', name: 'M2', model: 'm', state: 'resting', roles: [], requests: 0, tokens: 0, note: '' }],
    mcp: [{ id: 'a', name: 'A', ok: true, tools: 3 }],
  }
  const todos = [{ id: 't1', text: 'x', due: null }, { id: 't2', text: 'y', due: null }, { id: 't3', text: 'z', due: null }]
  const sl = emptySlots()
  const g1 = buildGraph(snap, todos, now, sl)
  need(g1.nodes.length <= MAX_NODES + 1, `<= 24 nodes + the centre (${g1.nodes.length})`)
  need(new Set(g1.nodes.map(n => n.id)).size === g1.nodes.length, 'unique node ids')
  need(g1.nodes.some(n => n.id === 'more:job') && g1.nodes.some(n => n.id === 'more:sched') && g1.nodes.some(n => n.id === 'more:todo'), '+N nodes appear for overflowing regions')
  need(JSON.stringify(buildGraph(snap, todos, now, emptySlots())) === JSON.stringify(g1), 'deterministic: the same snapshot gives the same picture')
  const byId = new Map(g1.nodes.map(n => [n.id, n]))
  for (const e of g1.edges) {
    const a = byId.get(e.from), b = byId.get(e.to)
    const route = a && b ? edgeRoute(a, b) : null
    if (!route) continue
    for (let k = 0; k + 1 < route.length; k++) for (const o of g1.nodes) if (o.id !== e.from && o.id !== e.to) need(!segHits(route[k], route[k + 1], o), `${e.from}->${e.to} crosses ${o.id}`)
  }
  const pos = new Map(g1.nodes.map(n => [n.id, `${n.x},${n.y}`]))
  snap.jobs = snap.jobs.filter(j => j.id !== 'j1')
  const g2 = buildGraph({ ...snap, at: now + 5000 }, todos, now + 5000, sl)
  need(g2.nodes.filter(n => n.kind !== 'more' && pos.has(n.id)).every(n => pos.get(n.id) === `${n.x},${n.y}`), 'positions are stable between updates')
  need(mergeEvents({ ...snap, events: [{ id: 'x', at: now + 1, kind: 'retry', text: 'Retrying' }] }, now)[0].id === 'x', 'feed events merge in, newest first')
  return 'graph ok'
}
