import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { bridge } from '@/bridge'
import { useIsland } from '@/island/store'
import { useTodos } from '@/lib/todos'
import { ACTIVITY, BUS_Y, CAPTIONS, CORE, GRAPH_H, GRAPH_W, HEADLINE, REGIONS, buildGraph, busLines, edgeRoute, emptySlots, fmtAgo, fmtIn, mergeEvents, roleLabel, roundedPath, type GEvent, type GNode, type GraphSnapshot, type NodeState } from '@shared/graph'

// "Flow": a live map of what Lokey is doing, read left to right: what is coming up and waiting on you (left) flows into Lokey (centre),
// which sends helpers out (right). Under the core: the engines (models) that answer, the connectors, and the last three things that happened.
// Data comes from the main process (agents.graph) as pushes while this tab is open; nothing here polls. Everything that moves is
// transform/opacity (the pulses ride a path with offset-distance), nothing runs when the tab is hidden, and reduced motion makes it static.
if (window.lokeyFlags?.demo) (window as unknown as { __todos: unknown }).__todos = useTodos

const DOT: Record<NodeState, string> = { active: 'var(--accent)', ok: 'var(--ok)', bad: 'var(--bad)', warn: 'var(--warn)', idle: 'var(--dim)' }
const STYLE = `
@keyframes lk-fl-spin{to{transform:rotate(360deg)}}
@keyframes lk-fl-breathe{0%,100%{transform:scale(1);opacity:.55}50%{transform:scale(1.12);opacity:.85}}
@keyframes lk-fl-think{0%,100%{transform:scale(.9);opacity:.75}50%{transform:scale(1.1);opacity:1}}
@keyframes lk-fl-speak{0%,100%{transform:scale(.95)}30%{transform:scale(1.22)}60%{transform:scale(1.02)}}
@keyframes lk-fl-ripple{0%{transform:scale(.62);opacity:.55}100%{transform:scale(1.7);opacity:0}}
@keyframes lk-fl-run{0%{offset-distance:0%;opacity:0}12%{opacity:1}88%{opacity:1}100%{offset-distance:100%;opacity:0}}
@keyframes lk-fl-dot{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes lk-fl-in{from{opacity:0;transform:translate(var(--dx,0),var(--dy,6px)) scale(.97)}to{opacity:1;transform:none}}
@keyframes lk-fl-out{to{opacity:0;transform:translate(var(--dx,0),var(--dy,6px)) scale(.97)}}
.lk-fl *{box-sizing:border-box}
.lk-fl-spin{animation:lk-fl-spin 1.5s linear infinite;transform-origin:50% 50%}
.lk-fl-orbit{animation:lk-fl-spin 7s linear infinite;transform-origin:50% 50%}
.lk-fl-orb{animation:lk-fl-breathe 4.2s ease-in-out infinite}
.lk-fl-orb[data-s=thinking],.lk-fl-orb[data-s=connecting]{animation:lk-fl-think 1.1s ease-in-out infinite}
.lk-fl-orb[data-s=speaking]{animation:lk-fl-speak .7s ease-in-out infinite}
.lk-fl-orb[data-s=listening]{animation:lk-fl-breathe 1.6s ease-in-out infinite}
.lk-fl-ripple{animation:lk-fl-ripple 2.2s ease-out infinite}
.lk-fl-pulse{position:absolute;left:0;top:0;width:5px;height:5px;margin:-2.5px 0 0 -2.5px;border-radius:50%;background:var(--accent);offset-rotate:0deg;animation:lk-fl-run 2.4s linear infinite;opacity:0;pointer-events:none}
.lk-fl-dot{animation:lk-fl-dot 1.8s ease-in-out infinite}
.lk-fl-node{position:absolute;transition:opacity 220ms ease;animation:lk-fl-in 340ms cubic-bezier(.2,.9,.3,1.15) backwards;animation-delay:var(--d,0ms)}
.lk-fl-node[data-leaving=true]{animation:lk-fl-out 240ms ease-in both;pointer-events:none}
.lk-fl-card{position:absolute;inset:0;display:flex;align-items:center;gap:8px;padding:0 9px 0 8px;border-radius:12px;text-align:left;color:var(--text);background:var(--fill-1);border:1px solid transparent;transition:background-color 160ms linear,border-color 200ms linear}
.lk-fl-card:hover{background:var(--fill-2)}
.lk-fl-card[data-on=true]{background:var(--fill-3)}
.lk-fl-card[data-active=true]{border-color:color-mix(in srgb,var(--accent) 42%,transparent);background:color-mix(in srgb,var(--accent) 7%,var(--fill-1))}
.lk-fl-card[data-state=bad]{border-color:color-mix(in srgb,var(--bad) 40%,transparent)}
.lk-fl-card[data-state=warn]{border-color:color-mix(in srgb,var(--warn) 38%,transparent)}
.lk-fl-card:focus-visible,.lk-fl-act:focus-visible,.lk-fl-btn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.lk-fl-act{position:absolute;right:7px;bottom:6px;height:20px;padding:0 9px;border-radius:10px;font-size:10.5px;font-weight:600;background:var(--fill-4);color:var(--text);transition:background-color 140ms linear}
.lk-fl-act:hover{background:var(--accent);color:var(--accent-ink)}
.lk-fl-t{font-size:12px;font-weight:500;line-height:15px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.lk-fl-s{font-size:10.5px;line-height:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lk-fl-cap{position:absolute;font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim);white-space:nowrap;pointer-events:none;transition:opacity 220ms ease}
.lk-fl-btn{height:28px;padding:0 14px;border-radius:14px;font-size:12px;font-weight:500;background:var(--fill-3);color:var(--text);transition:background-color 140ms linear}
.lk-fl-btn:hover{background:var(--fill-4)}
.lk-fl-btn[data-main="true"]{background:var(--accent);color:var(--accent-ink)}
.lk-fl-ev{animation:lk-fl-in 360ms cubic-bezier(.2,.9,.3,1.15) backwards;--dy:-4px}
.lk-fl[data-paused=true] *{animation-play-state:paused!important}
@media (prefers-reduced-motion: reduce){.lk-fl *{animation:none!important;transition:none!important}.lk-fl-pulse,.lk-fl-ripple{display:none}}
`

