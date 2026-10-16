import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Bell, Check, Flashlight, Loader2, MessageSquare, Mic, Monitor, Pause, Play, Send, SkipBack, SkipForward, Square, Timer, Volume2, X } from 'lucide-react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { useClock } from '@/lib/clock'
import { useFocus } from '@/lib/focus'
import { clamp, mmss } from '@/lib/format'
import { mediaControl, mediaSeek, useMediaPosition } from '@/lib/media'
import { haptic } from '@/lib/platform'
import { describeWeather, useWeather } from '@/lib/weather'
import { useLyrics } from '@/lyrics/useLyrics'
import { Pill } from '@/tabs/controls/Pill'
import { FullRing } from '@/tabs/stats/Ring'
import { clearDue, focusPlusMinute, snoozeLater, useActivities, useIsl, type Kind } from './activities'
import { answerConfirm, useChat } from './chat'
import { linkSay, native } from './native'
import { usePage } from './nav'
import { Spirit } from './spirit'

// The expanded cards of the island: black, 28 px corners, white small type. Each is one activity; the capsule above them is the face.
export const CARD_W = () => Math.min(innerWidth - 24, 380)
const soft = 'rgba(255,255,255,.62)'
const fill = 'rgba(255,255,255,.1)'
const pad: CSSProperties = { padding: '52px 16px 16px', display: 'grid', gap: 12 }
const ell: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

export function Btn({ children, onClick, kind = 'soft', disabled, label, style }: { children: ReactNode; onClick?: () => void; kind?: 'soft' | 'accent' | 'warn' | 'plain'; disabled?: boolean; label?: string; style?: CSSProperties }) {
  const bg = kind === 'accent' ? 'var(--accent)' : kind === 'warn' ? '#f5a524' : kind === 'plain' ? 'transparent' : fill
  const color = kind === 'accent' ? 'var(--accent-ink)' : kind === 'warn' ? '#2a1800' : '#fff'
  return (
    <button aria-label={label} disabled={disabled} onClick={() => { haptic(); onClick?.() }} className="ih-btn"
      style={{ minHeight: 48, padding: '0 16px', borderRadius: 24, fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: bg, color, opacity: disabled ? 0.45 : 1, ...style }}>{children}</button>
  )
}

