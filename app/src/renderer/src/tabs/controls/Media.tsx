import { useEffect, useRef, useState } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react'
import { bridge } from '@/bridge'
import { useData, useBandsStream } from '@/lib/data'
import { clamp, mmss } from '@/lib/format'
import { Card, Chip, IconButton, Slider } from '@/ui'

const ctl = (action: 'toggle' | 'next' | 'prev') => () => void bridge.call('media.control', { action }).catch(() => undefined)

/** 32 bars on one canvas, redrawn straight from the store (no React renders at ~30 Hz). */
function Visualiser() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!
    const g = cv.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    const draw = (bands: number[]) => {
      const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr)
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
      g.clearRect(0, 0, w, h)
      g.fillStyle = getComputedStyle(cv).getPropertyValue('--accent') || '#d9b556'
      const n = 32, slot = w / n, bw = Math.max(1, slot * 0.5)
      for (let i = 0; i < n; i++) {
        const bh = Math.max(2 * dpr, clamp(bands[i] ?? 0, 0, 1) * h)
        g.fillRect(i * slot + (slot - bw) / 2, h - bh, bw, bh)
      }
    }
    draw(useData.getState().bands)
    return useData.subscribe(s => draw(s.bands))
  }, [])
  return <canvas ref={ref} aria-hidden style={{ position: 'absolute', left: '0.75rem', bottom: '0.5rem', height: '3rem', width: 'calc(100% - 1.5rem)', opacity: 0.28, pointerEvents: 'none' }} />
}

const line = (v: string) => <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</div>

export function MediaCard() {
  const media = useData(s => s.media)
  const playing = !!media?.hasSession && media.playing
  useBandsStream(playing)

  // position = sample + elapsed, ticked by one 500 ms interval that only exists while playing
  const [now, setNow] = useState(() => Date.now())
  const [drag, setDrag] = useState<number | null>(null)
  const [seek, setSeek] = useState<{ ms: number; at: number } | null>(null)
  useEffect(() => { setSeek(null) }, [media])
  useEffect(() => {
    if (!playing) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [playing])

  if (!media?.hasSession) {
    return (
      <Card style={{ display: 'grid', placeItems: 'center', alignContent: 'center', gap: '0.5rem', color: 'var(--dim)', minHeight: '14rem' }}>
        <Music size={32} strokeWidth={1.5} />
        <span style={{ fontSize: '0.8125rem' }}>Nothing playing</span>
      </Card>
    )
  }

  const dur = Math.max(0, media.durationMs)
  const base = seek ?? { ms: media.positionMs, at: media.sampledAt }
  const pos = clamp(base.ms + (playing ? now - base.at : 0), 0, dur || Infinity)
  const frac = drag ?? (dur ? pos / dur : 0)

  return (
    <Card style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflow: 'hidden' }}>
      <Visualiser />
      <div style={{ display: 'flex', gap: '0.75rem', position: 'relative' }}>
        <div style={{ width: '6.5rem', height: '6.5rem', flex: 'none', borderRadius: '0.875rem', background: 'var(--s2)', display: 'grid', placeItems: 'center', color: 'var(--dim)', overflow: 'hidden' }}>
          {media.art ? <img src={media.art} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music size={28} strokeWidth={1.5} />}
        </div>
        <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.25rem' }}>
          <div className="label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{media.app}</div>
          <div style={{ fontWeight: 600, fontSize: '0.9375rem', lineHeight: 1.25 }}>{line(media.title || 'Unknown title')}</div>
          <div style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{line([media.artist, media.album].filter(Boolean).join(' · ') || ' ')}</div>
          {media.sessions.length > 1 && (
            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.125rem', overflow: 'hidden' }}>
              {media.sessions.slice(0, 3).map(s => (
                <Chip key={s.id} on={s.id === media.currentSession} onClick={() => void bridge.call('media.selectSession', { id: s.id }).catch(() => undefined)}>{s.app}</Chip>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <Slider
          label="Seek"
          value={clamp(frac, 0, 1)}
          onChange={setDrag}
          onCommit={v => {
            const ms = Math.round(v * dur)
            void bridge.call('media.control', { action: 'seek', positionMs: ms }).catch(() => undefined)
            setSeek({ ms, at: Date.now() })
            setNow(Date.now())
            setDrag(null)
          }}
        />
        <div className="num" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.625rem', color: 'var(--muted)' }}>
          <span>{mmss(drag != null ? drag * dur : pos)}</span><span>{mmss(dur)}</span>
        </div>
      </div>
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem' }}>
        <IconButton title="Previous" size="2rem" onClick={ctl('prev')} style={{ opacity: media.canPrev ? 1 : 0.4 }}><SkipBack size={16} fill="currentColor" /></IconButton>
        <IconButton title={playing ? 'Pause' : 'Play'} size="2.75rem" active onClick={ctl('toggle')}>
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </IconButton>
        <IconButton title="Next" size="2rem" onClick={ctl('next')} style={{ opacity: media.canNext ? 1 : 0.4 }}><SkipForward size={16} fill="currentColor" /></IconButton>
      </div>
    </Card>
  )
}
