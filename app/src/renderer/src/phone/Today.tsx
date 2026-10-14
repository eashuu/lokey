import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Clock, Pause, Play, Sparkles, Square, X } from 'lucide-react'
import type { ScheduledTask } from '@shared/voice'
import { bridge } from '@/bridge'
import { useClock } from '@/lib/clock'
import { useData } from '@/lib/data'
import { useFocus } from '@/lib/focus'
import { haptic } from '@/lib/platform'
import { describeWeather, useWeather } from '@/lib/weather'
import { FullRing } from '@/tabs/stats/Ring'
import { clock } from './cards'
import { focusPlusMinute } from './activities'
import { sendText } from './chat'
import { native, needsPerm } from './native'
import { usePage } from './nav'
import { Card, PageHead } from './ui'

// Today: the next calendar events (calendar.list), reminders (reminder.list / reminder.cancel), things you said you would do (open loops),
// the focus timer, the weather line and your wake phrases / routines. Plugin: calendar.list { fromMs, toMs, limit }, reminder.list, reminder.cancel { id }.
const AMBER = '#F5A524'
const PRESETS = [5, 10, 15, 25, 45]
const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const dayWord = (t: number, now: Date) => { const d = new Date(t), a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); const n = Math.round((b - a) / 864e5); return n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long' }) }

interface Ev { id?: string | number; title: string; startMs: number; endMs?: number; allDay?: boolean; location?: string }
interface Rem { id: string; at: number; title: string }

function Focus() {
  const setting = useData(s => s.settings.focusTimerMinutes)
  const f = useFocus()
  const [sel, setSel] = useState(setting)
  const idle = f.status === 'idle', done = f.status === 'done'
  return (
    <Card title="Focus">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <FullRing value={done ? 100 : idle ? 100 : f.totalMs ? (f.remainingMs / f.totalMs) * 100 : 0} size={104} stroke={7} track="rgb(var(--ov) / .102)" color={done ? 'var(--ok)' : AMBER}>
          <span className="num" style={{ fontSize: done ? 15 : 20, fontWeight: 500 }}>{done ? 'Done' : clock(idle ? sel * 60_000 : f.remainingMs)}</span>
        </FullRing>
        <div style={{ flex: 1, display: 'grid', gap: 8 }}>
          {idle ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button aria-label="Shorter" onClick={() => setSel(m => Math.max(1, m - 5))} style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--fill-2)', fontSize: 20 }}>−</button>
              <span style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 600 }}>{sel} min</span>
              <button aria-label="Longer" onClick={() => setSel(m => Math.min(180, m + 5))} style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--fill-2)', fontSize: 20 }}>+</button>
            </div>
          ) : <div style={{ fontSize: 13, color: 'var(--muted)' }}>{f.status === 'running' ? 'Stay with it.' : f.status === 'paused' ? 'Paused' : 'Nicely done.'}</div>}
          <button className="ph-pill" onClick={() => { haptic(); if (f.status === 'running') f.pause(); else f.start(sel) }} style={{ background: AMBER, color: '#2A1800' }}>{f.status === 'running' ? <><Pause size={16} />Pause</> : <><Play size={16} />{f.status === 'paused' ? 'Resume' : 'Start'}</>}</button>
        </div>
      </div>
      {idle ? <div className="scroll-x" style={{ display: 'flex', gap: 6 }}>{PRESETS.map(m => <button key={m} onClick={() => setSel(m)} style={{ flex: 'none', minHeight: 44, padding: '0 16px', borderRadius: 22, fontSize: 13, fontWeight: 600, background: m === sel ? 'rgba(245,165,36,.2)' : 'var(--fill-2)', color: m === sel ? AMBER : 'var(--soft)' }}>{m}m</button>)}</div>
        : <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><button className="ph-pill" onClick={focusPlusMinute}>+1 min</button><button className="ph-pill" onClick={f.reset}><Square size={13} fill="currentColor" />Stop</button></div>}
    </Card>
  )
}

function Agenda({ now }: { now: Date }) {
  const [ev, setEv] = useState<Ev[] | null>(null)
  const [need, setNeed] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await native('calendar.list', { fromMs: Date.now(), toMs: Date.now() + 3 * 864e5, limit: 8 })
    if (Array.isArray(r)) { setEv(r); setNeed(null) } else { setEv([]); setNeed(needsPerm(r) ?? (r?.reason ? 'other:' + r.reason : null)) }
  }, [])
  useEffect(() => { void load() }, [load])
  return (
    <Card title="Up next" right={<CalendarClock size={16} color="var(--muted)" />}>
      {need && <div style={{ display: 'grid', gap: 10, justifyItems: 'start' }}><div style={{ fontSize: 14, color: 'var(--soft)' }}>{need.startsWith('other:') ? need.slice(6) : 'Allow calendar access to see your next events.'}</div>{!need.startsWith('other:') && <button className="ph-pill pri" onClick={async () => { await native('perm.request', { name: 'calendar' }); void load() }}>Allow calendar</button>}</div>}
      {ev && !need && ev.length === 0 && <div style={{ fontSize: 14, color: 'var(--muted)' }}>Nothing in the next three days.</div>}
      {ev?.map((e, i) => (
        <div key={`${e.id ?? i}`} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 4, alignSelf: 'stretch', minHeight: 36, borderRadius: 2, background: 'var(--accent)' }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{dayWord(e.startMs, now)} · {e.allDay ? 'all day' : `${hm(e.startMs)}${e.endMs ? ` – ${hm(e.endMs)}` : ''}`}{e.location ? ` · ${e.location}` : ''}</div>
          </div>
        </div>
      ))}
    </Card>
  )
}