/** activity chips along the top of an expanded card (the dots of the compact capsule, made tappable) */
const ICON: Record<Kind, ReactNode> = {
  approval: <i style={{ width: 8, height: 8, borderRadius: 4, background: '#f5a524' }} />, voice: <Mic size={14} />, timer: <Timer size={14} />, job: <Loader2 size={14} />, music: <Volume2 size={14} />,
  reminder: <Bell size={14} />, charging: <i style={{ width: 8, height: 8, borderRadius: 4, background: '#8ed92f' }} />, pc: <Monitor size={14} />, idle: <i style={{ width: 8, height: 8, borderRadius: 4, background: '#fff' }} />,
}
export function Chips({ list, face, onPick, onClose }: { list: Kind[]; face: Kind; onPick: (k: Kind) => void; onClose: () => void }) {
  return (
    <div data-nogest style={{ position: 'absolute', left: 10, right: 10, top: 6, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', gap: 4, pointerEvents: 'auto' }}>
        {list.length > 1 && list.map(k => (
          <button key={k} aria-label={k} aria-pressed={k === face} onClick={() => { haptic(); onPick(k) }} style={{ width: 40, height: 36, borderRadius: 18, display: 'grid', placeItems: 'center', background: k === face ? fill : 'transparent', color: k === face ? '#fff' : soft }}>{ICON[k]}</button>
        ))}
      </div>
      <button aria-label="Close" onClick={onClose} style={{ width: 40, height: 36, borderRadius: 18, display: 'grid', placeItems: 'center', color: soft, pointerEvents: 'auto' }}><X size={16} /></button>
    </div>
  )
}

// ---- idle: the quick card --------------------------------------------------------------------------------------------
let torchOn = false
export function IdleCard({ close }: { close: () => void }) {
  const now = useClock()
  const w = useWeather()
  const wx = w ? describeWeather(w.code, w.isDay) : null
  const vol = useData(s => s.audio?.volume ?? 0)
  const [slider, setSlider] = useState(false)
  const [torch, setTorch] = useState(torchOn)
  const [v, setV] = useState<number | null>(null)
  const go = usePage(s => s.go)
  const f = useFocus()
  const tile = (icon: ReactNode, label: string, on: boolean, fn: () => void) => (
    <button onClick={() => { haptic(); fn() }} aria-pressed={on} style={{ minHeight: 64, borderRadius: 20, display: 'grid', placeItems: 'center', gap: 2, alignContent: 'center', background: on ? 'var(--accent)' : fill, color: on ? 'var(--accent-ink)' : '#fff', fontSize: 11, fontWeight: 600 }}>{icon}{label}</button>
  )
  return (
    <div style={pad}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Spirit size={56} face emotes />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="num" style={{ fontSize: 28, fontWeight: 500, lineHeight: 1.1 }}>{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
          <div style={{ fontSize: 12, color: soft }}>{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</div>
        </div>
        {wx && <div style={{ textAlign: 'right', fontSize: 12, color: soft }}><wx.Icon size={22} color="#F2C94C" strokeWidth={1.6} /><div style={{ color: '#fff', fontSize: 16 }}>{Math.round(w!.temp)}°</div></div>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {tile(<Mic size={20} />, 'Talk', false, () => { close(); go('home') })}
        {tile(<Flashlight size={20} />, 'Torch', torch, () => { torchOn = !torchOn; setTorch(torchOn); void native('flashlight.set', { on: torchOn }) })}
        {tile(<Timer size={20} />, f.status === 'idle' ? '5 min' : 'Timer', f.status !== 'idle', () => { if (f.status === 'idle') f.start(5) })}
        {tile(<Volume2 size={20} />, 'Volume', slider, () => setSlider(s => !s))}
      </div>
      {slider && <div data-nogest><Pill value={v ?? vol} width={CARD_W() - 32} height={44} label="Volume" icon={<Volume2 size={16} />} text={`${Math.round((v ?? vol) * 100)}%`}
        onChange={x => { setV(x); void bridge.call('audio.setVolume', { level: x }).catch(() => undefined) }} onCommit={() => setV(null)} /></div>}
    </div>
  )
}

// ---- voice -----------------------------------------------------------------------------------------------------------
const STATUS: Record<string, string> = { idle: 'Listening for you', connecting: 'Connecting…', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…', error: 'Something went wrong' }
export function VoiceCard() {
  const state = useChat(s => s.state)
  const convo = useChat(s => s.convo)
  const msgs = useChat(s => s.msgs)
  const dict = useChat(s => s.dictation)
  const last = [...msgs].reverse().find(m => m.kind === 'said' || m.kind === 'reply')
  const [down, setDown] = useState(false)
  const talking = down || state === 'listening'
  return (
    <div style={pad}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Spirit size={64} face emotes />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{dict && dict.phase !== 'done' ? 'Dictating…' : STATUS[state] ?? state}</div>
          <div style={{ fontSize: 12, color: soft }}>{convo ? 'Conversation mode is on' : 'Hold the button to talk'}</div>
        </div>
      </div>
      {(last || dict) && <div style={{ fontSize: 14, lineHeight: 1.4, maxHeight: 84, overflow: 'hidden', color: last?.kind === 'said' ? soft : '#fff' }}>{dict?.phase === 'listening' ? dict.raw || '…' : last?.text}</div>}
      <div data-nogest style={{ display: 'grid', gridTemplateColumns: '56px 1fr 56px', gap: 8 }}>
        <Btn label="Conversation mode" onClick={() => { bridge.voice.toggleConversation(); useChat.setState(s => ({ convo: !s.convo })) }} kind={convo ? 'accent' : 'soft'} style={{ minHeight: 56, padding: 0 }}><MessageSquare size={20} /></Btn>
        <button aria-label="Hold to talk" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); haptic('heavy'); setDown(true); bridge.voice.hold(true) }} onPointerUp={() => { setDown(false); bridge.voice.hold(false) }} onPointerCancel={() => { setDown(false); bridge.voice.hold(false) }} onContextMenu={e => e.preventDefault()}
          style={{ minHeight: 56, borderRadius: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 15, fontWeight: 600, touchAction: 'none', background: talking ? 'var(--accent)' : fill, color: talking ? 'var(--accent-ink)' : '#fff' }}><Mic size={20} />{talking ? 'Listening…' : 'Hold to talk'}</button>
        <Btn label="Stop everything" onClick={() => bridge.agents.stop('all')} style={{ minHeight: 56, padding: 0 }}><Square size={16} fill="currentColor" /></Btn>
      </div>
    </div>
  )
}

// ---- music -----------------------------------------------------------------------------------------------------------
export function MusicCard({ close }: { close: () => void }) {
  const { media, playing, pos, dur } = useMediaPosition()
  const { lyrics } = useLyrics()
  const [drag, setDrag] = useState<number | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  if (!media?.hasSession) return <div style={{ ...pad, color: soft, fontSize: 14 }}>Nothing playing.</div>
  const frac = clamp(drag ?? (dur ? pos / dur : 0), 0, 1)
  const at = (e: React.PointerEvent) => clamp((e.clientX - bar.current!.getBoundingClientRect().left) / bar.current!.getBoundingClientRect().width, 0, 1)
  const t = pos + (lyrics?.offsetMs ?? 0)
  const lines = lyrics?.state === 'ready' ? lyrics.lines : null
  let cur = ''
  if (lines) for (const l of lines) { if (l.t <= t) cur = l.text; else break }
  return (
    <div style={pad}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 60, height: 60, borderRadius: 14, overflow: 'hidden', background: fill, flex: 'none' }}>{media.art && <img src={media.art} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 600, ...ell }}>{media.title || 'Unknown title'}</div>
          <div style={{ fontSize: 13, color: soft, ...ell }}>{media.artist || media.app}</div>
        </div>
        <Spirit size={44} face emotes />
      </div>
      <div data-nogest>
        <div ref={bar} role="slider" aria-label="Seek" aria-valuenow={Math.round(frac * 100)} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(at(e)) }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setDrag(at(e)) }}
          onPointerUp={e => { mediaSeek(at(e) * dur); setDrag(null) }} onPointerCancel={() => setDrag(null)} style={{ height: 28, display: 'grid', alignItems: 'center', touchAction: 'none' }}>
          <div style={{ height: 4, borderRadius: 2, background: fill, overflow: 'hidden' }}><i style={{ display: 'block', height: '100%', width: `${frac * 100}%`, background: '#fff' }} /></div>
        </div>
        <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: soft }}><span>{mmss(drag != null ? drag * dur : pos)}</span><span>{mmss(dur)}</span></div>
      </div>
      <div data-nogest style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20 }}>
        <Btn label="Previous" kind="plain" disabled={!media.canPrev} onClick={() => mediaControl('prev')} style={{ width: 52, padding: 0 }}><SkipBack size={22} fill="currentColor" /></Btn>
        <Btn label={playing ? 'Pause' : 'Play'} kind="accent" onClick={() => mediaControl('toggle')} style={{ width: 64, height: 64, padding: 0, borderRadius: 32 }}>{playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" style={{ marginLeft: 3 }} />}</Btn>
        <Btn label="Next" kind="plain" disabled={!media.canNext} onClick={() => mediaControl('next')} style={{ width: 52, padding: 0 }}><SkipForward size={22} fill="currentColor" /></Btn>
      </div>
      <button data-nogest onClick={() => { close(); location.hash = '#lyrics' }} aria-label="Open lyrics" style={{ minHeight: 48, borderRadius: 18, background: fill, padding: '0 14px', textAlign: 'left', fontSize: 15, fontWeight: 600, ...ell, color: cur ? '#fff' : soft }}>{cur || (lyrics?.state === 'plain' ? 'Lyrics (not synced): tap to read' : lyrics ? 'No synced lyrics' : 'Finding lyrics…')}</button>
    </div>
  )
}

