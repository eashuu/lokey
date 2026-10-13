import { useEffect, useRef, useState } from 'react'
import { cachedIcon, loadIcon } from '@/lib/icons-cache'

function hue(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

/** 2rem icon; the real icon is requested only once the row scrolls into view. Falls back to a letter avatar. */
export function AppIcon({ id, name }: { id: string; name: string }) {
  const [icon, setIcon] = useState(() => cachedIcon(id))
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const known = cachedIcon(id)
    if (known !== undefined) { setIcon(known); return }
    const el = ref.current
    if (!el) return
    let live = true
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { io.disconnect(); void loadIcon(id).then(i => { if (live) setIcon(i) }) }
    })
    io.observe(el)
    return () => { live = false; io.disconnect() }
  }, [id])

  const h = hue(name)
  return (
    <div ref={ref} style={{ width: '2rem', height: '2rem', flex: 'none', borderRadius: '0.5rem', overflow: 'hidden', display: 'grid', placeItems: 'center', background: icon ? 'var(--s2)' : `hsl(${h} 30% 24%)`, color: `hsl(${h} 65% 78%)`, fontSize: '0.8125rem', fontWeight: 700 }}>
      {icon ? <img src={icon} alt="" draggable={false} style={{ width: '1.625rem', height: '1.625rem', objectFit: 'contain' }} /> : (name.trim()[0] ?? '?').toUpperCase()}
    </div>
  )
}
