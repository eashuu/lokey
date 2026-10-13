import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Clock, KeyRound, Play, Trash2, X } from 'lucide-react'
import type { ScheduledTask } from '@shared/voice'
import { bridge } from '@/bridge'
import { useClock } from '@/lib/clock'

const box: CSSProperties = { position: 'absolute', inset: 0, padding: '12px 28px 0', overflow: 'auto' }
const card: CSSProperties = { background: 'var(--fill-1)', borderRadius: 14, padding: 14 }
const input: CSSProperties = { flex: 1, minWidth: 0, background: 'var(--fill-1)', border: '1px solid transparent', borderRadius: 10, color: 'var(--text)', padding: '8px 10px', font: 'inherit', fontSize: 13, outline: 'none', userSelect: 'text' }
const btn: CSSProperties = { height: 28, padding: '0 12px', borderRadius: 14, fontSize: 11, fontWeight: 600, background: 'var(--fill-3)', color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }

function Head({ title, line }: { title: string; line: string }) {
  return (<><h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>{title}</h1><div style={{ marginTop: 3, fontSize: 12, color: 'var(--muted)' }}>{line}</div></>)
}

function Ask({ placeholder }: { placeholder: string }) {
  const [t, setT] = useState('')
  const go = () => { if (t.trim()) { bridge.voice.say(t); setT('') } }
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingBottom: 16 }}>
      <input value={t} onChange={e => setT(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder={placeholder} style={input} spellCheck={false} />
      <button onClick={go} style={btn}>Send</button>
    </div>
  )
}

const when = (iso: string, now: Date) => {
  const d = new Date(iso)
  const mins = Math.round((d.getTime() - now.getTime()) / 60_000)
  const abs = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (mins > 0 && mins < 90) return `in ${mins} min · ${abs}`
  const day = d.toDateString() === now.toDateString() ? 'today' : d.toDateString() === new Date(now.getTime() + 864e5).toDateString() ? 'tomorrow' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day} · ${abs}`
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (<div style={{ marginTop: 22 }}><div className="label" style={{ marginBottom: 8 }}>{title}</div>{children}</div>)
}

export function Desk() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const now = useClock()
  useEffect(() => {
    void bridge.voice.info().then(i => setTasks(i.tasks))
    return bridge.voice.onTasks(setTasks)
  }, [])
  const pending = tasks.filter(t => t.status === 'pending')
  const past = tasks.filter(t => t.status !== 'pending').slice(-6).reverse()
  return (
    <div style={box} className="scroll-y">
      <Head title="Desk" line="Things you asked me to do later." />
      <Section title={`Scheduled · ${pending.length}`}>
        {pending.length === 0 ? (
          <div style={{ ...card, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>Nothing scheduled. Say or type something like “open Netflix at 7pm” or “search Amazon for cat food in half an hour”.</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {pending.map(t => (
              <div key={t.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
                <Clock size={16} color="var(--accent)" style={{ flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{when(t.runAt, now)}</div>
                </div>
                <button style={btn} onClick={() => void bridge.voice.runTaskNow(t.id).then(setTasks)}><Play size={11} />Run now</button>
                <button style={btn} aria-label="Cancel task" onClick={() => void bridge.voice.cancelTask(t.id).then(setTasks)}><X size={12} />Cancel</button>
              </div>
            ))}
          </div>
        )}
      </Section>
      {past.length > 0 && (
        <Section title="Recent">
          <div style={{ display: 'grid', gap: 6 }}>
            {past.map(t => (
              <div key={t.id} style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--muted)' }}>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                <span>{t.status}</span><span className="num">{when(t.runAt, now)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      <Ask placeholder="Ask for something, e.g. open Netflix in an hour" />
    </div>
  )
}

export function Bond() {
  const [facts, setFacts] = useState<string[]>([])
  const [has, setHas] = useState<boolean | null>(null)
  useEffect(() => { void bridge.voice.memory().then(setFacts); void bridge.voice.info().then(i => setHas(i.hasKey)) }, [])
  return (
    <div style={box} className="scroll-y">
      <Head title="Bond" line="What I know about you. Everything stays on this PC." />
      <Section title="Connection">
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
          <KeyRound size={16} color={has ? 'var(--accent)' : 'var(--muted)'} />
          <div style={{ flex: 1, fontSize: 13 }}>{has === null ? '…' : has ? 'Gemini key saved. Hold your talk key and speak.' : 'No Gemini key yet.'}</div>
          <button style={btn} onClick={() => bridge.app.openSettings()}>{has ? 'Voice settings' : 'Add key'}</button>
        </div>
      </Section>
      <Section title={`Memories · ${facts.length}`}>
        {facts.length === 0 ? (
          <div style={{ ...card, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>Nothing yet. Tell me things worth remembering (“remember I prefer dark mode”).</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {facts.map(f => (
              <div key={f} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>{f}</span>
                <button style={{ ...btn, padding: '0 8px' }} aria-label="Forget" onClick={() => void bridge.voice.forget(f).then(setFacts)}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
