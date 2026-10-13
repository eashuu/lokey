import { useRef, useState } from 'react'
import { ArrowRight, Check, Plus, X } from 'lucide-react'
import { useData } from '@/lib/data'
import { useFocus } from '@/lib/focus'
import { useTodos, type Todo } from '@/lib/todos'
import { FullRing as Ring } from '../stats/Ring'
import { useIsland } from '@/island/store'

const AMBER = '#F5A524'
const PRESETS = [1, 5, 10, 15, 20]
const t12 = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const
const p2 = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600); return `${h ? `${h}:` : ''}${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}` }
const card = (left: number, top: number, width: number, height: number) => ({ position: 'absolute', left, top, width, height, borderRadius: 20, background: 'var(--fill-1)' }) as const

/** Pinned islands take keyboard focus; ask for it, then focus the field once the window is focusable. */
function pinThen(focus: () => void) {
  if (useIsland.getState().mode !== 'pinned') { useIsland.setState({ mode: 'pinned' }); setTimeout(focus, 80) } else focus()
}

function dayPrefix(due: number, now: Date) {
  const d = new Date(due)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return sameDay(d, now) ? '' : `${sameDay(d, tomorrow) ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short' })} `
}

/** Lives inside the week card at (12,112). */
export function NextUp({ now }: { now: Date }) {
  const next = useTodos(s => s.items.filter(t => !t.done && t.due !== null && t.due > now.getTime()).sort((a, b) => a.due! - b.due!)[0])
  return (
    <div style={{ position: 'absolute', left: 12, top: 112, width: 330, height: 58, borderRadius: 14, background: 'rgba(255,255,255,.055)' }}>
      <span style={{ position: 'absolute', left: 12, top: 13, width: 5, height: 32, borderRadius: 2.5, background: '#F28BB6' }} />
      <div style={{ position: 'absolute', left: 28, right: 12, top: 9, height: 18, lineHeight: '18px', fontSize: 13, fontWeight: 500, ...ellipsis }}>{next ? `Next · ${dayPrefix(next.due!, now)}${t12(next.due!)}` : 'Nothing scheduled'}</div>
      <div style={{ position: 'absolute', left: 28, right: 12, top: 29, height: 16, lineHeight: '16px', fontSize: 12, color: 'var(--muted)', ...ellipsis }}>{next ? next.text : 'Add a task with @18:30'}</div>
    </div>
  )
}

/** Hours / minutes box: editable while idle (clicking pins the island so it can take the keyboard). */
function TimeBox({ left, value, unit, editable, onChange }: { left: number; value: number; unit: string; editable: boolean; onChange: (n: number) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div style={{ position: 'absolute', left, top: 16, width: 103, height: 36, borderRadius: 10, background: 'rgba(255,255,255,.055)' }}>
      <input
        ref={ref} readOnly={!editable} value={unit === 'h' ? String(value) : p2(value)} inputMode="numeric"
        onMouseDown={() => editable && pinThen(() => ref.current?.select())}
        onChange={e => onChange(parseInt(e.target.value.replace(/\D/g, '').slice(-3) || '0', 10))}
        style={{ position: 'absolute', left: 0, top: 0, width: 63, height: 36, background: 'none', border: 0, outline: 'none', padding: 0, color: 'var(--text)', font: 'inherit', fontSize: 16, fontWeight: 500, textAlign: 'right', fontVariantNumeric: 'tabular-nums', userSelect: 'text', cursor: editable ? 'text' : 'default' }}
      />
      <span style={{ position: 'absolute', left: 67, top: 0, height: 36, lineHeight: '36px', fontSize: 11, color: 'var(--muted)' }}>{unit}</span>
    </div>
  )
}

export function FocusCard() {
  const setting = useData(s => s.settings.focusTimerMinutes)
  const f = useFocus()
  const [sel, setSel] = useState(setting)
  const idle = f.status === 'idle'
  const done = f.status === 'done'
  const running = f.status === 'running'
  const total = idle ? sel * 60_000 : f.totalMs
  const left = idle ? total : f.remainingMs
  const shown = Math.ceil(left / 60_000)
  const label = running ? 'Pause' : f.status === 'paused' ? 'Resume' : 'Start'
  const set = (min: number) => setSel(Math.min(999, Math.max(1, min)))
  return (
    <div style={card(188, 194, 354, 174)}>
      <div style={{ position: 'absolute', left: 20, top: 45 }}>
        <Ring value={done ? 100 : total ? (left / total) * 100 : 0} size={84} stroke={5} track="rgba(255,255,255,.102)" color={done ? 'var(--ok)' : AMBER}>
          <span style={{ fontSize: done ? 14 : 17, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{done ? 'Done' : clock(left)}</span>
        </Ring>
      </div>
      <TimeBox left={126} unit="h" value={idle ? Math.floor(sel / 60) : Math.floor(shown / 60)} editable={idle} onChange={h => set(h * 60 + (sel % 60))} />
      <TimeBox left={237} unit="min" value={idle ? sel % 60 : shown % 60} editable={idle} onChange={m => set(Math.floor(sel / 60) * 60 + Math.min(59, m))} />
      {PRESETS.map((m, t) => {
        const on = idle ? m === sel : m * 60_000 === f.totalMs
        return (
          <button key={m} disabled={!idle} onClick={() => setSel(m)} style={{ position: 'absolute', left: 126 + 44 * t, top: 62, width: 38, height: 28, borderRadius: 14, fontSize: 11, fontWeight: 500, background: on ? 'rgba(245,165,36,.2)' : 'rgba(255,255,255,.047)', color: on ? AMBER : '#A3AAB8', transition: 'background-color 140ms, color 140ms' }}>{m}m</button>
        )
      })}
      <button onClick={() => (running ? f.pause() : f.start(sel))} style={{ position: 'absolute', left: 126, top: 100, width: 103, height: 36, borderRadius: 11, background: AMBER, color: '#2A1800', fontSize: 13, fontWeight: 500 }}>{label}</button>
      <button onClick={f.reset} style={{ position: 'absolute', left: 237, top: 100, width: 103, height: 36, borderRadius: 11, background: 'rgba(255,255,255,.07)', fontSize: 13, fontWeight: 500 }}>Reset</button>
    </div>
  )
}

function CountRing({ done, total }: { done: number; total: number }) {
  const r = 13, c = 2 * Math.PI * r
  return (
    <div style={{ position: 'absolute', left: 244, top: 11, width: 30, height: 30, borderRadius: 15, background: 'rgba(255,255,255,.086)' }}>
      <span style={{ position: 'absolute', left: 5, top: 5, width: 20, height: 20, borderRadius: 10, background: 'rgb(7,9,13)' }} />
      <svg width={30} height={30} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <circle cx={15} cy={15} r={r} fill="none" stroke="#8ED92F" strokeWidth={4} strokeDasharray={c} strokeDashoffset={c * (1 - (total ? done / total : 0))} style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(.33,1,.68,1)' }} />
      </svg>
      <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 500, color: '#C1EA86', fontVariantNumeric: 'tabular-nums' }}>{done}/{total}</span>
    </div>
  )
}

