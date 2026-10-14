import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, Check, Flashlight, MapPin, MessageSquare, Phone, Search, Timer, Volume2, X, Bell, Eye } from 'lucide-react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { useFocus } from '@/lib/focus'
import { haptic } from '@/lib/platform'
import { Pill } from '@/tabs/controls/Pill'
import { useChat, sendText } from './chat'
import { native, needsPerm } from './native'

// Home's quick-action chips. Each runs a plugin method (PLUGIN.md): flashlight.set, intent.timer / reminder.set, screenshot (+ ui.home,
// app.openSelf), contacts.search + intent.dial / intent.sms (the composer opens, nothing is sent silently), intent.maps, reminder.set.
type Sheet = null | 'volume' | 'timer' | 'call' | 'nav' | 'reminder'
let torch = false
const notice = (text: string, tone: 'info' | 'error' = 'info') => useChat.getState().push(tone === 'error' ? 'error' : 'notice', text)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function whatsOnMyScreen() {
  notice('Looking at your screen…')
  await native('ui.home'); await sleep(700) // Lokey is in front: step aside to see what is behind it
  const shot = await native('screenshot', { maxWidth: 1080, quality: 70 })
  void native('app.openSelf')
  if (!shot || shot.ok === false) { notice(shot?.reason ? `Could not capture the screen: ${shot.reason}` : 'Could not capture the screen', 'error'); return }
  ;(window as unknown as { __lokeyScreenshot?: unknown }).__lokeyScreenshot = shot // for the agent's screen tool (same path as circle-to-ask)
  sendText("What's on my screen right now? (I just took a screenshot of it.)")
}

const field = { width: '100%', boxSizing: 'border-box', minHeight: 52, padding: '0 18px', borderRadius: 26, background: 'var(--fill-2)', border: 0, outline: 'none', color: 'var(--text)', font: 'inherit', fontSize: 16, userSelect: 'text' } as const
const row = { display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '0 8px 0 16px', borderRadius: 20, background: 'var(--fill-1)', textAlign: 'left' } as const
const pill = (on = false) => ({ minHeight: 44, padding: '0 16px', borderRadius: 22, fontSize: 14, fontWeight: 600, background: on ? 'var(--accent)' : 'var(--fill-3)', color: on ? 'var(--accent-ink)' : 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center' }) as const

export function QuickChips() {
  const [sheet, setSheet] = useState<Sheet>(null)
  const [t, setT] = useState(torch)
  const chip = (icon: ReactNode, label: string, fn: () => void, on = false) => (
    <button key={label} onClick={() => { haptic(); fn() }} aria-pressed={on} style={{ flex: 'none', minHeight: 44, padding: '0 16px 0 12px', borderRadius: 22, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, background: on ? 'color-mix(in srgb, var(--accent) 24%, var(--fill-2))' : 'var(--fill-2)', color: on ? 'var(--accent)' : 'var(--text)' }}>{icon}{label}</button>
  )
  return (
    <>
      <div className="scroll-x" style={{ display: 'flex', gap: 8, padding: '0 16px', flex: 'none' }}>
        {chip(<Flashlight size={16} />, 'Torch', () => { torch = !torch; setT(torch); void native('flashlight.set', { on: torch }) }, t)}
        {chip(<Volume2 size={16} />, 'Volume', () => setSheet('volume'))}
        {chip(<Timer size={16} />, 'Timer', () => setSheet('timer'))}
        {chip(<Eye size={16} />, 'What’s on my screen?', () => void whatsOnMyScreen())}
        {chip(<Phone size={16} />, 'Call or message', () => setSheet('call'))}
        {chip(<MapPin size={16} />, 'Navigate', () => setSheet('nav'))}
        {chip(<Bell size={16} />, 'Remind me', () => setSheet('reminder'))}
        {chip(<Camera size={16} />, 'Camera', () => void native('intent.camera', {}))}
      </div>
      {sheet && <SheetFrame close={() => setSheet(null)}>{sheet === 'volume' ? <VolumeSheet /> : sheet === 'timer' ? <TimerSheet done={() => setSheet(null)} /> : sheet === 'call' ? <CallSheet /> : sheet === 'nav' ? <NavSheet done={() => setSheet(null)} /> : <ReminderSheet done={() => setSheet(null)} />}</SheetFrame>}
    </>
  )
}

function SheetFrame({ close, children }: { close: () => void; children: ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 30 }}>
      <div onPointerDown={close} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)' }} />
      <div role="dialog" className="ph-sheet" style={{ position: 'absolute', left: 8, right: 8, bottom: 8, padding: 16, borderRadius: 28, background: 'var(--s1)', boxShadow: 'inset 0 0 0 1px var(--line)', display: 'grid', gap: 12, maxHeight: '80%', overflowY: 'auto' }}>
        <button aria-label="Close" onClick={close} style={{ position: 'absolute', right: 8, top: 8, width: 44, height: 44, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}><X size={18} /></button>
        {children}
      </div>
    </div>
  )
}

const H = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 17, fontWeight: 650, minHeight: 32 }}>{children}</div>