const ICON: Record<string, string> = {
  researcher: 'M7 2.8a4.2 4.2 0 100 8.4 4.2 4.2 0 000-8.4zM10.2 10.2l3.3 3.3',
  writer: 'M3 13l.7-3.2L10.6 3a1.5 1.5 0 012.1 2.1L5.8 12 3 13z',
  operator: 'M4 3l8 4.2-3.4 1.1L7.4 12 4 3z',
  coder: 'M6 4.5L2.8 8 6 11.5M10 4.5L13.2 8 10 11.5',
  claude: 'M8 2.5v11M2.8 5.2l10.4 5.6M13.2 5.2L2.8 10.8',
  codex: 'M3.5 4.5L7 8l-3.5 3.5M8.5 12h4',
  general: 'M3 5h10M3 8h10M3 11h6',
  second_screen: 'M5 2.5h6a1 1 0 011 1v9a1 1 0 01-1 1H5a1 1 0 01-1-1v-9a1 1 0 011-1zM7 11.5h2',
  sched: 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 5v3.2l2 1.3',
  todo: 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11z',
  loop: 'M3 8a5 5 0 109-3M12.5 2v3h-3',
  mcp: 'M6 2.5v3M10 2.5v3M4.5 5.5h7V8a3.5 3.5 0 01-7 0V5.5zM8 11.5V14',
}
function Icon({ k, size = 13 }: { k: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={ICON[k] ?? ICON.general} /></svg>
}

/** the round badge of a card: the role glyph inside a ring (spinning arc while it works, a countdown ring for schedules) */
function Badge({ n }: { n: GNode }) {
  const R = 11, C = 2 * Math.PI * R, col = n.state === 'active' ? 'var(--accent)' : n.state === 'idle' ? 'rgb(var(--ov) / .4)' : DOT[n.state]
  const icon = n.glyph ?? (n.kind === 'sched' ? 'sched' : 'general')
  return (
    <span style={{ position: 'relative', width: 28, height: 28, flex: 'none', color: col, display: 'grid', placeItems: 'center' }}>
      <svg width={28} height={28} viewBox="0 0 28 28" style={{ position: 'absolute', inset: 0 }} aria-hidden>
        <circle cx={14} cy={14} r={R} fill={n.kind === 'job' && n.state !== 'active' ? 'rgb(var(--ov) / .05)' : 'none'} stroke="rgb(var(--ov) / .12)" strokeWidth={1.5} />
        {n.kind === 'job' && n.state === 'active' && <circle className="lk-fl-spin" cx={14} cy={14} r={R} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeDasharray={`${C * 0.28} ${C}`} />}
        {n.kind === 'job' && n.state !== 'active' && <circle cx={14} cy={14} r={R} fill="none" stroke="currentColor" strokeWidth={1.5} strokeOpacity={n.state === 'ok' ? 0.9 : 0.8} />}
        {n.kind === 'sched' && <circle cx={14} cy={14} r={R} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeDasharray={`${C * (n.pct ?? 0)} ${C}`} transform="rotate(-90 14 14)" />}
      </svg>
      <Icon k={icon} size={12} />
    </span>
  )
}

function useSnapshot() {
  const [snap, setSnap] = useState<GraphSnapshot | null>(null)
  useEffect(() => {
    const a = bridge.agents
    let live = true
    void a.graph?.().then(g => { if (live) setSnap(g) })
    const off = a.onGraph?.(g => { if (live) setSnap(g) })
    a.watchGraph?.(true)
    return () => { live = false; off?.(); a.watchGraph?.(false) }
  }, [])
  return snap
}

/** nodes that just left stay for 240 ms so they can fade out instead of vanishing */
function useLeaving(nodes: GNode[] | undefined) {
  const prev = useRef(new Map<string, GNode>())
  const [leaving, setLeaving] = useState<GNode[]>([])
  useEffect(() => {
    if (!nodes) return
    const cur = new Map(nodes.map(n => [n.id, n]))
    const gone = [...prev.current.values()].filter(n => !cur.has(n.id) && n.kind !== 'core')
    prev.current = cur
    if (!gone.length) { setLeaving(l => (l.some(n => cur.has(n.id)) ? l.filter(n => !cur.has(n.id)) : l)); return }
    setLeaving(l => [...l.filter(n => !cur.has(n.id) && !gone.some(g => g.id === n.id)), ...gone])
    const t = setTimeout(() => setLeaving(l => l.filter(n => !gone.some(g => g.id === n.id))), 260)
    return () => clearTimeout(t)
  }, [nodes])
  return leaving
}

function useVisible() {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden')
  useEffect(() => {
    const f = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [])
  return !hidden
}

export function AgentsTab() {
  const snap = useSnapshot()
  const todos = useTodos(s => s.items)
  const visible = useVisible()
  const [sel, setSel] = useState<string | null>(null)
  const [hov, setHov] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const slots = useRef(emptySlots())
  const openTodos = useMemo(() => todos.filter(t => !t.done).map(t => ({ id: t.id, text: t.text, due: t.due })), [todos])
  const g = useMemo(() => (snap ? buildGraph(snap, openTodos, now, slots.current) : null), [snap, openTodos, now])
  const leaving = useLeaving(g?.nodes)
  const events = useMemo(() => (snap ? mergeEvents(snap, now).slice(0, 3) : []), [snap, now])
  const selected = g?.nodes.find(n => n.id === sel) ?? null
  const ticking = !!selected?.ref && selected.ref.type === 'job' && snap?.jobs.find(j => j.id === selected.ref!.id)?.status === 'running'
  useEffect(() => {
    if (!visible) return
    // a coarse clock for "in 12 min" labels; once a second only while a running job's sheet is open (its elapsed time)
    const t = setInterval(() => setNow(Date.now()), ticking ? 1000 : 20_000)
    return () => clearInterval(t)
  }, [ticking, visible])
  if (!snap || !g) return <div style={{ width: GRAPH_W, height: GRAPH_H }} />

  const byId = new Map(g.nodes.map(n => [n.id, n]))
  const running = snap.jobs.filter(j => j.status === 'running').length
  const next = snap.schedule.filter(t => t.status === 'pending').sort((a, b) => a.runAt - b.runAt)[0]
  const v = snap.voice
  const state = v !== 'idle' ? v : running ? 'working' : 'idle'
  const need = g.nodes.filter(n => n.kind === 'job' && n.act).length
  const headline = v === 'listening' ? 'Listening' : v === 'thinking' ? 'Thinking' : v === 'speaking' ? 'Speaking' : v === 'connecting' ? 'Waking up' : v === 'error' ? 'Needs a look' : running ? `${running} working` : need ? `${need} need${need === 1 ? 's' : ''} a look` : 'All quiet'
  const sub = next ? `Next: ${next.title} ${fmtIn(next.runAt - now)}` : snap.offline ? 'Offline: local models only' : running || v !== 'idle' ? '' : 'Ask me anything, or say “remind me at 6”.'
  const jobsOnScreen = g.nodes.filter(n => n.kind === 'job').length
  const rest = (id: string) => !!sel && id !== sel && !(selected && edgeLinks(g.edges, sel, id))
  const focus = sel ?? hov
  const lit = (e: { from: string; to: string }) => !!focus && (e.from === focus || e.to === focus)
  const hotModel = (() => { const n = focus ? byId.get(focus) : null; return n?.ref?.type === 'job' ? 'model:' + snap.jobs.find(j => j.id === n.ref!.id)?.model : null })()
  const pulsing = g.edges.filter(e => e.live && e.kind !== 'uses' || (e.live && e.kind === 'uses' && byId.get(e.from)?.kind === 'core'))
  const stagger = new Map<string, number>()
  g.nodes.forEach((n, i) => stagger.set(n.id, Math.min(i, 14) * 28))
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && sel) { e.stopPropagation(); setSel(null) } }

  const nodeBox = (n: GNode): CSSProperties => ({ left: n.x, top: n.y, width: n.w, height: n.h, opacity: rest(n.id) ? 0.3 : 1, ['--d' as string]: `${stagger.get(n.id) ?? 0}ms`, ['--dx' as string]: n.kind === 'job' ? '10px' : n.kind === 'sched' || n.kind === 'todo' ? '-10px' : '0px', ['--dy' as string]: n.kind === 'model' || n.kind === 'mcp' ? '6px' : '0px' })
  const reroute = (snap.reroutes ?? []).filter(r => now - r.at < 3 * 60_000)[0]
  const rf = reroute && byId.get('model:' + reroute.from), rt = reroute && byId.get('model:' + reroute.to)

  return (
    <div className="lk-fl" data-paused={!visible} role="region" aria-label="Flow: what Lokey is doing" onKeyDown={onKey} style={{ position: 'relative', width: GRAPH_W, height: GRAPH_H }} onClick={() => setSel(null)}>
      <style>{STYLE}</style>

      <svg width={GRAPH_W} height={GRAPH_H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
        <defs><marker id="lk-fl-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1l5 3-5 3" fill="none" stroke="var(--warn)" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
        <g style={{ opacity: sel ? 0.45 : 1, transition: 'opacity 220ms ease' }}>
          {busLines(g.nodes).map(l => <path key={l.id} d={l.d} fill="none" stroke="rgb(var(--ov) / .15)" strokeWidth={1} strokeDasharray={l.kind === 'wait' ? '2 4' : undefined} />)}
        </g>
        {g.edges.map(e => {
          const a = byId.get(e.from), b = byId.get(e.to)
          const r = a && b ? edgeRoute(a, b) : null
          if (!r || !(e.live || lit(e))) return null
          return <path key={e.from + e.to} d={roundedPath(r)} fill="none" stroke="var(--accent)" strokeWidth={1.2} strokeLinecap="round" strokeOpacity={lit(e) ? 0.95 : 0.5} />
        })}
        {rf && rt && (() => { const x1 = rf.x + rf.w / 2, x2 = rt.x + rt.w / 2, y = rf.y + rf.h + 3; return <path d={`M${x1} ${y} Q${(x1 + x2) / 2} ${y + 14} ${x2} ${y}`} fill="none" stroke="var(--warn)" strokeWidth={1.3} strokeDasharray="3 3" strokeLinecap="round" markerEnd="url(#lk-fl-arrow)" /> })()}
        {g.nodes.filter(n => n.kind === 'sched' || n.kind === 'todo' || n.kind === 'job').map(n => <circle key={n.id} cx={n.kind === 'job' ? 614 : 230} cy={n.y + n.h / 2} r={2} fill="rgb(var(--ov) / .3)" />)}
        <circle cx={CORE.x} cy={BUS_Y} r={2} fill="rgb(var(--ov) / .3)" />
      </svg>

      {visible && pulsing.map((e, i) => {
        const a = byId.get(e.from), b = byId.get(e.to)
        const r = a && b ? edgeRoute(a, b) : null
        return r ? <span key={e.from + e.to} className="lk-fl-pulse" style={{ offsetPath: `path('${roundedPath(r)}')`, animationDelay: `${(i * 520) % 2400}ms` } as CSSProperties} aria-hidden /> : null
      })}

      {REGIONS.filter(r => g.nodes.some(n => n.kind === r.kind || n.id === `more:${r.kind}`) || (r.kind === 'job' && !jobsOnScreen)).map(r => {
        const top = r.kind === 'model' ? CAPTIONS.engines : r.kind === 'mcp' ? CAPTIONS.mcp : { x: r.x + 4, y: r.y - 14 }
        return <div key={r.kind} className="lk-fl-cap" style={{ left: top.x, top: top.y, opacity: sel ? 0.3 : 1 }}>{r.caption}</div>
      })}

      <Core state={state} warn={!running && v === 'idle' && need > 0} running={running} headline={headline} sub={sub} />

      {!jobsOnScreen && <div style={{ position: 'absolute', left: 628, top: 22, width: 216, height: 58, borderRadius: 12, border: '1px dashed rgb(var(--ov) / .16)', display: 'grid', placeItems: 'center', padding: '0 14px', textAlign: 'center', fontSize: 11, lineHeight: '14px', color: 'var(--dim)', pointerEvents: 'none' }}>Helpers appear here when Lokey starts a job</div>}

      {g.nodes.filter(n => n.kind !== 'core').map(n => <NodeView key={n.id} n={n} on={n.id === sel} hot={n.id === hotModel} hover={h => setHov(h ? n.id : null)} box={nodeBox(n)} now={now} onPick={() => setSel(n.id === sel ? null : n.id)} snap={snap} />)}
      {leaving.filter(n => !byId.has(n.id)).map(n => <div key={'x' + n.id} className="lk-fl-node" data-leaving="true" aria-hidden style={{ ...nodeBox(n), opacity: 1 }}><div className="lk-fl-card" /></div>)}

      <div role="log" aria-live="polite" aria-label="Recent activity" style={{ position: 'absolute', left: ACTIVITY.x, top: ACTIVITY.y, width: ACTIVITY.w, height: ACTIVITY.h, opacity: sel ? 0 : 1, transition: 'opacity 220ms ease' }}>
        <div className="lk-fl-cap" style={{ left: 0, top: 0 }}>Activity</div>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 18, display: 'grid', gap: 3 }}>
          {events.length ? events.map(e => <Event key={e.id} e={e} now={now} />) : <div style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: '16px' }}>Nothing yet today. What Lokey does will show up here.</div>}
        </div>
      </div>

      {selected && <Sheet n={selected} snap={snap} now={now} close={() => setSel(null)} />}
    </div>
  )
}

