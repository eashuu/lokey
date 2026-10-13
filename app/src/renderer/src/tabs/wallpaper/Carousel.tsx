import { useEffect, useRef, type WheelEvent } from 'react'
import { animate, motion, useMotionTemplate, useMotionValue, useTransform } from 'motion/react'
import { Check } from 'lucide-react'
import type { WallpaperItem } from '@shared/protocol'
import { dur } from '@/lib/motion'

const SKEW = 11.86
const W = 330 // centre card (design px); the track is 1004 x 196
const H = 196
const EASE = [0.215, 0.61, 0.355, 1] as const

// Pose per distance from the centre. Neighbours are narrow slivers (x pitch 211, then 78 further): they are the centre
// card scaled non-uniformly, with the image counter-scaled so it is cropped rather than squashed. Transform + opacity only.
const POSE = [
  { x: 0, sx: 1, sy: 1, dim: 0, o: 1 },
  { x: 211, sx: 0.2, sy: 0.88, dim: 0.45, o: 1 },
  { x: 289, sx: 0.17, sy: 0.8, dim: 0.55, o: 1 },
  { x: 355, sx: 0.15, sy: 0.74, dim: 0.6, o: 0 },
]
const pose = (d: number) => {
  const p = POSE[Math.min(3, Math.abs(d))]
  return { ...p, x: Math.sign(d) * p.x }
}

function Card({ d, it, thumb, active, onClick }: { d: number; it: WallpaperItem; thumb: string | null; active: boolean; onClick: () => void }) {
  const p = pose(d)
  const x = useMotionValue(p.x), sx = useMotionValue(p.sx), sy = useMotionValue(p.sy), dim = useMotionValue(p.dim), o = useMotionValue(p.o)
  useEffect(() => {
    const t = { duration: dur(0.35), ease: EASE }
    const n = pose(d)
    const run = [animate(x, n.x, t), animate(sx, n.sx, t), animate(sy, n.sy, t), animate(dim, n.dim, t), animate(o, n.o, t)]
    return () => run.forEach(a => a.stop())
  }, [d, x, sx, sy, dim, o])

  // skew is applied after the scale so the lean stays at -11.86deg on the slivers; the image undoes both
  const transform = useMotionTemplate`translateX(${x}px) skewX(-${SKEW}deg) scale(${sx}, ${sy})`
  const inv = useMotionTemplate`scale(${useTransform(sx, v => 1 / v)}, ${useTransform(sy, v => 1 / v)}) skewX(${SKEW}deg)`
  return (
    <motion.div
      onClick={onClick}
      style={{ position: 'absolute', left: (1004 - W) / 2, top: 0, width: W, height: H, borderRadius: 12, overflow: 'hidden', transform, opacity: o, zIndex: 10 - Math.abs(d), cursor: 'pointer', pointerEvents: Math.abs(d) > 2 ? 'none' : 'auto', background: 'var(--fill-1)' }}
    >
      <motion.div style={{ position: 'absolute', inset: '-12px -30px', transform: inv }}>
        {thumb ? (
          <img src={thumb} alt={it.name} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--muted)' }}>{it.name}</div>
        )}
      </motion.div>
      <motion.div style={{ position: 'absolute', inset: 0, background: '#000', opacity: dim, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: 12, boxShadow: active ? 'inset 0 0 0 2.2px var(--accent)' : 'inset 0 0 0 1px rgba(255,255,255,.118)', pointerEvents: 'none' }} />
    </motion.div>
  )
}

/** Track of skewed cards. `active` (the applying / current wallpaper) gets the accent ring. */
export function Carousel({ items, thumbs, index, onIndex, current, onSet }: {
  items: WallpaperItem[]
  thumbs: Record<string, string | null>
  index: number
  onIndex: (i: number) => void
  current: string | null
  onSet: (path: string) => void
}) {
  const lastWheel = useRef(0)
  const go = (d: number) => onIndex(Math.min(items.length - 1, Math.max(0, index + d)))

  // keys: the window only receives them while the island is pinned
  const live = useRef({ go, onSet, item: items[index] })
  live.current = { go, onSet, item: items[index] }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { go, onSet, item } = live.current
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === 'Enter' && item) onSet(item.path)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onWheel = (e: WheelEvent) => {
    const now = performance.now()
    if (now - lastWheel.current < 140) return
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (Math.abs(d) < 4) return
    lastWheel.current = now
    go(d > 0 ? 1 : -1)
  }

  const sel = items[index]
  return (
    <div onWheel={onWheel} style={{ position: 'absolute', left: 0, top: 44, width: 1004, height: H }}>
      {items.map((it, i) => {
        const d = i - index
        if (Math.abs(d) > 4) return null
        return <Card key={it.path} d={d} it={it} thumb={it.thumb ?? thumbs[it.path] ?? null} active={it.path === current} onClick={() => (d === 0 ? onSet(it.path) : onIndex(i))} />
      })}
      {sel && sel.path === current && (
        <div title="Current wallpaper" style={{ position: 'absolute', left: 645, top: 12, width: 22, height: 22, borderRadius: 11, background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center', zIndex: 20, pointerEvents: 'none' }}>
          <Check size={13} strokeWidth={3} />
        </div>
      )}
    </div>
  )
}
