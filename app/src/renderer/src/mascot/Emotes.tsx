import { useEffect, useRef, useState } from 'react'
import { mascot, type EmoteKind } from './bus'

export const GLYPH: Record<EmoteKind, string> = {
  think: '💭', alert: '❗', sleep: '💤', idea: '💡', success: '✨', love: '❤️', sweat: '💦', search: '🔍', clock: '⏰', write: '✏️', music: '🎵', muted: '🔇', error: '💢', wave: '👋',
}

let injected = false
function css() {
  if (injected) return
  injected = true
  const el = document.createElement('style')
  el.textContent = `@keyframes lk-emote { 0% { opacity: 0; transform: translate(0, 6px) scale(.2) } 14% { opacity: 1; transform: translate(0, 0) scale(1.18) } 26% { transform: translate(0, -2px) scale(1) } 78% { opacity: 1 } 100% { opacity: 0; transform: translate(var(--dx), -22px) scale(.9) } }`
  document.head.appendChild(el)
}

/**
 * Floating reaction glyphs above the mascot (pop, drift, fade). Max three alive; each is a plain element removed by a
 * timer, so nothing runs while none is showing. `size` is the mascot's box height; glyphs are kept inside it.
 */
export function Emotes({ width, height }: { width: number; height: number }) {
  const [items, setItems] = useState<{ id: number; kind: EmoteKind; x: number; dx: number }[]>([])
  const next = useRef(1)
  useEffect(() => {
    css()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const off = mascot.on(e => {
      if (e.type !== 'emote') return
      const id = next.current++
      const x = (Math.random() - 0.5) * 0.14 * width
      const dx = (Math.random() - 0.5) * 0.12 * width
      setItems(a => [...a.slice(-2), { id, kind: e.kind, x, dx }])
      const t = setTimeout(() => { timers.delete(t); setItems(a => a.filter(i => i.id !== id)) }, 1450)
      timers.add(t)
    })
    return () => { off(); timers.forEach(clearTimeout) }
  }, [width])
  const fs = Math.max(11, Math.min(34, height * 0.26))
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
      {items.map(i => (
        <span
          key={i.id}
          style={{
            position: 'absolute', left: width / 2 + Math.min(width, height) * 0.3 + i.x, top: height * 0.02, fontSize: fs, lineHeight: 1,
            fontFamily: '"Segoe UI Emoji", "Apple Color Emoji", sans-serif', animation: 'lk-emote 1.4s cubic-bezier(.22,1,.36,1) forwards',
            ['--dx' as string]: `${i.dx}px`, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))',
          }}
        >
          {GLYPH[i.kind]}
        </span>
      ))}
    </div>
  )
}