/** is `other` directly linked to the selected node (so it should stay lit)? */
function edgeLinks(edges: { from: string; to: string }[], sel: string, other: string) {
  return other === 'core' || edges.some(e => (e.from === sel && e.to === other) || (e.to === sel && e.from === other))
}

function Core({ state, warn, running, headline, sub }: { state: string; warn: boolean; running: number; headline: string; sub: string }) {
  const awake = state !== 'idle'
  const col = state === 'error' ? 'var(--bad)' : awake ? 'var(--accent)' : warn ? 'var(--warn)' : 'rgb(var(--ov) / .4)'
  const R = CORE.r
  return (
    <>
      <div style={{ position: 'absolute', left: HEADLINE.x, top: HEADLINE.y, width: HEADLINE.w, height: HEADLINE.h, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', textAlign: 'center', pointerEvents: 'none' }} aria-live="polite">
        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: '19px', color: state === 'error' ? 'var(--bad)' : warn ? 'var(--warn)' : 'var(--text)' }}>{headline}</div>
        {sub && <div style={{ fontSize: 11, lineHeight: '14px', color: 'var(--muted)', marginTop: 1, overflowWrap: 'anywhere' }}>{sub}</div>}
      </div>
      <div style={{ position: 'absolute', left: CORE.x - R, top: CORE.y - R, width: R * 2, height: R * 2, color: col, pointerEvents: 'none' }} role="img" aria-label={`Lokey: ${headline}`}>
        {state === 'listening' && [0, 1].map(i => <span key={i} className="lk-fl-ripple" style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid currentColor', animationDelay: `${i * 1.1}s` }} />)}
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `1.5px solid ${awake || warn ? 'currentColor' : 'rgb(var(--ov) / .16)'}`, opacity: awake || warn ? 0.5 : 1, transition: 'border-color 300ms ease' }} />
        {(state === 'thinking' || state === 'connecting') && (
          <svg className="lk-fl-spin" width={R * 2} height={R * 2} viewBox="0 0 60 60" style={{ position: 'absolute', inset: 0 }} aria-hidden><circle cx={30} cy={30} r={29} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray="44 140" /></svg>
        )}
        {running > 0 && (
          <span className="lk-fl-orbit" style={{ position: 'absolute', inset: 0 }}>
            {Array.from({ length: Math.min(running, 3) }, (_, i) => { const a = (i / Math.min(running, 3)) * Math.PI * 2; return <span key={i} style={{ position: 'absolute', left: R + Math.cos(a) * (R + 0) - 3, top: R + Math.sin(a) * (R + 0) - 3, width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} /> })}
          </span>
        )}
        <span className="lk-fl-orb" data-s={state} style={{ position: 'absolute', left: R - 11, top: R - 11, width: 22, height: 22, borderRadius: '50%', background: 'currentColor', transition: 'background-color 300ms ease' }} />
      </div>
    </>
  )
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function NodeView({ n, on, hot, hover, box, now, onPick, snap }: { n: GNode; on: boolean; hot: boolean; hover: (h: boolean) => void; box: CSSProperties; now: number; onPick: () => void; snap: GraphSnapshot }) {
  const pick = (e: { stopPropagation(): void }) => { e.stopPropagation(); onPick() }
  const label = `${n.label}. ${n.sub}`
  if (n.kind === 'model' || n.kind === 'mcp' || n.kind === 'more') {
    const chip = n.kind === 'model'
    const col = DOT[n.state]
    return (
      <div className="lk-fl-node" style={box} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
        <button className="lk-fl-card" data-on={on || hot} data-active={n.state === 'active'} data-state={n.state === 'bad' || n.state === 'warn' ? n.state : undefined} onClick={pick} aria-pressed={on} aria-label={label} title={`${n.label} · ${n.sub}`} style={{ padding: '0 8px', gap: 7, borderRadius: chip ? 11 : 13 }}>
          {n.kind === 'mcp' ? <span style={{ color: col, display: 'grid' }}><Icon k="mcp" size={12} /></span> : n.kind === 'model' ? <span className={n.state === 'active' ? 'lk-fl-dot' : undefined} style={{ width: 7, height: 7, borderRadius: '50%', background: col, flex: 'none' }} /> : null}
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="lk-fl-s" style={{ display: 'block', fontSize: 11.5, fontWeight: 500, color: 'var(--text)', lineHeight: '14px' }}>{n.label}</span>
            {chip && <span className="lk-fl-s" style={{ display: 'block', fontSize: 10, color: n.state === 'warn' ? 'var(--warn)' : n.state === 'active' ? 'var(--accent)' : 'var(--muted)' }}>{n.sub}</span>}
          </span>
          {n.kind === 'mcp' && <span className="lk-fl-s" style={{ fontSize: 10, color: n.state === 'bad' ? 'var(--bad)' : 'var(--muted)', flex: 'none' }}>{n.state === 'bad' ? 'off' : n.sub.replace(' tools', '').replace(' tool', '')}</span>}
          {n.kind === 'more' && <span className="lk-fl-s" style={{ fontSize: 10, color: 'var(--muted)' }}>{n.sub}</span>}
        </button>
      </div>
    )
  }
  const act = n.act
  const doAct = (e: { stopPropagation(): void }) => {
    e.stopPropagation()
    const id = n.ref!.id
    if (act === 'retry') void bridge.agents.retry?.(id)
    else if (act === 'resume') void bridge.agents.resume?.(id)
    else openDesk()
  }
  const subColor = n.state === 'bad' || n.state === 'warn' ? DOT[n.state] : n.state === 'active' ? 'var(--soft)' : 'var(--muted)'
  void now; void snap
  return (
    <div className="lk-fl-node" style={box} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <button className="lk-fl-card" data-on={on} data-active={n.state === 'active'} data-state={n.state === 'bad' || n.state === 'warn' ? n.state : undefined} onClick={pick} aria-pressed={on} aria-label={label} title={`${n.label}\n${n.sub}`}>
        <Badge n={n} />
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="lk-fl-t" style={{ display: '-webkit-box' }}>{n.label}</span>
          <span className="lk-fl-s" style={{ display: 'block', color: subColor, paddingRight: act ? 52 : 0 }}>{n.sub}</span>
        </span>
      </button>
      {act && <button className="lk-fl-act" onClick={doAct} aria-label={`${act === 'retry' ? 'Retry' : act === 'resume' ? 'Continue' : 'Open'}: ${n.label}`}>{act === 'retry' ? 'Retry' : act === 'resume' ? 'Continue' : 'Open'}</button>}
    </div>
  )
}

const EV_COLOR: Record<GEvent['kind'], string> = { start: 'var(--accent)', done: 'var(--ok)', fail: 'var(--bad)', retry: 'var(--warn)', info: 'var(--dim)' }
function Event({ e, now }: { e: GEvent; now: number }) {
  return (
    <div className="lk-fl-ev" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11.5, lineHeight: '15px', minHeight: 30 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: EV_COLOR[e.kind], marginTop: 5, flex: 'none' }} />
      <span style={{ flex: 1, minWidth: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>
        <span style={{ fontWeight: 500 }}>{e.text}</span>{e.sub && <span style={{ color: 'var(--muted)' }}> · {e.sub}</span>}
      </span>
      <span style={{ color: 'var(--dim)', fontSize: 10.5, flex: 'none', marginTop: 1 }}>{Math.max(0, now - e.at) < 45_000 ? 'now' : fmtAgo(now - e.at) + ' ago'}</span>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 12, lineHeight: '17px' }}>
      <span style={{ width: 62, flex: 'none', color: 'var(--muted)' }}>{k}</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
    </div>
  )
}

