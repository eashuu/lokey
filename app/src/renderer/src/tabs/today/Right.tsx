import { useRef, useState } from 'react'
import { Check, Pause, Play, RotateCcw, X } from 'lucide-react'
import { useData } from '@/lib/data'
import { useFocus } from '@/lib/focus'
import { duration, mmss } from '@/lib/format'
import { useTodos, type Todo } from '@/lib/todos'
import { Card, IconButton, Label, Ring } from '@/ui'
import { useIsland } from '@/island/store'

const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

function dueLabel(due: number, now: Date) {
  const d = new Date(due)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return `${sameDay(d, now) ? 'Today' : sameDay(d, tomorrow) ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short' })} ${hhmm(due)}`
}

export function NextUp({ now }: { now: Date }) {
  const next = useTodos(s => s.items.filter(t => !t.done && t.due !== null && t.due > now.getTime()).sort((a, b) => a.due! - b.due!)[0])
  return (
    <Card style={{ padding: '0.625rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
      <Label>Next up</Label>
      {next ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', justifyContent: 'space-between', minWidth: 0 }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{next.text}</span>
          <span className="num" style={{ fontSize: '0.6875rem', color: 'var(--accent)', flex: 'none' }}>{dueLabel(next.due!, now)} · in {duration(Math.max(60, (next.due! - now.getTime()) / 1000))}</span>
        </div>
      ) : <span style={{ fontSize: '0.8125rem', color: 'var(--dim)' }}>Nothing scheduled</span>}
    </Card>
  )
}

export function FocusCard() {
  const minutes = useData(s => s.settings.focusTimerMinutes)
  const f = useFocus()
  const idle = f.status === 'idle'
  const total = idle ? minutes * 60_000 : f.totalMs
  const left = idle ? total : f.remainingMs
  const done = f.status === 'done'
  const running = f.status === 'running'
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return (
    <Card style={{ padding: '0.625rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <Ring value={done ? 100 : total ? (left / total) * 100 : 0} size={3.5 * px} stroke={0.25 * px} color={done ? 'var(--ok)' : 'var(--accent)'}>
        <span className="num" style={{ fontSize: done ? '0.6875rem' : '0.75rem', fontWeight: 500 }}>{done ? 'Done' : mmss(left)}</span>
      </Ring>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Label>Focus</Label>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{done ? 'Nice work' : running ? 'In progress' : f.status === 'paused' ? 'Paused' : `${minutes} min`}</div>
      </div>
      <IconButton active title={running ? 'Pause' : 'Start'} onClick={() => (running ? f.pause() : f.start(minutes))} size="2rem">
        {running ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </IconButton>
      <IconButton title="Reset" onClick={f.reset} size="2rem"><RotateCcw size={14} /></IconButton>
    </Card>
  )
}

export function TodoCard({ now }: { now: Date }) {
  const items = useTodos(s => s.items)
  const { add, toggle, remove } = useTodos.getState()
  const mode = useIsland(s => s.mode)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const submit = () => { if (text.trim()) { add(text); setText('') } }
  // pinned islands take keyboard focus; ask for it, then focus the field once the window is focusable
  const pin = () => { if (useIsland.getState().mode !== 'pinned') { useIsland.setState({ mode: 'pinned' }); setTimeout(() => input.current?.focus(), 80) } }
  const sorted = [...items].sort((a, b) => Number(a.done) - Number(b.done))
  return (
    <Card style={{ padding: '0.625rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <Label>To-do</Label>
      <input
        ref={input} className="field" value={text} placeholder="Add a task… (@18:30 for a time)"
        style={{ padding: '0.375rem 0.625rem', fontSize: '0.75rem' }}
        onMouseDown={pin} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit() }}
      />
      {mode === 'hover' && <div style={{ fontSize: '0.5625rem', color: 'var(--dim)', marginTop: '-0.125rem' }}>Click the island to type</div>}
      <div className="scroll-y" style={{ maxHeight: '6.5rem', display: 'flex', flexDirection: 'column', gap: '0.0625rem' }}>
        {sorted.length === 0 && <div style={{ fontSize: '0.6875rem', color: 'var(--dim)', padding: '0.25rem 0' }}>All clear.</div>}
        {sorted.map(t => <Row key={t.id} t={t} now={now} onToggle={() => toggle(t.id)} onDelete={() => remove(t.id)} />)}
      </div>
    </Card>
  )
}

function Row({ t, now, onToggle, onDelete }: { t: Todo; now: Date; onToggle: () => void; onDelete: () => void }) {
  const late = !t.done && t.due !== null && t.due < now.getTime()
  const [hover, setHover] = useState(false)
  return (
    <div className="row-hover" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.375rem', opacity: t.done ? 0.5 : 1 }}>
      <button onClick={onToggle} aria-label={t.done ? 'Mark not done' : 'Mark done'} style={{ width: '1rem', height: '1rem', borderRadius: '0.3125rem', flex: 'none', display: 'grid', placeItems: 'center', border: '1.5px solid ' + (t.done ? 'var(--accent)' : 'var(--dim)'), background: t.done ? 'var(--accent)' : 'transparent', color: 'var(--accent-ink)', transition: 'background-color 140ms, border-color 140ms' }}>
        {t.done && <Check size={10} strokeWidth={3} />}
      </button>
      <span style={{ flex: 1, minWidth: 0, fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: t.done ? 'line-through' : 'none' }}>{t.text}</span>
      {t.due !== null && <span className="num" style={{ fontSize: '0.625rem', color: late ? 'var(--warn)' : 'var(--dim)', flex: 'none' }}>{hhmm(t.due)}</span>}
      <button onClick={onDelete} aria-label="Delete" style={{ color: 'var(--muted)', flex: 'none', display: 'grid', opacity: hover ? 1 : 0, transition: 'opacity 120ms' }}><X size={12} /></button>
    </div>
  )
}
