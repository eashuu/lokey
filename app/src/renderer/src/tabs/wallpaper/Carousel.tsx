import { useEffect, useRef, type WheelEvent } from 'react'
import { animate, motion, useMotionTemplate, useMotionValue, useTransform, type MotionValue } from 'motion/react'
import { Check } from 'lucide-react'
import type { WallpaperItem } from '@shared/protocol'
import { dur } from '@/lib/motion'

const SKEW = 11.86
const W = 330 // centre card box; every card is this box scaled (transform only) to the reference's width/height
const H = 186
const EASE = [0.33, 1, 0.68, 1] as const

const smooth = (u: number) => u * u * (3 - 2 * u)

/** Signed circular distance of card `i` from the (fractional) centre `pos`; wraps only with 3+ items. */
function dist(i: number, pos: number, n: number) {
  let p = i - pos
  if (n >= 3) { p = ((p % n) + n) % n; if (p > n / 2) p -= n }
  return p
}

// Reference geometry for a card at distance p (ad = |p|, d = smoothstep(min(ad,1))):
//   width 330-264d, height 186-14d, centre offset 211.47d + 78 max(0, ad-1) (signed), top 4+(186-h)/2,
//   opacity 1-.22 min(ad,1)-.11 max(0,ad-1), dim .275 when ad>.5, z-index 10-round(2ad).
// Rendered as translateX + scale of a fixed 330x186 box so the tween stays on the compositor.
function Card({ i, n, pos, it, thumb, active, onClick }: { i: number; n: number; pos: MotionValue<number>; it: WallpaperItem; thumb: string | null; active: boolean; onClick: () => void }) {
  const p = useTransform(pos, v => dist(i, v, n))
  const x = useTransform(p, v => { const a = Math.abs(v); return Math.sign(v) * (211.47 * smooth(Math.min(a, 1)) + 78 * Math.max(0, a - 1)) })
  const sx = useTransform(p, v => (330 - 264 * smooth(Math.min(Math.abs(v), 1))) / W)
  const sy = useTransform(p, v => (186 - 14 * smooth(Math.min(Math.abs(v), 1))) / H)
  const opacity = useTransform(p, v => { const a = Math.abs(v); return a > 4.2 ? 0 : 1 - 0.22 * Math.min(a, 1) - 0.11 * Math.max(0, a - 1) })
  const dim = useTransform(p, v => (Math.abs(v) > 0.5 ? 0.275 : 0))
  const z = useTransform(p, v => 10 - Math.round(2 * Math.abs(v)))
  // skew after the scale keeps the lean at -11.86deg on the narrow cards; the image undoes both
  const transform = useMotionTemplate`translateX(${x}px) skewX(-${SKEW}deg) scale(${sx}, ${sy})`
  const inv = useMotionTemplate`scale(${useTransform(sx, v => 1 / v)}, ${useTransform(sy, v => 1 / v)}) skewX(${SKEW}deg)`
  return (
    <motion.div
      onClick={onClick}
      style={{ position: 'absolute', left: (1004 - W) / 2, top: 4, width: W, height: H, borderRadius: 12, overflow: 'hidden', transform, opacity, zIndex: z, cursor: 'pointer', background: 'var(--fill-1)' }}
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

/** Track of skewed cards with wrap-around. `current` (the applying / current wallpaper) gets the accent ring. */
export function Carousel({ items, thumbs, index, onIndex, current, onSet }: {
  items: WallpaperItem[]
  thumbs: Record<string, string | null>
  index: number
  onIndex: (i: number) => void
  current: string | null
  onSet: (path: string) => void
}) {
  const n = items.length
  const lastWheel = useRef(0)
  const pos = useMotionValue(index)
  const go = (d: number) => onIndex(n >= 3 ? (index + d + n) % n : Math.min(n - 1, Math.max(0, index + d)))

  // glide along the shortest circular path to the new centre
  useEffect(() => {
    const from = pos.get()
    const target = from + dist(index, from, n)
    const a = animate(pos, target, { duration: dur(0.26), ease: EASE })
    return () => a.stop()
  }, [index, n, pos])

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
    <div onWheel={onWheel} style={{ position: 'absolute', left: 0, top: 44, width: 1004, height: 196 }}>
      {items.map((it, i) => {
        if (Math.abs(dist(i, index, n)) > 5) return null
        return <Card key={it.path} i={i} n={n} pos={pos} it={it} thumb={it.thumb ?? thumbs[it.path] ?? null} active={it.path === current} onClick={() => (i === index ? onSet(it.path) : onIndex(i))} />
      })}
      {sel && sel.path === current && (
        <div title="Current wallpaper" style={{ position: 'absolute', left: 645, top: 12, width: 22, height: 22, borderRadius: 11, background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center', zIndex: 20, pointerEvents: 'none' }}>
          <Check size={13} strokeWidth={3} />
        </div>
      )}
    </div>
  )
}
