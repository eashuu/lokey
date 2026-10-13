import { Music, Pause, Play } from 'lucide-react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { mmss } from '@/lib/format'
import type { CSSProperties } from 'react'

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const time: CSSProperties = { position: 'absolute', top: 54, width: 36, height: 16, lineHeight: '16px', fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }

/** The 380x150 "music island": first stop when scrolling down on the island. Content is 344x70, centred vertically. */
export function MusicView() {
  const media = useData(s => s.media)
  const has = !!media?.hasSession
  const pos = has ? media!.positionMs : 0
  const dur = has ? media!.durationMs : 0
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0
  return (
    <div style={{ position: 'absolute', left: 18, top: 40, width: 344, height: 70 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 46, height: 46, borderRadius: 10, overflow: 'hidden', background: 'var(--fill-3)', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
        {has && media!.art ? <img src={media!.art} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music size={20} strokeWidth={1.6} />}
      </div>
      <div style={{ position: 'absolute', left: 58, top: 3, width: 240, height: 20, lineHeight: '20px', fontSize: 14, fontWeight: 500, ...ellipsis }}>
        {has ? (media!.title || 'Unknown title') : 'Nothing playing'}
      </div>
      <div style={{ position: 'absolute', left: 58, top: 24, width: 240, height: 18, lineHeight: '18px', fontSize: 12, color: 'var(--muted)', ...ellipsis }}>
        {has ? (media!.artist || media!.app) : 'Play something to see it here'}
      </div>
      {has && (
        <button
          aria-label={media!.playing ? 'Pause' : 'Play'}
          onClick={() => void bridge.call('media.control', { action: 'toggle' }).catch(() => undefined)}
          style={{ position: 'absolute', left: 310, top: 6, width: 34, height: 34, borderRadius: 17, display: 'grid', placeItems: 'center', background: 'var(--fill-4)', color: 'var(--text)', transition: 'transform .12s' }}
        >
          {media!.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" style={{ marginLeft: 1.5 }} />}
        </button>
      )}
      <span style={{ ...time, left: 0 }}>{mmss(pos)}</span>
      <div style={{ position: 'absolute', left: 40, top: 60.5, width: 264, height: 3, borderRadius: 1.5, background: 'var(--fill-4)', overflow: 'hidden' }}>
        <i style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--text)' }} />
      </div>
      <span style={{ ...time, left: 308, textAlign: 'right' }}>{mmss(dur)}</span>
    </div>
  )
}
