import { useEffect, useRef, useState } from 'react'

// #confirm page: the "are you sure?" card for assistant actions that change things outside the app. A black pill like
// the caption bar, with Allow / Deny and a thin countdown. Only a click on these two buttons can answer.
type Req = { id: string; title: string; detail: string; tool: string; timeoutMs: number }

const CSS = `
html, body, #root { background: transparent !important; margin: 0; overflow: hidden; }
@keyframes lk-in { from { opacity: 0; transform: translateY(14px) scale(.96); filter: blur(6px) } to { opacity: 1; transform: none; filter: blur(0) } }
.lk-btn { all: unset; box-sizing: border-box; cursor: pointer; padding: 8px 18px; border-radius: 14px; font-size: 13px; font-weight: 600; transition: transform .12s, background-color .15s; }
.lk-btn:active { transform: scale(.96); }
`

export function ConfirmApp() {
  const [req, setReq] = useState<Req | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    window.lokeyConfirm?.onRequest(r => setReq(r))
    window.lokeyConfirm?.ready()
  }, [])
  useEffect(() => {
    if (!req || !bar.current) return
    const el = bar.current
    el.style.transition = 'none'; el.style.transform = 'scaleX(1)'
    void el.offsetWidth
    el.style.transition = `transform ${req.timeoutMs}ms linear`; el.style.transform = 'scaleX(0)'
  }, [req])

  if (!req) return <style>{CSS}</style>
  const answer = (ok: boolean) => window.lokeyConfirm?.answer(req.id, ok)
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Segoe UI Variable Text", "Segoe UI", Nirmala UI, Inter, system-ui, sans-serif' }}>
      <style>{CSS}</style>
      <div style={{ width: 400, boxSizing: 'border-box', padding: '16px 18px 14px', borderRadius: 24, background: '#0a0a0b', color: '#fff', boxShadow: '0 18px 40px -10px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.1)', animation: 'lk-in .38s cubic-bezier(.22,1,.36,1) both', overflow: 'hidden', position: 'relative' }}>
        <div style={{ fontSize: 9.5, letterSpacing: '.14em', textTransform: 'uppercase', opacity: 0.5, marginBottom: 6 }}>Lokey wants to</div>
        <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>{req.title}</div>
        {req.detail && <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.45, opacity: 0.68, maxHeight: 64, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{req.detail}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="lk-btn" onClick={() => answer(false)} style={{ background: 'rgba(255,255,255,.1)', color: '#fff' }}>Deny</button>
          <button className="lk-btn" onClick={() => answer(true)} style={{ background: '#fff', color: '#0a0a0b' }}>Allow</button>
        </div>
        <div ref={bar} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2.5, background: '#62b6ff', transformOrigin: 'left', opacity: 0.8 }} />
      </div>
    </div>
  )
}
