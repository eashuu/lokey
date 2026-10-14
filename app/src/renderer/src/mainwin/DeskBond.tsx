import { OpenLoops } from './OpenLoops'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Clock, KeyRound, Play, Trash2, X } from 'lucide-react'
import type { ActionRecord, AgentTask, ScheduledTask } from '@shared/voice'
import { bridge } from '@/bridge'
import { useClock } from '@/lib/clock'
import { BrainView } from './BrainView'
import { isPhone } from '@/lib/platform'

const box: CSSProperties = { position: 'absolute', inset: 0, padding: '12px var(--page-x, 28px) 0', overflow: 'auto' }
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
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{when(t.runAt, now)}{t.repeat ? ` · ${t.repeat === 'weekdays' ? 'every weekday' : t.repeat === 'weekly' ? 'every week' : 'every day'}` : ''}</div>
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
      <Agents />
      <OpenLoops />
      <Activity />
      <Ask placeholder="Ask for something, e.g. open Netflix in an hour" />
    </div>
  )
}

/** background jobs: what each worker, helper or coding agent is doing, with Stop */
function Agents() {
  const [jobs, setJobs] = useState<AgentTask[]>([])
  useEffect(() => { void bridge.agents.list().then(setJobs); return bridge.agents.onChange(setJobs) }, [])
  const running = jobs.filter(j => j.status === 'running')
  return (
    <Section title={`Jobs · ${running.length} running`}>
      {jobs.length === 0 ? (
        <div style={{ ...card, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>No jobs. Ask for something bigger (“research…”, “fix…”, “organise my Downloads”) and a worker takes it on in the background while you keep talking.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {jobs.slice(0, 8).map(j => (
            <div key={j.id} style={{ ...card, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, flex: 'none', background: j.status === 'running' ? 'var(--accent)' : j.status === 'done' ? '#5ec27a' : j.status === 'stopped' ? '#8a8f98' : '#e8a04a' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.title}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.backend !== 'api' ? (j.backend === 'claude' ? 'Claude Code' : 'Codex') : j.role}{j.steps ? ` · ${j.steps} step${j.steps === 1 ? '' : 's'}` : ''} · {j.status === 'running' ? j.line : j.status}</div>
                {j.status !== 'running' && j.result && <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 4, lineHeight: 1.4, maxHeight: 54, overflow: 'hidden' }}>{j.result}</div>}
              </div>
              {j.status === 'running' && <button style={btn} onClick={() => bridge.agents.stop(j.id)}><X size={12} />Stop</button>}
            </div>
          ))}
          {running.length > 0 && <div><button style={btn} onClick={() => bridge.agents.stop('all')}><X size={12} />Stop everything</button></div>}
        </div>
      )}
    </Section>
  )
}

const TONE: Record<ActionRecord['outcome'], string> = { done: 'var(--muted)', failed: '#e8a04a', denied: '#e8a04a', refused: '#e06c6c' }

/** everything the assistant did on your behalf (newest first), including what you or the safety rules stopped */
function Activity() {
  const [rows, setRows] = useState<ActionRecord[]>([])
  const [undos, setUndos] = useState<{ id: string; summary: string }[]>([])
  const load = () => { void bridge.voice.actions().then(setRows); void bridge.voice.undoList().then(setUndos) }
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t) }, [])
  return (
    <Section title={`Activity · ${rows.length}`}>
      {rows.length === 0 ? (
        <div style={{ ...card, fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>Nothing yet. Every action I take for you shows up here, and anything risky asks you first.</div>
      ) : (
        <div style={{ display: 'grid', gap: 5 }}>
          {rows.slice(0, 30).map((r, i) => (
            <div key={r.at + i} style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--muted)', alignItems: 'baseline' }}>
              <span className="num" style={{ flex: 'none', width: 56 }}>{new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>{r.summary}</span>
              <span style={{ flex: 'none', color: TONE[r.outcome] }}>{r.outcome}</span>
              {r.outcome === 'done' && undos.find(u => u.summary === r.summary) && <button style={{ ...btn, height: 20, padding: '0 8px' }} onClick={() => void bridge.voice.undoRun(undos.find(u => u.summary === r.summary)!.id).then(load)}>Undo</button>}
            </div>
          ))}
          <div><button style={{ ...btn, marginTop: 6 }} onClick={() => void bridge.voice.clearActions().then(load)}><Trash2 size={11} />Clear log</button></div>
        </div>
      )}
    </Section>
  )
}

export function Bond() {
  const [has, setHas] = useState<boolean | null>(null)
  useEffect(() => { void bridge.voice.info().then(i => setHas(i.hasKey)) }, [])
  return (
    <div style={box} className="scroll-y">
      <Head title="Bond" line={`What I know about you and the people in your life. Everything stays on this ${isPhone ? 'phone' : 'PC'}.`} />
      <Section title="Connection">
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
          <KeyRound size={16} color={has ? 'var(--accent)' : 'var(--muted)'} />
          <div style={{ flex: 1, fontSize: 13 }}>{has === null ? '…' : has ? 'Gemini key saved. Hold your talk key and speak.' : 'No Gemini key yet.'}</div>
          <button style={btn} onClick={() => bridge.app.openSettings('voice')}>{has ? 'Voice settings' : 'Add key'}</button>
        </div>
      </Section>
      <BrainView />
    </div>
  )
}
