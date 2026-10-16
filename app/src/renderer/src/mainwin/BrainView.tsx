import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Download, Pause, Pencil, Pin, Play, Search, Trash2, X } from 'lucide-react'
import type { FactView, GraphView, JournalView, LessonView, MemoryStats, ProposalView, QuarantineView } from '@shared/memory'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { isPhone } from '@/lib/platform'

// What Lokey knows, as the Bond page shows it: a graph of the people, places, projects and apps it has heard about, the facts
// behind them (searchable; edit, pin or delete any), the lessons it learned from corrections, and a short daily journal.
const card: CSSProperties = { background: 'var(--fill-1)', borderRadius: 14, padding: 14 }
const btn: CSSProperties = { height: 28, padding: '0 12px', borderRadius: 14, fontSize: 11, fontWeight: 600, background: 'var(--fill-3)', color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }
const input: CSSProperties = { flex: 1, minWidth: 0, background: 'var(--fill-1)', border: '1px solid transparent', borderRadius: 10, color: 'var(--text)', padding: '8px 10px', font: 'inherit', fontSize: 13, outline: 'none', userSelect: 'text' }
const TYPE_COLOR: Record<string, string> = { person: '#ff8fb1', place: '#7bd88f', project: '#7cc4ff', app: '#f5d90a', org: '#c9a0ff', thing: '#9aa0ab' }

function Label({ children }: { children: string }) { return <div className="label" style={{ margin: '22px 0 8px' }}>{children}</div> }