function Reminders({ now }: { now: Date }) {
  const [rows, setRows] = useState<Rem[]>([])
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const load = useCallback(async () => {
    const r = await native('reminder.list')
    const list = Array.isArray(r) ? r : Array.isArray(r?.reminders) ? r.reminders : []
    setRows(list.map((x: { id: string; at?: number; time?: number; title?: string; text?: string }) => ({ id: x.id, at: x.at ?? x.time ?? 0, title: x.title ?? x.text ?? 'Reminder' })).filter((x: Rem) => !x.id.startsWith('task-')).sort((a: Rem, b: Rem) => a.at - b.at))
  }, [])
  useEffect(() => { void load(); void bridge.voice.info().then(i => setTasks(i.tasks)).catch(() => undefined); return bridge.voice.onTasks(setTasks) }, [load])
  const pending = tasks.filter(t => t.status === 'pending')
  if (!rows.length && !pending.length) return <Card title="Reminders and scheduled"><div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.45 }}>None. Say “remind me to call Amma at 6”, or “open Netflix at 7pm”.</div></Card>
  return (
    <Card title="Reminders and scheduled">
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Clock size={16} color="var(--accent)" style={{ flex: 'none' }} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>{r.at ? `${dayWord(r.at, now)} · ${hm(r.at)}` : ''}</div></div>
          <button aria-label={`Cancel ${r.title}`} onClick={() => { haptic(); setRows(p => p.filter(x => x.id !== r.id)); void native('reminder.cancel', { id: r.id }) }} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}><X size={16} /></button>
        </div>
      ))}
      {pending.map(t => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sparkles size={16} color="var(--accent)" style={{ flex: 'none' }} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>{dayWord(Date.parse(t.runAt), now)} · {hm(Date.parse(t.runAt))}{t.repeat ? ` · ${t.repeat}` : ''}</div></div>
          <button aria-label={`Cancel ${t.title}`} onClick={() => { haptic(); void bridge.voice.cancelTask(t.id).then(setTasks) }} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}><X size={16} /></button>
        </div>
      ))}
    </Card>
  )
}

type Loop = { id: string; what: string; who?: string; due?: string }
/** things you said you would do (hidden when there are none) */
function Loops() {
  const [rows, setRows] = useState<Loop[]>([])
  const load = () => { void bridge.voice.loops().then(setRows).catch(() => undefined) }
  useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t) }, [])
  if (!rows.length) return null
  const act = (id: string, a: 'done' | 'drop' | 'snooze') => { haptic(); void bridge.voice.loopSet(id, a).then(load) }
  return (
    <Card title={`You said you would · ${rows.length}`}>
      {rows.map(r => (
        <div key={r.id} style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 15 }}>{r.what}{r.who ? ` (${r.who})` : ''}{r.due && <span style={{ color: 'var(--muted)' }}> · {new Date(r.due).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 8 }}>
            <button className="ph-pill pri" onClick={() => act(r.id, 'done')}>Done</button>
            <button className="ph-pill" onClick={() => act(r.id, 'snooze')}>Snooze</button>
            <button className="ph-pill" onClick={() => act(r.id, 'drop')}>Drop</button>
          </div>
        </div>
      ))}
    </Card>
  )
}

function Routines() {
  const list = useData(s => s.settings.wake.list)
  const go = usePage(s => s.go)
  return (
    <Card title="Routines" right={<button onClick={() => go('you', 'wake')} style={{ minHeight: 44, padding: '0 6px', margin: '-10px -6px', fontSize: 13, color: 'var(--accent)' }}>Edit</button>}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -4 }}>Say the phrase, or tap it.</div>
      {list.map(r => (
        <button key={r.text} onClick={() => { haptic(); sendText(r.text); go('home') }} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, padding: '0 14px', borderRadius: 18, background: 'var(--fill-1)', textAlign: 'left' }}>
          <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>“{r.text}”</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.action === 'listen' ? 'starts listening' : r.action === 'greet' ? 'greets you' : 'welcome + catch-up'}</span>
        </button>
      ))}
    </Card>
  )
}

export function Today() {
  const now = useClock()
  const w = useWeather()
  const wx = w ? describeWeather(w.code, w.isDay) : null
  return (
    <div className="scroll-y" style={{ position: 'absolute', inset: 0, padding: '0 16px 16px', touchAction: 'pan-y' }}>
      <PageHead title="Today" line={now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        right={wx && w ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--soft)' }}><wx.Icon size={24} color="#F2C94C" strokeWidth={1.6} /><span><b style={{ fontSize: 18, color: 'var(--text)' }}>{Math.round(w.temp)}°</b><br />{w.city || wx.text}</span></div> : undefined} />
      <div style={{ display: 'grid', gap: 12 }}>
        <Agenda now={now} />
        <Reminders now={now} />
        <Loops />
        <Focus />
        <Routines />
      </div>
    </div>
  )
}