// ---- timer / focus -----------------------------------------------------------------------------------------------------
const p2 = (n: number) => String(n).padStart(2, '0')
export const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600); return `${h ? `${h}:` : ''}${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}` }
export function TimerCard() {
  const f = useFocus()
  const done = f.status === 'done'
  return (
    <div style={{ ...pad, justifyItems: 'center' }}>
      <FullRing value={done ? 100 : f.totalMs ? (f.remainingMs / f.totalMs) * 100 : 0} size={132} stroke={8} track="rgba(255,255,255,.12)" color={done ? '#8fd16a' : '#F5A524'}>
        <span className="num" style={{ fontSize: done ? 18 : 28, fontWeight: 500 }}>{done ? 'Done' : clock(f.remainingMs)}</span>
      </FullRing>
      <div data-nogest style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, width: '100%' }}>
        <Btn kind="warn" onClick={() => (f.status === 'running' ? f.pause() : f.start(Math.max(1, Math.round(f.totalMs / 60000))))} disabled={done}>{f.status === 'running' ? <><Pause size={16} />Pause</> : <><Play size={16} />Resume</>}</Btn>
        <Btn onClick={focusPlusMinute}>+1 min</Btn>
        <Btn onClick={f.reset}><Square size={14} fill="currentColor" />Stop</Btn>
      </div>
    </div>
  )
}