export function TodoCard({ now }: { now: Date }) {
  const items = useTodos(s => s.items)
  const { add, toggle, remove } = useTodos.getState()
  const mode = useIsland(s => s.mode)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const submit = () => { if (text.trim()) { add(text); setText('') } }
  const pin = () => pinThen(() => input.current?.focus())
  const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done))
  return (
    <div style={card(554, 0, 290, 368)}>
      <div style={{ position: 'absolute', left: 16, top: 12, height: 20, lineHeight: '20px', fontSize: 14, fontWeight: 500 }}>Today</div>
      <CountRing done={items.filter(t => t.done).length} total={items.length} />
      <div className="scroll-y" style={{ position: 'absolute', left: 12, top: 52, width: 266, height: 252, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 4px' }}>All clear.</div>}
        {sorted.map(t => <Row key={t.id} t={t} now={now} onToggle={() => toggle(t.id)} onDelete={() => remove(t.id)} />)}
      </div>
      <div style={{ position: 'absolute', left: 12, top: 312, width: 266, height: 44, borderRadius: 12, border: '1.2px dashed rgba(255,255,255,.157)', boxSizing: 'border-box' }}>
        <Plus size={16} color="var(--muted)" style={{ position: 'absolute', left: 12 - 1.2, top: 14 - 1.2 }} />
        <input
          ref={input} value={text} placeholder={mode === 'hover' ? 'Click the island to type…' : 'Add a to-do…'}
          style={{ position: 'absolute', left: 38 - 1.2, width: 180, top: 0, height: 41.6, padding: 0, background: 'none', border: 0, outline: 'none', color: 'var(--text)', font: 'inherit', fontSize: 13, userSelect: 'text' }}
          onMouseDown={pin} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
        />
        <button aria-label="Add to-do" onClick={() => (text.trim() ? submit() : pin())} style={{ position: 'absolute', left: 227 - 1.2, top: 6 - 1.2, width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          <ArrowRight size={14} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  )
}

function Row({ t, now, onToggle, onDelete }: { t: Todo; now: Date; onToggle: () => void; onDelete: () => void }) {
  const late = !t.done && t.due !== null && t.due < now.getTime()
  const [hover, setHover] = useState(false)
  return (
    <div onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} style={{ position: 'relative', width: 266, height: 40, flex: 'none', borderRadius: 12, background: hover ? 'rgba(255,255,255,.086)' : 'rgba(255,255,255,.047)', transition: 'background-color .1s linear' }}>
      <button onClick={onToggle} aria-label={t.done ? 'Mark not done' : 'Mark done'} style={{ position: 'absolute', left: 11, top: 11, width: 18, height: 18, borderRadius: 9, display: 'grid', placeItems: 'center', boxSizing: 'border-box', border: t.done ? 0 : '1.5px solid rgba(255,255,255,.25)', background: t.done ? 'var(--accent)' : 'transparent', color: 'var(--accent-ink)', transition: 'background-color 140ms' }}>
        {t.done && <Check size={11} strokeWidth={3} />}
      </button>
      <span style={{ position: 'absolute', left: 38, right: hover ? 30 : t.due !== null ? 56 : 12, top: 0, height: 40, lineHeight: '40px', fontSize: 13, color: t.done ? 'var(--muted)' : 'var(--text)', textDecoration: t.done ? 'line-through' : 'none', ...ellipsis }}>{t.text}</span>
      {t.due !== null && !hover && <span style={{ position: 'absolute', right: 10, top: 0, height: 40, lineHeight: '40px', fontSize: 10, fontVariantNumeric: 'tabular-nums', color: late ? 'var(--warn)' : 'var(--muted)' }}>{new Date(t.due).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
      <button onClick={onDelete} aria-label="Delete" style={{ position: 'absolute', right: 10, top: 12, width: 16, height: 16, display: 'grid', placeItems: 'center', color: 'var(--muted)', opacity: hover ? 1 : 0, transition: 'opacity 120ms' }}><X size={13} /></button>
    </div>
  )
}
