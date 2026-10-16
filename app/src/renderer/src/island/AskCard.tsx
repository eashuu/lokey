import { useEffect, useRef, useState } from 'react'
import { ARM_MS, ASK_W, askHeight, askView, clockText, keyAction, remainingMs } from '@shared/ask'
import { useData } from '@/lib/data'
import { Soul } from './Soul'
import { skinPalette } from './skins'
import { answerAsk, useAsk } from './ask'

/**
 * A request for the person, drawn inside the island: one title, the exact detail, where it came from when it was not the person,
 * Allow / Deny, a countdown that ends in Deny, and "+N more" when others wait. Laid out at its design size (ASK_W wide) and scaled as a whole,
 * like the menu. Text comes from Lokey's own code only (the request is typed in the main process); it is rendered as plain text.
 */
export function AskCard({ left, top, scale }: { left: number; top: number; scale: number }) {
  const cur = useAsk(s => s.cur)
  const more = useAsk(s => s.more)
  const shownAt = useAsk(s => s.shownAt)
  const skin = useData(s => s.settings.loadout?.soul)
  const keys = useData(s => s.settings.agent)
  const still = useData(s => s.settings.appearance.reduceMotion)
  const [now, setNow] = useState(Date.now())
  const card = useRef<HTMLDivElement>(null)
  const id = cur?.id

  // the island page confirms to the main process that this very request is on screen (if it never does, the old window takes over)
  useEffect(() => { if (id) window.lokeyAsk?.shown(id) }, [id])
  // one tick a second is enough for the number; the bar itself runs on a CSS transition
  useEffect(() => {
    if (!id) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [id])
  // Esc denies when the island has the keyboard; no key ever allows (Enter/Space act on the focused button only)
  useEffect(() => {
    if (!id) return
    const on = (e: KeyboardEvent) => { if (keyAction(e, document.hasFocus()) === 'deny') { e.preventDefault(); answerAsk(id, false) } }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [id])

  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bar.current
    if (!el || !cur) return
    const ms = remainingMs(cur.expiresAt, Date.now())
    el.style.transition = 'none'; el.style.transform = `scaleX(${Math.min(1, ms / cur.timeoutMs)})`
    void el.offsetWidth
    if (!still) { el.style.transition = `transform ${ms}ms linear`; el.style.transform = 'scaleX(0)' }
  }, [id, cur, still])

  if (!cur) return null
  const v = askView(cur)
  const h = askHeight(v)
  const left_ = remainingMs(cur.expiresAt, now)
  const live = Date.now() - shownAt >= ARM_MS
  const hint = (() => {
    const a = keys?.allowKey?.trim(), d = keys?.denyKey?.trim()
    if (!a || !d) return ''
    const pa = a.slice(0, a.lastIndexOf('+') + 1), pd = d.slice(0, d.lastIndexOf('+') + 1)
    return pa === pd ? `${pa}${a.slice(pa.length)} / ${d.slice(pd.length)}` : `${a} / ${d}`
  })()
  const warm = v.typed || !!v.src

  return (
    <div style={{ position: 'absolute', left, top, width: ASK_W * scale, height: h * scale }}>
      <div ref={card} role="alertdialog" aria-labelledby="lk-ask-title" aria-describedby="lk-ask-detail" tabIndex={-1}
        style={{ width: ASK_W, height: h, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'relative', boxSizing: 'border-box', padding: '16px 18px 0', fontFamily: 'var(--font-island)', color: 'var(--text)', outline: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 16, marginBottom: 8 }}>
          <div style={{ width: 22, height: 22, marginLeft: -3, marginTop: -2, flex: 'none' }} aria-hidden><Soul width={22} height={22} mode="LISTENING" active palette={skinPalette(skin)} /></div>
          <span style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 600, color: warm ? 'var(--warn)' : 'var(--muted)' }}>{v.chip}</span>
          <span style={{ flex: 1 }} />
          {more > 0 && <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>+{more} more</span>}
          <span className="num" style={{ fontSize: 10.5, color: left_ < 8000 ? 'var(--warn)' : 'var(--muted)', minWidth: 34, textAlign: 'right' }} aria-label={`Expires in ${clockText(left_)}, then it is denied`}>{clockText(left_)}</span>
        </div>
        <div id="lk-ask-title" style={{ fontSize: 15, fontWeight: 600, lineHeight: '20px', maxHeight: 40, overflow: 'hidden', wordBreak: 'break-word' }}>{v.title}</div>
        {v.src && <div style={{ marginTop: 2, fontSize: 11.5, lineHeight: '20px', color: 'var(--warn)' }}>From {v.src}, not from you</div>}
        {v.detail && <div id="lk-ask-detail" style={{ marginTop: 6, fontSize: 12.5, lineHeight: '17px', color: 'var(--muted)', maxHeight: 68, overflow: 'hidden', wordBreak: 'break-word' }}>{v.detail}</div>}
        <div style={{ position: 'absolute', left: 18, right: 18, bottom: 18, height: 34, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: 'var(--dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title="Keyboard: these chords work from any app while a request is showing">{hint}</span>
          <button className="lk-ask-btn" onClick={() => answerAsk(cur.id, false)} style={{ background: 'var(--fill-2)', color: 'var(--text)' }}>{v.deny}</button>
          <button className="lk-ask-btn" disabled={!live} aria-disabled={!live} onClick={() => { if (live) answerAsk(cur.id, true) }} style={{ background: 'var(--text)', color: 'var(--panel)', opacity: live ? 1 : 0.4 }}>{v.allow}</button>
        </div>
        <div ref={bar} aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2.5, background: 'var(--accent)', opacity: 0.85, transformOrigin: 'left' }} />
      </div>
      <style>{`.lk-ask-btn{all:unset;box-sizing:border-box;cursor:pointer;height:32px;padding:0 16px;border-radius:16px;font-size:13px;font-weight:600;display:grid;place-items:center;transition:transform .12s,opacity .2s}.lk-ask-btn:active:not(:disabled){transform:scale(.96)}.lk-ask-btn:disabled{cursor:default}.lk-ask-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`}</style>
    </div>
  )
}
