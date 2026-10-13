import { useEffect, useState } from 'react'

// #caption page: the speech pills at the bottom of the screen. White "YOU" pill = what you said (streams in word by
// word), black pill = what the assistant says or did. Fades out on `clear`. Transparent page; main owns the window.
type Msg = { kind: 'said' | 'reply' | 'notice' | 'clear'; text?: string; label?: string; tone?: 'info' | 'error' }

const CSS = `
html, body, #root { background: transparent !important; margin: 0; overflow: hidden; }
@keyframes lk-word { from { opacity: 0; transform: translateY(7px); filter: blur(7px) } to { opacity: 1; transform: none; filter: blur(0) } }
@keyframes lk-pill-in { from { opacity: 0; transform: translateY(14px) scale(.95); filter: blur(6px) } to { opacity: 1; transform: none; filter: blur(0) } }
.lk-pill { transition: background-color .25s linear, color .25s linear, opacity .3s linear, transform .3s cubic-bezier(.4,0,.6,1); }
`

export function CaptionApp() {
  const [m, setM] = useState<{ kind: 'said' | 'reply' | 'notice'; text: string; label: string; tone: string } | null>(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    window.lokeyOverlay?.on('caption', (d: Msg) => {
      if (d.kind === 'clear') { setShow(false); return }
      setM({ kind: d.kind, text: d.text ?? '', label: d.label ?? (d.kind === 'said' ? 'You' : 'Lokey'), tone: d.tone ?? 'info' })
      setShow(true)
    })
    window.lokeyOverlay?.ready('caption')
  }, [])

  const light = m?.kind === 'said'
  const words = (m?.text ?? '').split(' ').filter(Boolean)
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 52, boxSizing: 'border-box', fontFamily: '"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif' }}>
      <style>{CSS}</style>
      {m && (
        <div
          className="lk-pill"
          style={{
            maxWidth: 560, padding: '10px 20px 11px', borderRadius: 22, fontSize: 13.5, lineHeight: 1.4, textAlign: 'left', opacity: show ? 1 : 0, transform: show ? 'none' : 'translateY(8px) scale(.98)',
            background: light ? 'rgba(255,255,255,.97)' : '#0a0a0b', color: light ? '#16181d' : '#fff', fontWeight: light ? 400 : 500,
            boxShadow: light ? '0 10px 24px -8px rgba(15,23,42,.32), 0 1px 2px rgba(15,23,42,.16), inset 0 1.2px 0 #fff' : '0 10px 24px -8px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.08)',
            animation: 'lk-pill-in .4s cubic-bezier(.22,1,.36,1) both',
          }}
        >
          <span style={{ marginRight: 9, fontSize: 9, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 500, color: m.tone === 'error' && !light ? '#ffb86b' : 'currentColor', opacity: m.tone === 'error' ? 0.9 : 0.5, verticalAlign: 1 }}>{m.label}</span>
          {words.map((w, i) => (
            <span key={`${i}:${w}`} style={{ display: 'inline-block', whiteSpace: 'pre', animation: 'lk-word .38s cubic-bezier(.22,1,.36,1) both' }}>{w}{' '}</span>
          ))}
        </div>
      )}
    </div>
  )
}
