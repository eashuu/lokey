import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Loader2, Mic, MessagesSquare, Send, Square, X } from 'lucide-react'
import type { AgentTask } from '@shared/voice'
import { bridge } from '@/bridge'
import { haptic } from '@/lib/platform'
import { answerConfirm, sendText, useChat } from './chat'
import { QuickChips } from './quick'
import { BgPreviewCard } from './ShizukuSettings'
import { Spirit } from './spirit'

const SUGGEST = ['What can you do?', 'Set a timer for 10 minutes', 'Play some music', 'Who messaged me?']
const STATUS: Record<string, string> = { idle: 'Hold the button and talk', connecting: 'Connecting…', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Speaking…', error: 'Something went wrong' }

/** the "are you sure?" card of the assistant (ConfirmApp's content), as a card in the page */
export function ConfirmCard({ id, title, detail, timeoutMs, image }: { id: string; title: string; detail: string; timeoutMs: number; image?: string }) {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bar.current
    if (!el) return
    el.style.transition = 'none'; el.style.transform = 'scaleX(1)'
    void el.offsetWidth
    el.style.transition = `transform ${timeoutMs}ms linear`; el.style.transform = 'scaleX(0)'
    const t = setTimeout(() => answerConfirm(id, false), timeoutMs + 400) // the core times out on its own; this only tidies the card
    return () => clearTimeout(t)
  }, [id, timeoutMs])
  const b = { height: 48, borderRadius: 24, fontSize: 15, fontWeight: 600 } as const
  return (
    <div role="alertdialog" aria-label={title} style={{ position: 'relative', overflow: 'hidden', padding: '14px 16px 18px', borderRadius: 28, background: '#000', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.1)' }}>
      <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#f5a524', marginBottom: 6 }}>Lokey wants to</div>
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}>{title}</div>
      {detail && <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45, opacity: 0.68, maxHeight: 76, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{detail}</div>}
      {image && <img src={`data:image/jpeg;base64,${image}`} alt="What the second screen shows now" style={{ display: 'block', marginTop: 10, maxHeight: 220, maxWidth: '100%', borderRadius: 14, background: '#111' }} />}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
        <button onClick={() => { haptic(); answerConfirm(id, false) }} style={{ ...b, background: 'rgba(255,255,255,.1)', color: '#fff' }}>Deny</button>
        <button onClick={() => { haptic('heavy'); answerConfirm(id, true) }} style={{ ...b, background: '#f5a524', color: '#2a1800' }}>Allow</button>
      </div>
      <div ref={bar} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: '#f5a524', transformOrigin: 'left', opacity: 0.8 }} />
    </div>
  )
}

