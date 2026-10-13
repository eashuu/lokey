import { useEffect, useRef, type KeyboardEvent, type WheelEvent } from 'react'
import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import type { WallpaperItem } from '@shared/protocol'
import { animSpeed } from '@/lib/motion'
import { useIsland } from '@/island/store'

// Offsets are percentages of the card's own width (15rem), so everything stays in rem terms.
const POSE = [
  { x: 0, scale: 1, opacity: 1, skew: 0, dark: 0 },
  { x: 66, scale: 0.68, opacity: 0.9, skew: -8, dark: 0.3 },
  { x: 92, scale: 0.52, opacity: 0.7, skew: -8, dark: 0.5 },
  { x: 105, scale: 0.45, opacity: 0, skew: -8, dark: 0.6 },
]

/** Coverflow of skewed cards. Only transform + opacity animate. */
export function Carousel({ items, thumbs, index, onIndex, current, onSet }: {
  items: WallpaperItem[]
  thumbs: Record<string, string | null>
  index: number
  onIndex: (i: number) => void
  current: string | null
  onSet: (path: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const lastWheel = useRef(0)
  const go = (d: number) => onIndex(Math.min(items.length - 1, Math.max(0, index + d)))

  useEffect(() => { if (useIsland.getState().mode === 'pinned') ref.current?.focus() }, [])

  const onWheel = (e: WheelEvent) => {
    const now = performance.now()
    if (now - lastWheel.current < 140) return
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (Math.abs(d) < 4) return
    lastWheel.current = now
    go(d > 0 ? 1 : -1)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
    else if (e.key === 'Enter' && items[index]) onSet(items[index].path)
  }

  const speed = animSpeed()
  const transition = speed <= 0 ? { duration: 0 } : { type: 'spring' as const, stiffness: 260 * speed * speed, damping: 26 * speed, mass: 1 }

  return (
    <div
      ref={ref}
      tabIndex={0}
      onWheel={onWheel}
      onKeyDown={onKey}
      onPointerDown={() => ref.current?.focus()}
      style={{ position: 'relative', height: '9rem', overflow: 'hidden', outline: 'none' }}
    >
      {items.map((it, i) => {
        const d = i - index
        const a = Math.abs(d)
        if (a > 3) return null
        const p = POSE[a]
        const thumb = it.thumb ?? thumbs[it.path] ?? null
        const isCur = it.path === current
        return (
          <motion.div
            key={it.path}
            initial={false}
            animate={{ x: `${Math.sign(d) * p.x}%`, scale: p.scale, opacity: p.opacity, skewX: p.skew }}
            transition={transition}
            onClick={() => (d === 0 ? onSet(it.path) : onIndex(i))}
            style={{
              position: 'absolute', top: '0.25rem', left: '50%', width: '15rem', height: '8.5rem', marginLeft: '-7.5rem',
              borderRadius: '0.75rem', overflow: 'hidden', background: 'var(--s2)', border: '1px solid var(--line)',
              zIndex: 10 - a, cursor: 'pointer', pointerEvents: a > 2 ? 'none' : 'auto', transformPerspective: 800,
            }}
          >
            {thumb ? (
              <img src={thumb} alt={it.name} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: '0.6875rem', color: 'var(--dim)' }}>{it.name}</div>
            )}
            <motion.div initial={false} animate={{ opacity: p.dark }} transition={transition} style={{ position: 'absolute', inset: 0, background: '#000', pointerEvents: 'none' }} />
            {isCur && (
              <div title="Current wallpaper" style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', width: '1.25rem', height: '1.25rem', borderRadius: 999, background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}>
                <Check size={12} strokeWidth={3} />
              </div>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}