function VolumeSheet() {
  const vol = useData(s => s.audio?.volume ?? 0)
  const [v, setV] = useState<number | null>(null)
  return (<><H>Volume</H><Pill value={v ?? vol} width={Math.min(innerWidth - 48, 380)} height={52} label="Volume" icon={<Volume2 size={18} />} text={`${Math.round((v ?? vol) * 100)}%`} onChange={x => { setV(x); void bridge.call('audio.setVolume', { level: x }).catch(() => undefined) }} onCommit={() => setV(null)} /></>)
}

function TimerSheet({ done }: { done: () => void }) {
  const f = useFocus()
  const go = (m: number) => { f.start(m); void native('reminder.set', { id: 'timer', inMs: m * 60_000, title: 'Timer done', text: `${m} min are up` }); notice(`Timer set for ${m} min`); done() }
  const [c, setC] = useState('')
  return (<><H>Timer</H><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{[1, 5, 10, 15, 25, 45].map(m => <button key={m} onClick={() => { haptic(); go(m) }} style={pill()}>{m} min</button>)}</div>
    <div style={{ display: 'flex', gap: 8 }}><input value={c} onChange={e => setC(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="Other, in minutes" inputMode="numeric" style={field} /><button disabled={!+c} onClick={() => go(+c)} style={{ ...pill(true), opacity: +c ? 1 : 0.45 }}>Start</button></div></>)
}

interface Contact { name: string; numbers: { number: string; type?: string }[] }
function CallSheet() {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Contact[] | null>(null)
  const [msg, setMsg] = useState('')
  const [pick, setPick] = useState<{ name: string; number: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    clearTimeout(timer.current)
    if (q.trim().length < 2) { setRes(null); setMsg(''); return }
    timer.current = setTimeout(async () => {
      const r = await native('contacts.search', { query: q.trim(), limit: 6 })
      if (Array.isArray(r)) { setRes(r); setMsg(r.length ? '' : 'No contact found') }
      else { setRes(null); const p = needsPerm(r); setMsg(p ? 'Lokey needs the Contacts permission.' : r?.reason ?? 'Could not search contacts'); if (p) void native('perm.request', { name: p }) }
    }, 250)
    return () => clearTimeout(timer.current)
  }, [q])
  return (
    <>
      <H>Call or message</H>
      {pick ? (
        <>
          <div style={{ fontSize: 15 }}><b>{pick.name}</b> <span style={{ color: 'var(--muted)' }}>{pick.number}</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button onClick={() => { haptic(); void native('intent.dial', { number: pick.number }) }} style={pill(true)}><Phone size={16} />Call</button>
            <button onClick={() => { haptic(); void native('intent.sms', { number: pick.number, text: '' }) }} style={pill()}><MessageSquare size={16} />Message</button>
          </div>
          <button onClick={() => setPick(null)} style={{ ...pill(), background: 'transparent', color: 'var(--muted)' }}>Back</button>
        </>
      ) : (
        <>
          <div style={{ position: 'relative' }}><Search size={16} color="var(--muted)" style={{ position: 'absolute', left: 16, top: 18 }} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Name" autoComplete="off" style={{ ...field, paddingLeft: 42 }} /></div>
          {msg && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{msg}</div>}
          {res?.map(c => c.numbers.map(n => <button key={c.name + n.number} onClick={() => setPick({ name: c.name, number: n.number })} style={row}><span style={{ flex: 1, minWidth: 0 }}><b style={{ display: 'block', fontSize: 15 }}>{c.name}</b><span style={{ fontSize: 12, color: 'var(--muted)' }}>{n.number}{n.type ? ` · ${n.type}` : ''}</span></span></button>))}
        </>
      )}
    </>
  )
}

function NavSheet({ done }: { done: () => void }) {
  const [q, setQ] = useState('')
  const go = () => { if (q.trim()) { haptic(); void native('intent.maps', { query: q.trim(), navigate: true }); done() } }
  return (<><H>Navigate to…</H><input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} placeholder="Place or address" enterKeyHint="go" style={field} /><button disabled={!q.trim()} onClick={go} style={{ ...pill(true), opacity: q.trim() ? 1 : 0.45 }}><MapPin size={16} />Start</button></>)
}

function ReminderSheet({ done }: { done: () => void }) {
  const [text, setText] = useState('')
  const [ms, setMs] = useState(30 * 60_000)
  const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.getTime() - Date.now() }
  const OPTS: [string, number][] = [['10 min', 10 * 60_000], ['30 min', 30 * 60_000], ['1 hour', 3600_000], ['Tomorrow 9:00', tomorrow()]]
  const save = async () => {
    if (!text.trim()) return
    haptic()
    const r = await native('reminder.set', { inMs: ms, title: text.trim(), text: text.trim() })
    notice(r?.ok === false ? `Could not set the reminder: ${r.reason}` : `Reminder set: ${text.trim()}`, r?.ok === false ? 'error' : 'info')
    done()
  }
  return (
    <>
      <H>Remind me</H>
      <input autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save() }} placeholder="What?" style={field} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{OPTS.map(([l, v]) => <button key={l} onClick={() => setMs(v)} style={pill(Math.abs(ms - v) < 1000 || ms === v)}>{l}</button>)}</div>
      <button disabled={!text.trim()} onClick={() => void save()} style={{ ...pill(true), opacity: text.trim() ? 1 : 0.45 }}><Check size={16} />Set reminder</button>
    </>
  )
}