/** the dictation overlay's content: what is being heard, then the cleaned-up sentence to copy */
function DictationCard() {
  const d = useChat(s => s.dictation)
  const set = useChat(s => s.setDictation)
  if (!d) return null
  return (
    <div style={{ padding: '12px 14px', borderRadius: 24, background: 'var(--fill-2)', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        {d.phase === 'working' || d.phase === 'listening' ? <Loader2 size={13} className="ph-spin" /> : <Check size={13} />}
        Dictation
        <button aria-label="Dismiss" onClick={() => set(null)} style={{ marginLeft: 'auto', width: 44, height: 44, margin: '-12px -10px -12px auto', display: 'grid', placeItems: 'center' }}><X size={16} /></button>
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.45, color: d.phase === 'error' ? 'var(--warn)' : 'var(--text)', userSelect: 'text' }}>
        {d.phase === 'listening' ? (d.raw || 'Listening…') : d.phase === 'working' ? 'Cleaning it up…' : d.text}
      </div>
      {d.phase === 'done' && (
        <button onClick={() => { haptic(); void navigator.clipboard?.writeText(d.text).catch(() => undefined) }} style={{ height: 48, borderRadius: 24, background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Copy size={15} />Copy</button>
      )}
    </div>
  )
}

function useJobs() {
  const [jobs, setJobs] = useState<AgentTask[]>([])
  useEffect(() => { void bridge.agents.list().then(setJobs).catch(() => undefined); return bridge.agents.onChange(setJobs) }, [])
  return jobs
}

function JobChips() {
  const jobs = useJobs().filter(j => j.status === 'running')
  if (!jobs.length) return null
  return (
    <div className="scroll-x" style={{ display: 'flex', gap: 8, padding: '0 16px', flex: 'none' }}>
      {jobs.map(j => (
        <div key={j.id} style={{ flex: 'none', maxWidth: 280, display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 0 12px', minHeight: 48, borderRadius: 24, background: 'color-mix(in srgb, var(--accent) 14%, transparent)' }}>
          <Loader2 size={14} className="ph-spin" color="var(--accent)" style={{ flex: 'none' }} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.title}</span>
            {j.line && <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.line}</span>}
          </span>
          <button aria-label={`Stop ${j.title}`} onClick={() => bridge.agents.stop(j.id)} style={{ width: 44, height: 44, borderRadius: 22, display: 'grid', placeItems: 'center', flex: 'none' }}><X size={15} /></button>
        </div>
      ))}
    </div>
  )
}

export function Home() {
  const state = useChat(s => s.state)
  const convo = useChat(s => s.convo)
  const msgs = useChat(s => s.msgs)
  const confirms = useChat(s => s.confirms)
  const [text, setText] = useState('')
  const [down, setDown] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const longTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const holding = useRef(false)
  const talking = down || state === 'listening'

  useEffect(() => { const el = list.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) }, [msgs, confirms.length])
  useEffect(() => () => clearTimeout(longTimer.current), [])

  const submit = () => { if (text.trim()) { haptic(); sendText(text); setText('') } }
  const press = (on: boolean) => { setDown(on); bridge.voice.hold(on) }
  const toggleConvo = () => { haptic('heavy'); bridge.voice.toggleConversation(); useChat.setState(s => ({ convo: !s.convo })) } // the 'convo' event confirms it
  // the spirit: tap = poke (hop, squeak, heart), long-press = hold to talk
  const heroDown = () => { holding.current = false; clearTimeout(longTimer.current); longTimer.current = setTimeout(() => { holding.current = true; haptic('heavy'); press(true) }, 420) }
  const heroUp = () => { clearTimeout(longTimer.current); if (holding.current) { holding.current = false; press(false) } }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div onPointerDown={heroDown} onPointerUp={heroUp} onPointerCancel={heroUp} onContextMenu={e => e.preventDefault()} style={{ flex: 'none', alignSelf: 'center', touchAction: 'manipulation', WebkitTouchCallout: 'none' }}>
        <Spirit size={Math.round(Math.min(innerHeight * 0.26, 230))} poke emotes />
      </div>
      <div role="status" aria-live="polite" style={{ flex: 'none', textAlign: 'center', fontSize: 13, color: state === 'error' ? 'var(--warn)' : 'var(--muted)', padding: '0 16px 8px' }}>{convo && state === 'idle' ? 'Conversation mode: just talk' : STATUS[state]}</div>
      <JobChips />
      <BgPreviewCard />

      <div ref={list} className="scroll-y" style={{ flex: 1, minHeight: 0, padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8, touchAction: 'pan-y' }}>
        {msgs.length === 0 && confirms.length === 0 && (
          <div style={{ margin: 'auto', display: 'grid', gap: 10, justifyItems: 'center', textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--muted)', maxWidth: 280, lineHeight: 1.5 }}>Hold the mic and talk, or type. Poke the spirit, long-press it to talk. The island at the top works from any app.</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {SUGGEST.map(t => <button key={t} onClick={() => sendText(t)} style={{ minHeight: 44, padding: '0 14px', borderRadius: 22, background: 'var(--fill-2)', fontSize: 13, color: 'var(--soft)' }}>{t}</button>)}
            </div>
          </div>
        )}
        {msgs.map(m => m.kind === 'notice' || m.kind === 'error' ? (
          <div key={m.id} style={{ alignSelf: 'center', fontSize: 12, color: m.kind === 'error' ? 'var(--warn)' : 'var(--muted)', textAlign: 'center', padding: '2px 12px' }}>{m.text}</div>
        ) : (
          <div key={m.id} style={{ alignSelf: m.kind === 'said' ? 'flex-end' : 'flex-start', maxWidth: '84%', padding: '10px 14px', borderRadius: 22, borderBottomRightRadius: m.kind === 'said' ? 6 : 22, borderBottomLeftRadius: m.kind === 'reply' ? 6 : 22,
            fontSize: 15, lineHeight: 1.4, userSelect: 'text', wordBreak: 'break-word', opacity: m.final ? 1 : 0.8,
            background: m.kind === 'said' ? 'var(--accent)' : 'var(--fill-2)', color: m.kind === 'said' ? 'var(--accent-ink)' : 'var(--text)' }}>{m.text}</div>
        ))}
        {confirms.map(c => <ConfirmCard key={c.id} {...c} />)}
        <DictationCard />
      </div>

      <div style={{ flex: 'none', padding: '6px 0 10px', display: 'grid', gap: 10, background: 'linear-gradient(transparent, color-mix(in srgb, var(--bg) 92%, transparent) 18%)' }}>
        <QuickChips />
        <div style={{ padding: '0 12px', display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 52, padding: '0 6px 0 18px', borderRadius: 26, background: 'var(--fill-2)' }}>
            <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} placeholder="Ask or tell me something…" enterKeyHint="send" autoComplete="off" autoCapitalize="sentences"
              style={{ flex: 1, minWidth: 0, height: 48, background: 'none', border: 0, outline: 'none', color: 'var(--text)', font: 'inherit', fontSize: 16, userSelect: 'text' }} />
            <button aria-label="Send" onClick={submit} disabled={!text.trim()} style={{ width: 44, height: 44, borderRadius: 22, display: 'grid', placeItems: 'center', background: text.trim() ? 'var(--accent)' : 'transparent', color: text.trim() ? 'var(--accent-ink)' : 'var(--muted)' }}><Send size={18} /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button aria-label="Conversation mode" aria-pressed={convo} onClick={toggleConvo} style={{ width: 56, height: 56, borderRadius: 28, flex: 'none', display: 'grid', placeItems: 'center', background: convo ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'var(--fill-2)', color: convo ? 'var(--accent)' : 'var(--soft)' }}><MessagesSquare size={22} /></button>
            <button aria-label="Hold to talk"
              onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); haptic('heavy'); press(true) }}
              onPointerUp={() => press(false)} onPointerCancel={() => press(false)} onContextMenu={e => e.preventDefault()}
              style={{ flex: 1, height: 64, borderRadius: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 16, fontWeight: 600, touchAction: 'none', WebkitTouchCallout: 'none',
                background: talking ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 22%, var(--fill-2))', color: talking ? 'var(--accent-ink)' : 'var(--text)', transform: talking ? 'scale(.97)' : 'none', transition: 'transform .12s, background-color .15s' }}>
              <Mic size={22} />{talking ? 'Listening…' : 'Hold to talk'}
            </button>
            <button aria-label="Stop everything" onClick={() => { haptic(); bridge.agents.stop('all') }} style={{ width: 56, height: 56, borderRadius: 28, flex: 'none', display: 'grid', placeItems: 'center', background: 'var(--fill-2)', color: 'var(--soft)' }}><Square size={18} fill="currentColor" /></button>
          </div>
        </div>
      </div>
    </div>
  )
}