/** a small force-directed layout drawn on a canvas; it settles and then stops (no idle cost) */
function Graph({ g, selected, onSelect }: { g: GraphView; selected: string | null; onSelect: (id: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const W = 640, H = 300
  const pos = useRef(new Map<string, { x: number; y: number; vx: number; vy: number }>())
  const [tick, setTick] = useState(0)
  const ids = useMemo(() => g.nodes.map(n => n.id).join(), [g])

  useEffect(() => {
    const P = pos.current
    for (const n of g.nodes) if (!P.has(n.id)) P.set(n.id, { x: W / 2 + (Math.random() - 0.5) * 220, y: H / 2 + (Math.random() - 0.5) * 120, vx: 0, vy: 0 })
    let raf = 0, frames = 0
    const step = () => {
      frames++
      const nodes = g.nodes.map(n => ({ n, p: P.get(n.id)! }))
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].p, b = nodes[j].p
        let dx = a.x - b.x, dy = a.y - b.y
        const d2 = Math.max(80, dx * dx + dy * dy), f = 2600 / d2
        const d = Math.sqrt(d2); dx /= d; dy /= d
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f
      }
      for (const e of g.edges) {
        const a = P.get(e.src), b = P.get(e.dst)
        if (!a || !b) continue
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - 90) * 0.012
        a.vx += (dx / d) * f; a.vy += (dy / d) * f; b.vx -= (dx / d) * f; b.vy -= (dy / d) * f
      }
      for (const { p } of nodes) {
        p.vx += (W / 2 - p.x) * 0.002; p.vy += (H / 2 - p.y) * 0.003
        p.vx *= 0.82; p.vy *= 0.82
        p.x = Math.max(24, Math.min(W - 24, p.x + p.vx)); p.y = Math.max(20, Math.min(H - 20, p.y + p.vy))
      }
      setTick(t => t + 1)
      if (frames < 220) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [ids]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = W * dpr; cv.height = H * dpr
    const c = cv.getContext('2d')!
    c.scale(dpr, dpr); c.clearRect(0, 0, W, H)
    const P = pos.current
    c.lineWidth = 1; c.font = '11px "Segoe UI", system-ui, sans-serif'; c.textAlign = 'center'
    for (const e of g.edges) {
      const a = P.get(e.src), b = P.get(e.dst)
      if (!a || !b) continue
      c.strokeStyle = 'rgba(160,170,190,.35)'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke()
      c.fillStyle = 'rgba(160,170,190,.7)'; c.fillText(e.rel, (a.x + b.x) / 2, (a.y + b.y) / 2 - 3)
    }
    for (const n of g.nodes) {
      const p = P.get(n.id)
      if (!p) continue
      const r = 5 + Math.min(9, n.weight * 1.6)
      c.fillStyle = TYPE_COLOR[n.type] ?? TYPE_COLOR.thing
      c.globalAlpha = selected && selected !== n.id ? 0.55 : 1
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill()
      if (selected === n.id) { c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke(); c.lineWidth = 1 }
      c.globalAlpha = 1
      c.fillStyle = 'rgba(235,238,245,.95)'; c.fillText(n.name, p.x, p.y + r + 12)
    }
  }, [tick, g, selected])

  const hit = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H
    let best: string | null = null, bd = 18
    for (const n of g.nodes) { const p = pos.current.get(n.id); if (!p) continue; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = n.id } }
    onSelect(best === selected ? null : best)
  }
  if (!g.nodes.length) return <div style={{ ...card, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>The graph fills in as I hear about the people, places and projects in your life.</div>
  return <canvas ref={ref} onClick={hit} style={{ width: '100%', aspectRatio: `${W} / ${H}`, borderRadius: 14, background: 'var(--fill-1)', cursor: 'pointer', display: 'block' }} />
}

export function BrainView() {
  const learn = useData(s => s.settings.brain.learn)
  const [facts, setFacts] = useState<FactView[]>([])
  const [graph, setGraph] = useState<GraphView>({ nodes: [], edges: [] })
  const [lessons, setLessons] = useState<LessonView[]>([])
  const [journal, setJournal] = useState<JournalView[]>([])
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<FactView[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null)
  const [adding, setAdding] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [quar, setQuar] = useState<QuarantineView[]>([])
  const [core, setCore] = useState<{ text: string; proposals: ProposalView[] }>({ text: '', proposals: [] })
  const [coreDraft, setCoreDraft] = useState<string | null>(null)
  const load = () => {
    void bridge.memory.quarantine?.().then(setQuar).catch(() => undefined); void bridge.memory.core?.().then(setCore).catch(() => undefined)
    void bridge.memory.list().then(setFacts); void bridge.memory.graph().then(setGraph); void bridge.memory.lessons().then(setLessons)
    void bridge.memory.journal().then(setJournal); void bridge.memory.stats().then(setStats)
  }
  useEffect(() => { load(); return bridge.memory.onChange(load) }, [])
  useEffect(() => { const t = setInterval(load, 20_000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!q.trim()) { setFound(null); return }
    const t = setTimeout(() => { void bridge.memory.search(q).then(setFound) }, 250)
    return () => clearTimeout(t)
  }, [q])

  const selName = graph.nodes.find(n => n.id === sel)?.name
  const shown = (found ?? facts).filter(f => !selName || f.entities.includes(selName)).slice(0, 80)
  const exportIt = async () => {
    const blob = new Blob([await bridge.memory.exportJson()], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lokey-memory.json'; a.click(); URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <Label>{`Memory · ${stats?.facts ?? facts.length} things${stats && stats.embedded ? ' (searchable by meaning)' : ''}`}</Label>
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
        <span style={{ flex: 1, minWidth: 180 }}>{learn ? `Learning from our conversations (on this ${isPhone ? 'phone' : 'PC'}; passwords and codes are never kept).` : 'Learning is paused: I only remember what you tell me to.'}{stats?.queued ? ` ${stats.queued} to process.` : ''}{stats?.db ? (stats.encrypted ? ' Stored encrypted on this PC.' : ' Stored on this PC (not encrypted).') : ''}</span>
        <button style={btn} onClick={() => bridge.settings.set({ brain: { learn: !learn } })}>{learn ? <><Pause size={11} />Pause learning</> : <><Play size={11} />Resume learning</>}</button>
        <button style={btn} onClick={() => void exportIt()}><Download size={11} />Export</button>
        {confirmClear ? <><button style={{ ...btn, background: '#e06c6c', color: '#fff' }} onClick={() => { void bridge.memory.clear(); setConfirmClear(false) }}>Yes, forget everything</button><button style={btn} onClick={() => setConfirmClear(false)}>Keep</button></> : <button style={btn} onClick={() => setConfirmClear(true)}><Trash2 size={11} />Clear</button>}
      </div>

      {quar.length > 0 && (
        <>
          <Label>{`To review · ${quar.length}`}</Label>
          <div style={{ ...card, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 6 }}>I picked these up right after reading something from outside (a web page, mail, the screen). I do not use them until you say they are true.</div>
          <div style={{ display: 'grid', gap: 6 }}>
            {quar.map(f => (
              <div key={f.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{f.text}<span style={{ color: 'var(--dim)', fontSize: 11 }}>  · from {f.taint || f.origin}</span></span>
                <button style={btn} onClick={() => void bridge.memory.approve?.(f.id).then(load)}>It is true</button>
                <button style={btn} onClick={() => void bridge.memory.reject?.(f.id).then(load)}>Discard</button>
              </div>
            ))}
          </div>
        </>
      )}

      {bridge.memory.core && (
        <>
          <Label>About you (always in my mind)</Label>
          {core.proposals.map(p => (
            <div key={p.id} style={{ ...card, marginBottom: 6, fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ color: 'var(--muted)', marginBottom: 4 }}>I suggest this update ({p.why}):</div>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{p.text}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><button style={btn} onClick={() => void bridge.memory.proposal?.(p.id, true).then(load)}>Use it</button><button style={btn} onClick={() => void bridge.memory.proposal?.(p.id, false).then(load)}>No thanks</button></div>
            </div>
          ))}
          <textarea value={coreDraft ?? core.text} onChange={e => setCoreDraft(e.target.value)} onBlur={() => { if (coreDraft !== null && coreDraft !== core.text) void bridge.memory.setCore?.(coreDraft).then(() => { setCoreDraft(null); load() }) }} placeholder="A few lines about you: who you are, how you like things done. Only you (or an update you approve) can change this." rows={4} maxLength={1200} style={{ ...input, width: '100%', height: 'auto', resize: 'vertical', lineHeight: 1.45, padding: 10, boxSizing: 'border-box' }} spellCheck={false} />
        </>
      )}

      <Label>Who and what I know about</Label>
      <Graph g={graph} selected={sel} onSelect={setSel} />
      {selName && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Showing what I know about <b style={{ color: 'var(--text)' }}>{selName}</b>. <button style={{ ...btn, height: 22 }} onClick={() => setSel(null)}><X size={10} />Show all</button></div>}

      <Label>Things I remember</Label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ position: 'relative', flex: 1, display: 'flex' }}><Search size={13} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--muted)' }} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="What do I know about…" style={{ ...input, paddingLeft: 30 }} spellCheck={false} /></div>
        <input value={adding} onChange={e => setAdding(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && adding.trim()) { void bridge.memory.add(adding).then(load); setAdding('') } }} placeholder="Tell me something to remember" style={input} spellCheck={false} />
      </div>
      {shown.length === 0 ? (
        <div style={{ ...card, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>{q ? 'Nothing found.' : 'Nothing yet. Talk to me; I will remember what matters, or say “remember that I prefer dark mode”.'}</div>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {shown.map(f => (
            <div key={f.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
              {edit?.id === f.id ? (
                <input autoFocus value={edit.text} onChange={e => setEdit({ id: f.id, text: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { void bridge.memory.edit(f.id, edit.text).then(load); setEdit(null) } else if (e.key === 'Escape') setEdit(null) }} style={input} />
              ) : (
                <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{f.text}{f.entities.length > 0 && <span style={{ color: 'var(--dim)', fontSize: 11 }}>  · {f.entities.join(', ')}</span>}<span title={`${f.trust ?? 'inferred'}, ${f.origin ?? ''}`} style={{ color: 'var(--dim)', fontSize: 10.5 }}>  · {f.origin === 'user-said' || f.trust === 'confirmed' ? 'you said' : f.origin === 'phone' ? 'from your phone' : f.origin === 'import' ? 'imported' : 'I worked it out'}{f.validFrom ? `, ${new Date(f.validFrom).toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}</span></span>
              )}
              <button style={{ ...btn, padding: '0 8px', background: f.pinned ? 'color-mix(in srgb, var(--accent) 35%, transparent)' : undefined }} aria-label={f.pinned ? 'Unpin' : 'Pin'} onClick={() => void bridge.memory.pin(f.id, !f.pinned).then(load)}><Pin size={12} /></button>
              <button style={{ ...btn, padding: '0 8px' }} aria-label="Edit" onClick={() => setEdit({ id: f.id, text: f.text })}><Pencil size={12} /></button>
              <button style={{ ...btn, padding: '0 8px' }} aria-label="Forget" onClick={() => void bridge.memory.remove(f.id).then(load)}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {lessons.length > 0 && (
        <>
          <Label>{`How you like things done · ${lessons.length}`}</Label>
          <div style={{ display: 'grid', gap: 6 }}>{lessons.slice(0, 8).map(l => <div key={l.id} style={{ ...card, padding: '8px 12px', fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>{l.trigger}: </span>{l.advice}</div>)}</div>
        </>
      )}
      {journal.length > 0 && (
        <>
          <Label>Journal</Label>
          <div style={{ display: 'grid', gap: 6 }}>{journal.slice(0, 5).map(j => <div key={j.day} style={{ ...card, padding: '8px 12px', fontSize: 13, lineHeight: 1.45 }}><span style={{ color: 'var(--muted)', marginRight: 8 }}>{new Date(j.day).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</span>{j.text}</div>)}</div>
        </>
      )}
    </>
  )
}