const dur = (ms: number) => fmtAgo(ms)

/** the focus sheet: opens in the middle column, under the core, so the tapped node and its line stay visible while the rest fades */
function Sheet({ n, snap, now, close }: { n: GNode; snap: GraphSnapshot; now: number; close: () => void }) {
  const ref = n.ref
  const rows: [string, string][] = []
  const buttons: { label: string; main?: boolean; run: () => void }[] = []
  let title = n.label, lead = ''
  if (n.kind === 'more') { title = n.label + ' more'; lead = 'Open the Desk to see all of them.'; buttons.push({ label: 'Open Desk', run: () => openDesk() }) }
  else if (ref?.type === 'job') {
    const j = snap.jobs.find(x => x.id === ref.id)
    if (j) {
      title = j.goal || j.title
      rows.push(['Who', `${roleLabel(j.role)}${j.backend !== 'api' ? ` · ${j.backend === 'claude' ? 'Claude Code' : 'Codex'}` : ''}`])
      rows.push(['Started', `${clock(j.startedAt)} · ${j.status === 'running' ? dur(now - j.startedAt) : j.endedAt ? 'took ' + dur(j.endedAt - j.startedAt) : 'earlier'}`])
      if (j.status !== 'interrupted') rows.push(['Steps', String(j.steps)])
      rows.push([j.status === 'running' ? 'Now' : j.status === 'parked' ? 'Waiting' : 'Last', j.status === 'parked' ? `for a model${j.waitKind ? ` (${j.waitKind.toLowerCase().replace('_', ' ')})` : ''}${j.until ? `, carries on ${fmtIn(j.until - now)}` : ''}` : j.line || '—'])
      const m = snap.models.find(x => x.id === j.model)
      if (m) rows.push(['Model', m.name])
      else if (j.backend !== 'api') rows.push(['Model', 'its own CLI'])
      if (j.status === 'running') buttons.push({ label: 'Stop', main: true, run: () => bridge.agents.stop(j.id) })
      else if (j.status === 'interrupted') buttons.push({ label: 'Continue', main: true, run: () => void bridge.agents.resume?.(j.id) })
      else if (j.status === 'parked') buttons.push({ label: 'Stop', run: () => bridge.agents.stop(j.id) })
      else buttons.push({ label: 'Retry', main: true, run: () => void bridge.agents.retry?.(j.id) })
      buttons.push({ label: 'Open', run: () => openDesk() })
    }
  } else if (ref?.type === 'sched') {
    const t = snap.schedule.find(x => x.id === ref.id)
    if (t) {
      title = t.title
      rows.push(['Runs', `${new Date(t.runAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${fmtIn(t.runAt - now)}`])
      rows.push(['Repeats', t.repeat ?? 'once'])
      rows.push(['Started by', 'Lokey, at that time'])
      buttons.push({ label: 'Cancel', main: true, run: () => { void bridge.voice.cancelTask(t.id); close() } })
    }
  } else if (ref?.type === 'loop' || ref?.type === 'todo') {
    const l = ref.type === 'loop' ? snap.loops.find(x => x.id === ref.id) : useTodos.getState().items.find(x => x.id === ref.id)
    if (l) {
      const due = 'due' in l ? l.due : null
      title = 'what' in l ? l.what : l.text
      rows.push(['Kind', ref.type === 'loop' ? 'Open loop (you said you would)' : 'Your to-do'])
      if ('who' in l && l.who) rows.push(['For', l.who])
      rows.push(['Due', due ? `${new Date(due).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}${due < now ? ' · overdue' : ''}` : 'no time'])
      buttons.push({ label: 'Mark done', main: true, run: () => { if (ref.type === 'loop') void bridge.voice.loopSet(ref.id, 'done'); else useTodos.getState().toggle(ref.id); close() } })
    }
  } else if (ref?.type === 'model') {
    const m = snap.models.find(x => x.id === ref.id)
    if (m) {
      title = m.name
      rows.push(['Model', m.model || 'Gemini Live voice'])
      rows.push(['State', m.state === 'serving' ? 'answering now' : m.state === 'resting' ? `resting${m.until ? ` until ${clock(m.until)}` : ''}` : 'on standby'])
      const rr = (snap.reroutes ?? []).find(r => r.from === m.id || r.to === m.id)
      if (rr) rows.push(['Rerouted', rr.from === m.id ? `a call moved to ${snap.models.find(x => x.id === rr.to)?.name ?? rr.to}` : `took over from ${snap.models.find(x => x.id === rr.from)?.name ?? rr.from}`])
      if (m.roles.length) rows.push(['For', m.roles.join(', ')])
      rows.push(['Today', `${m.requests} calls · ${m.tokens >= 1000 ? Math.round(m.tokens / 1000) + 'k' : m.tokens} tokens`])
      if (m.note) rows.push(['Note', m.note])
    }
  } else if (ref?.type === 'mcp') {
    const m = snap.mcp.find(x => x.id === ref.id)
    if (m) { title = m.name; rows.push(['Connector', m.ok ? 'connected' : 'not connected']); rows.push(['Tools', String(m.tools)]); if (m.error) rows.push(['Problem', m.error]) }
  }
  const job = ref?.type === 'job' ? snap.jobs.find(x => x.id === ref.id) : undefined
  const result = job && job.status !== 'running' && job.status !== 'interrupted' && job.result && job.result !== job.line ? job.result : ''
  return (
    <div onClick={e => e.stopPropagation()} role="dialog" aria-label={title}
      style={{ position: 'absolute', top: 146, left: ACTIVITY.x, width: ACTIVITY.w, maxHeight: GRAPH_H - 146 - 4, overflow: 'hidden', padding: '12px 14px', borderRadius: 18, background: 'var(--s2)', border: '1px solid var(--line)', display: 'grid', gap: 7, alignContent: 'start', animation: 'lk-fl-in 240ms cubic-bezier(.2,.9,.3,1.15) backwards', ['--dy' as string]: '8px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 500, lineHeight: '18px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{title}</span>
        <button onClick={close} aria-label="Close" className="lk-fl-btn" style={{ width: 24, height: 24, padding: 0, borderRadius: 12, color: 'var(--muted)', fontSize: 15, lineHeight: '22px', background: 'transparent' }}>×</button>
      </div>
      {lead && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{lead}</div>}
      <div style={{ display: 'grid', gap: 2 }}>{rows.map(([k, v]) => <Row key={k} k={k} v={v} />)}</div>
      {result && <div style={{ fontSize: 11.5, color: 'var(--soft)', lineHeight: '15px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{result}</div>}
      {buttons.length > 0 && <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>{buttons.map(b => <button key={b.label} className="lk-fl-btn" data-main={!!b.main} onClick={b.run}>{b.label}</button>)}</div>}
    </div>
  )
}

function openDesk() { bridge.app.openMain('desk'); useIsland.getState().closeIsland() }