// ---- approval --------------------------------------------------------------------------------------------------------
export function ApprovalCard() {
  const confirms = useChat(s => s.confirms)
  const pcAsks = useIsl(s => s.pcAsks)
  const all = [...confirms.map(c => ({ id: c.id, title: c.title, detail: c.detail, pc: false, image: c.image, handoff: c.kind === 'handoff' })), ...pcAsks.map(c => ({ id: c.id, title: c.title, detail: c.detail, pc: true, image: undefined as string | undefined, handoff: false }))]
  const c = all[0]
  if (!c) return <div style={{ ...pad, color: soft, fontSize: 14 }}>Nothing to approve.</div>
  const answer = async (ok: boolean) => {
    if (c.pc) { await bridge.link.approve?.(c.id, ok).catch(() => false); useIsl.setState(s => ({ pcAsks: s.pcAsks.filter(x => x.id !== c.id) })) } else answerConfirm(c.id, ok)
  }
  return (
    <div style={pad}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Spirit size={52} face emotes />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#f5a524' }}>{c.pc ? 'Your PC asks' : 'Lokey wants to'}{all.length > 1 ? ` · 1 of ${all.length}` : ''}</div>
          <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}>{c.title}</div>
        </div>
      </div>
      {c.detail && <div style={{ fontSize: 13, lineHeight: 1.45, color: soft, maxHeight: 96, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.detail}</div>}
      {c.image && <img src={`data:image/jpeg;base64,${c.image}`} alt="What the second screen shows now" style={{ display: 'block', maxHeight: 200, maxWidth: '100%', borderRadius: 14, background: '#111', justifySelf: 'center' }} />}
      <div data-nogest style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Btn onClick={() => void answer(false)}>{c.handoff ? 'Skip' : 'Deny'}</Btn>
        <Btn kind="warn" onClick={() => void answer(true)}><Check size={16} />{c.handoff ? "I'm done" : 'Allow'}</Btn>
      </div>
    </div>
  )
}

// ---- background jobs -----------------------------------------------------------------------------------------------------
export function JobCard() {
  const jobs = useIsl(s => s.jobs).filter(j => j.status === 'running')
  return (
    <div style={pad}>
      {jobs.length === 0 && <div style={{ color: soft, fontSize: 14 }}>No jobs running.</div>}
      {jobs.map(j => (
        <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 6px 10px 14px', borderRadius: 20, background: fill }}>
          <Loader2 size={18} className="ph-spin" color="var(--accent)" style={{ flex: 'none' }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, ...ell }}>{j.title}</div>
            <div style={{ fontSize: 12, color: soft, ...ell }}>{j.line || `step ${j.steps}`}</div>
          </div>
          <Btn kind="plain" label={`Stop ${j.title}`} onClick={() => bridge.agents.stop(j.id)} style={{ width: 48, padding: 0 }}><X size={18} /></Btn>
        </div>
      ))}
      {jobs.length > 1 && <Btn onClick={() => bridge.agents.stop('all')}>Stop all</Btn>}
    </div>
  )
}

// ---- the PC ------------------------------------------------------------------------------------------------------------
type PcStatus = { pc: string; agent: string; battery?: unknown; nowPlaying?: { app: string; title: string; artist: string; playing: boolean } | null; jobs?: string[] } | null
export const batteryText = (b: unknown) => { const o = b as { pct?: number; charging?: boolean } | number | null | undefined; const n = typeof o === 'number' ? o : o?.pct; return typeof n === 'number' ? `${Math.round(n)}%${typeof o === 'object' && o?.charging ? ' charging' : ''}` : null }

export function usePcStatus(on = true) {
  const [st, setSt] = useState<PcStatus | undefined>(undefined)
  useEffect(() => {
    if (!on) return
    let live = true
    const load = () => void (bridge.link.pcStatus?.() ?? Promise.resolve(null)).then(s => { if (live) setSt(s) }).catch(() => { if (live) setSt(null) })
    load(); const t = setInterval(load, 5000)
    return () => { live = false; clearInterval(t) }
  }, [on])
  return st
}

