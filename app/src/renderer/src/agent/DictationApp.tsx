import { useEffect, useRef, useState } from 'react'
import type { DictationEvent } from '@shared/voice'

// #dictation page (whole display, transparent, click-through): a black pill with five blue bars sitting on the bottom
// edge of the focused field, and a white bubble above it that streams the raw transcript, rewrites itself into the clean
// sentence on release (dropped words collapse, corrections appear) and then the pill turns into a check.
type Phase = 'listening' | 'working' | 'cleaning' | 'done' | 'error'
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

const CSS = `
html, body, #root { background: transparent !important; margin: 0; overflow: hidden; }
@keyframes lk-word { from { opacity: 0; transform: translateY(6px); filter: blur(6px) } to { opacity: 1; transform: none; filter: blur(0) } }
@keyframes lk-in { from { opacity: 0; transform: translateY(8px) scale(.96); filter: blur(5px) } to { opacity: 1; transform: none; filter: blur(0) } }
.lk-w { display: inline-block; white-space: pre; max-width: 30em; transition: opacity .42s ease, max-width .5s ease .06s, filter .42s ease, margin .5s ease; }
.lk-w.gone { opacity: 0; max-width: 0; filter: blur(5px); margin-right: -.28em; overflow: hidden; }
.lk-w.fresh { animation: lk-word .38s cubic-bezier(.22,1,.36,1) both; }
`

/** which raw words survive the cleanup (in-order match against the clean sentence) */
function kept(raw: string[], clean: string[]): boolean[] {
  let j = 0
  return raw.map(w => {
    const n = norm(w)
    if (!n) return false
    for (let k = j; k < clean.length; k++) if (norm(clean[k]) === n) { j = k + 1; return true }
    return false
  })
}

export function DictationApp() {
  const [phase, setPhase] = useState<Phase | null>(null)
  const [rect, setRect] = useState({ x: 0, y: 0, w: 300, h: 40 })
  const [raw, setRaw] = useState('')
  const [clean, setClean] = useState('')
  const [msg, setMsg] = useState('')
  const [collapse, setCollapse] = useState(false)
  const [final, setFinal] = useState(false)
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const level = useRef(0)

  useEffect(() => {
    window.lokeyOverlay?.on('dictation', (d: DictationEvent) => {
      if (d.type === 'start') { setRect(d.rect ?? { x: 0, y: 0, w: 300, h: 40 }); setRaw(''); setClean(''); setMsg(''); setCollapse(false); setFinal(false); setPhase('listening') }
      else if (d.type === 'raw' || d.type === 'partial') setRaw(d.text ?? '')
      else if (d.type === 'working') { setRaw(''); setPhase('working') }
      else if (d.type === 'level') level.current = d.v ?? 0
      else if (d.type === 'clean') {
        setClean(d.text ?? ''); setPhase('cleaning'); setCollapse(false); setFinal(false)
        setTimeout(() => setCollapse(true), 60)
        setTimeout(() => setFinal(true), 760)
      } else if (d.type === 'done') setPhase('done')
      else if (d.type === 'error') { setMsg(d.text ?? ''); setPhase('error') }
      else if (d.type === 'cancel') setPhase(null)
    })
    window.lokeyOverlay?.ready('dictation')
  }, [])

  // voice bars: one rAF loop, only while listening
  useEffect(() => {
    if (phase !== 'listening') return
    let raf = 0
    let sm = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      sm += (level.current - sm) * 0.3
      bars.current.forEach((el, i) => {
        if (!el) return
        const wob = 0.55 + 0.45 * Math.sin((now - t0) / 140 + i * 1.4)
        el.style.height = `${3.5 + Math.min(1, sm * 1.6) * 11 * wob * [0.6, 0.85, 1, 0.85, 0.6][i]}px`
      })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  if (!phase) return <style>{CSS}</style>
  const vw = window.innerWidth
  const cx = Math.max(200, Math.min(vw - 200, rect.x + rect.w / 2))
  const below = rect.y < 130
  const rawWords = raw.split(' ').filter(Boolean)
  const cleanWords = clean.split(' ').filter(Boolean)
  const keep = phase === 'cleaning' ? kept(rawWords, cleanWords) : []
  const showBubble = phase !== 'done' && (raw || clean || msg)

  return (
    <div style={{ position: 'fixed', inset: 0, fontFamily: '"Segoe UI Variable Text", "Segoe UI", "Nirmala UI", Inter, system-ui, sans-serif' }}>
      <style>{CSS}</style>
      {showBubble && (
        <div style={{ position: 'absolute', left: cx, transform: 'translateX(-50%)', maxWidth: Math.min(400, vw - 40), width: 'max-content', ...(below ? { top: rect.y + rect.h + 24 } : { bottom: window.innerHeight - rect.y + 14 }) }}>
        <div
          style={{
            padding: '10px 16px 11px', borderRadius: 16, fontSize: 13, lineHeight: 1.45, color: phase === 'error' ? '#8a2b1f' : '#16181d',
            background: 'rgba(255,255,255,.97)', boxShadow: '0 16px 36px -10px rgba(15,23,42,.4), 0 1px 2px rgba(15,23,42,.2), inset 0 1.2px 0 #fff',
            animation: 'lk-in .38s cubic-bezier(.22,1,.36,1) both', fontWeight: phase === 'cleaning' && final ? 500 : 400,
          }}
        >
          {phase === 'error' ? msg
            : phase === 'cleaning' && final ? cleanWords.map((w, i) => <span key={'c' + i} className="lk-w" style={{ transition: 'none' }}>{w}{' '}</span>)
            : phase === 'working' ? rawWords.map((w, i) => <span key={i + ':' + w} className="lk-w fresh">{w}{' '}</span>)
            : phase === 'cleaning' ? rawWords.map((w, i) => <span key={'r' + i + w} className={`lk-w${collapse && !keep[i] ? ' gone' : ''}`}>{w}{' '}</span>)
            : rawWords.map((w, i) => <span key={i + ':' + w} className="lk-w fresh">{w}{' '}</span>)}
        </div>
        </div>
      )}
      {phase !== 'error' && (
        <div style={{ position: 'absolute', left: Math.max(30, Math.min(vw - 30, rect.x + rect.w / 2)), top: rect.y + rect.h, transform: 'translate(-50%, -50%)' }}>
        <div
          style={{
            width: 54, height: 24, borderRadius: 12,
            background: '#0a0a0b', boxShadow: '0 6px 16px -4px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
            animation: 'lk-in .3s cubic-bezier(.22,1,.36,1) both',
          }}
        >
          {phase === 'done' ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7" /></svg>
          ) : phase === 'cleaning' || phase === 'working' ? (
            [0, 1, 2].map(i => <span key={i} style={{ width: 4, height: 4, borderRadius: 2, background: '#7cc4ff', opacity: 0.4 + 0.6 * ((i + 1) / 3) }} />)
          ) : (
            [0, 1, 2, 3, 4].map(i => <span key={i} ref={el => { bars.current[i] = el }} style={{ width: 2.6, height: 3.5, borderRadius: 2, background: '#62b6ff' }} />)
          )}
        </div>
        </div>
      )}
    </div>
  )
}
