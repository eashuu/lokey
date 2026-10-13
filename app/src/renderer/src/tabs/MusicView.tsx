import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { mmss } from '@/lib/format'
import type { CSSProperties } from 'react'

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const time: CSSProperties = { position: 'absolute', top: 54, width: 36, height: 16, lineHeight: '16px', fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }
const ctl = (action: 'toggle' | 'next' | 'prev') => () => void bridge.call('media.control', { action }).catch(() => undefined)

/** Plain icon button: `cx,cy` = icon centre inside the 344x118 box; 32px hit area. */
function Icon({ cx, cy, label, onClick, children }: { cx: number; cy: number; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="hover:brightness-[1.15] active:scale-[0.94]"
      style={{ position: 'absolute', left: cx - 16, top: cy - 16, width: 32, height: 32, display: 'grid', placeItems: 'center', color: 'var(--text)', transition: 'filter .1s linear, transform .1s linear' }}
    >
      {children}
    </button>
  )
}

/** The 380x150 "music island": content box 344x118 at (18,24), coordinates from docs/UI-LAYOUT.md. */
export function MusicView() {
  const media = useData(s => s.media)
  const has = !!media?.hasSession
  const pos = has ? media!.positionMs : 0
  const dur = has ? media!.durationMs : 0
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0
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
      <span style={{ ...time, left: 0 }}>{mmss(pos)}</span>
      <div style={{ position: 'absolute', left: 40, top: 60.5, width: 264, height: 3, borderRadius: 1.5, background: 'var(--fill-4)', overflow: 'hidden' }}>
        <i style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--text)' }} />
      </div>
      <span style={{ ...time, right: 0, textAlign: 'right' }}>{mmss(dur)}</span>
      {has && (
        <>
          <Icon cx={116} cy={98} label="Previous" onClick={ctl('prev')}><SkipBack size={18} fill="currentColor" /></Icon>
          <Icon cx={172} cy={98} label={media!.playing ? 'Pause' : 'Play'} onClick={ctl('toggle')}>{media!.playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</Icon>
          <Icon cx={228} cy={98} label="Next" onClick={ctl('next')}><SkipForward size={18} fill="currentColor" /></Icon>
        </>
      )}
    </div>
  )
}