export function AskPc({ compact }: { compact?: boolean }) {
  const [t, setT] = useState('')
  const [msg, setMsg] = useState('')
  const send = async (text: string) => { if (!text.trim()) return; setMsg('Sending…'); const r = await linkSay(text); setMsg(r.ok ? 'Sent to your PC' : r.error ?? 'Could not reach the PC'); if (r.ok) setT('') }
  return (
    <div data-nogest style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 48, padding: '0 6px 0 16px', borderRadius: 24, background: compact ? fill : 'var(--fill-2)' }}>
        <input value={t} onChange={e => setT(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void send(t) }} placeholder="Ask your PC…" enterKeyHint="send" autoComplete="off" style={{ flex: 1, minWidth: 0, height: 44, background: 'none', border: 0, outline: 'none', color: 'inherit', font: 'inherit', fontSize: 16, userSelect: 'text' }} />
        <button aria-label="Send to PC" onClick={() => void send(t)} disabled={!t.trim()} style={{ width: 44, height: 44, borderRadius: 22, display: 'grid', placeItems: 'center', background: t.trim() ? 'var(--accent)' : 'transparent', color: t.trim() ? 'var(--accent-ink)' : soft }}><Send size={18} /></button>
      </div>
      <Btn onClick={async () => { const r = await native('clipboard.read'); const text = typeof r === 'string' ? r : r?.text; if (!text) setMsg('The clipboard is empty (Android only lets Lokey read it while it is open)'); else void send(`From my phone's clipboard: ${text}`) }} style={{ minHeight: 44 }}>Send clipboard to PC</Btn>
      {msg && <div role="status" style={{ fontSize: 12, color: soft }}>{msg}</div>}
    </div>
  )
}

export function PcCard({ close }: { close: () => void }) {
  const pc = useIsl(s => s.pc)
  const st = usePcStatus()
  const go = usePage(s => s.go)
  const bat = batteryText(st?.battery)
  return (
    <div style={pad}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: fill, display: 'grid', placeItems: 'center' }}><Monitor size={22} /></div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, ...ell }}>{st?.pc || pc.name || 'Your PC'}</div>
          <div style={{ fontSize: 12, color: st ? '#8fd16a' : soft }}>{st === undefined ? 'Checking…' : st ? `Connected${st.agent ? ` · ${st.agent}` : ''}${bat ? ` · battery ${bat}` : ''}` : 'Not reachable (same Wi-Fi?)'}</div>
        </div>
        <Btn kind="plain" label="PC page" onClick={() => { close(); go('pc') }} style={{ padding: '0 8px', minHeight: 40, fontSize: 12 }}>Open</Btn>
      </div>
      {st?.nowPlaying && <div style={{ fontSize: 13, color: soft, ...ell }}>On the PC: <span style={{ color: '#fff' }}>{st.nowPlaying.title}</span> · {st.nowPlaying.artist}</div>}
      <AskPc compact />
    </div>
  )
}

// ---- reminders / nudges ----------------------------------------------------------------------------------------------------
export function ReminderCard() {
  const due = useIsl(s => s.due)
  const d = due[0]
  if (!d) return <div style={{ ...pad, color: soft, fontSize: 14 }}>Nothing due.</div>
  const done = () => { clearDue(d.id); if (d.loopId) void bridge.voice.loopSet(d.loopId, 'done') }
  const snooze = () => { snoozeLater(d, 10 * 60_000); if (d.loopId) void bridge.voice.loopSet(d.loopId, 'snooze'); else void native('reminder.set', { inMs: 10 * 60_000, title: d.title, text: d.text ?? d.title }) }
  return (
    <div style={pad}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Spirit size={52} face emotes />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: soft }}>{d.kind === 'loop' ? 'You said you would' : d.kind === 'nudge' ? 'From your PC' : 'Reminder'}{due.length > 1 ? ` · 1 of ${due.length}` : ''}</div>
          <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3 }}>{d.title}</div>
          {d.text && <div style={{ fontSize: 13, color: soft }}>{d.text}</div>}
        </div>
      </div>
      <div data-nogest style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><Btn onClick={snooze}>Snooze 10 min</Btn><Btn kind="accent" onClick={done}><Check size={16} />Done</Btn></div>
    </div>
  )
}

/** the card for the activity that is the capsule's face */
export function CardFor({ kind, close }: { kind: Kind; close: () => void }) {
  switch (kind) {
    case 'voice': return <VoiceCard />
    case 'music': return <MusicCard close={close} />
    case 'timer': return <TimerCard />
    case 'approval': return <ApprovalCard />
    case 'job': return <JobCard />
    case 'pc': return <PcCard close={close} />
    case 'reminder': return <ReminderCard />
    default: return <IdleCard close={close} />
  }
}
export { useActivities }
