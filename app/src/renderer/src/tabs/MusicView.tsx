import { useRef, useState, type CSSProperties } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { clamp, mmss } from '@/lib/format'
import { mediaControl, mediaSeek, useMediaPosition } from '@/lib/media'

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const time: CSSProperties = { position: 'absolute', top: 54, width: 36, height: 16, lineHeight: '16px', fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }

/** Plain icon button: `cx,cy` = icon centre inside the 344x118 box; 32px hit area. */
function Icon({ cx, cy, label, onClick, disabled, children }: { cx: number; cy: number; label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="hover:brightness-[1.15] active:scale-[0.94]"
      style={{ position: 'absolute', left: cx - 16, top: cy - 16, width: 32, height: 32, display: 'grid', placeItems: 'center', color: 'var(--text)', opacity: disabled ? 0.4 : 1, transition: 'filter .1s linear, transform .1s linear, opacity .1s linear' }}
    >
      {children}
    </button>
  )
}

/** The 380x150 "music island": content box 344x118 at (18,24), coordinates from docs/UI-LAYOUT.md. */
export function MusicView() {
  const { media, playing, pos, dur } = useMediaPosition()
  const has = !!media?.hasSession
  const bar = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const frac = clamp(drag ?? (dur ? pos / dur : 0), 0, 1)
  const at = (e: React.PointerEvent) => { const r = bar.current!.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1) }

  return (
    <div style={{ position: 'absolute', left: 18, top: 24, width: 344, height: 118 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 46, height: 46, borderRadius: 10, overflow: 'hidden', background: 'var(--fill-3)', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
        {has && media!.art ? <img src={media!.art} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music size={20} strokeWidth={1.6} />}
      </div>
      <div style={{ position: 'absolute', left: 58, top: 3, width: 286, height: 20, lineHeight: '20px', fontSize: 14, fontWeight: 500, ...ellipsis }}>
        {has ? (media!.title || 'Unknown title') : 'Nothing playing'}
      </div>
      <div style={{ position: 'absolute', left: 58, top: 24, width: 286, height: 18, lineHeight: '18px', fontSize: 12, color: 'var(--muted)', ...ellipsis }}>
        {has ? (media!.artist || media!.app) : 'Play something to see it here'}
      </div>
      <span style={{ ...time, left: 0 }}>{mmss(drag != null ? drag * dur : pos)}</span>
      <div
        ref={bar}
        role="slider"
        aria-label="Seek"
        onPointerDown={e => { if (!has || !dur) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(at(e)) }}
        onPointerMove={e => { if (drag != null && e.currentTarget.hasPointerCapture(e.pointerId)) setDrag(at(e)) }}
        onPointerUp={e => { if (drag == null) return; e.currentTarget.releasePointerCapture(e.pointerId); mediaSeek(at(e) * dur); setDrag(null) }}
        style={{ position: 'absolute', left: 40, top: 52, width: 264, height: 19, cursor: has && dur ? 'pointer' : 'default', touchAction: 'none' }}
      >
        <div style={{ position: 'absolute', left: 0, top: 8.5, width: 264, height: 3, borderRadius: 1.5, background: 'var(--fill-4)', overflow: 'hidden' }}>
          <i style={{ display: 'block', height: '100%', width: `${frac * 100}%`, background: 'var(--text)' }} />
        </div>
      </div>
      <span style={{ ...time, right: 0, textAlign: 'right' }}>{mmss(dur)}</span>
      <Icon cx={116} cy={98} label="Previous" onClick={() => mediaControl('prev')} disabled={!has || !media!.canPrev}><SkipBack size={18} fill="currentColor" /></Icon>
      <Icon cx={172} cy={98} label={playing ? 'Pause' : 'Play'} onClick={() => mediaControl('toggle')} disabled={!has}>{playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</Icon>
      <Icon cx={228} cy={98} label="Next" onClick={() => mediaControl('next')} disabled={!has || !media!.canNext}><SkipForward size={18} fill="currentColor" /></Icon>
    </div>
  )
}
