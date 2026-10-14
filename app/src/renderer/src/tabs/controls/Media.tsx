import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Music, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react'
import { bridge } from '@/bridge'
import { useData, useBandsStream } from '@/lib/data'
import { clamp, mmss } from '@/lib/format'
import { mediaControl, mediaSeek } from '@/lib/media'

const ctl = (action: 'toggle' | 'next' | 'prev') => () => mediaControl(action)

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
        const v = clamp(bands[i] ?? 0, 0, 1)
        if (v < 0.02) continue
        const bh = Math.max(2 * dpr, v * h)
        g.fillRect(i * slot + (slot - bw) / 2, h - bh, bw, bh)
      }
    }
    draw(useData.getState().bands)
    return useData.subscribe(s => draw(s.bands))
  }, [])
  return <canvas ref={ref} aria-hidden style={{ position: 'absolute', left: 16, bottom: 0, width: 572, height: 40, opacity: 0.25, pointerEvents: 'none' }} />
}

/** 488x3 progress bar with a taller invisible hit area; drag to seek. */
function Seek({ frac, onChange, onCommit }: { frac: number; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return clamp((e.clientX - r.left) / r.width, 0, 1)
  }
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(frac * 100)}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); onChange(at(e)) }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(at(e)) }}
      onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); onCommit(at(e)) }}
      onPointerCancel={e => onCommit(at(e))} // a cancelled drag (touch, pen, focus loss) still ends where it was
      style={{ position: 'absolute', left: 58, top: 100, width: 488, height: 19, cursor: 'pointer', touchAction: 'none' }}
    >
      <div style={{ position: 'absolute', left: 0, top: 8.5, width: 488, height: 3, borderRadius: 1.5, background: 'var(--fill-3)', overflow: 'hidden' }}>
        <i style={{ display: 'block', height: '100%', width: `${frac * 100}%`, background: 'var(--accent)' }} />
      </div>
    </div>
  )
}

const ellipsis: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const circle = (size: number, top: number, left: number, bg: string, color: string): CSSProperties => ({ position: 'absolute', top, left, width: size, height: size, borderRadius: size / 2, display: 'grid', placeItems: 'center', background: bg, color, transition: 'filter .1s linear, transform .1s linear' })
const press = 'hover:brightness-[1.15] active:scale-[0.94]'

export function MediaCard() {
  const media = useData(s => s.media)
  const device = useData(s => s.audio?.device)
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

  const card: CSSProperties = { position: 'absolute', left: 0, top: 184, width: 604, height: 132, borderRadius: 18, background: 'var(--fill-1)', overflow: 'hidden' }

  if (!media?.hasSession) {
    return (
      <div style={{ ...card, display: 'grid', placeItems: 'center', alignContent: 'center', gap: 8, color: 'var(--muted)' }}>
        <Music size={30} strokeWidth={1.5} />
        <span style={{ fontSize: 13 }}>Nothing playing</span>
      </div>
    )
  }

  const dur = Math.max(0, media.durationMs)
  const base = seek ?? { ms: media.positionMs, at: media.sampledAt }
  const pos = clamp(base.ms + (playing ? now - base.at : 0), 0, dur || Infinity)
  const frac = clamp(drag ?? (dur ? pos / dur : 0), 0, 1)
  const time: CSSProperties = { position: 'absolute', top: 102, width: 40, height: 14, lineHeight: '14px', fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }
  const by = [media.artist, media.album].filter(Boolean).join(' · ')

  return (
    <div style={card}>
      <Visualiser />
      <Volume2 size={11} strokeWidth={1.8} style={{ position: 'absolute', left: 16, top: 13, color: 'var(--muted)' }} />
      <div style={{ position: 'absolute', left: 32, top: 8, width: 360, height: 20, lineHeight: '20px', fontSize: 11, color: 'var(--muted)', ...ellipsis }}>{device || media.app}</div>
      {media.sessions.length > 1 && (
        <div style={{ position: 'absolute', right: 16, top: 6, display: 'flex', gap: 4 }}>
          {media.sessions.slice(0, 3).map(s => (
            <button
              key={s.id}
              onClick={() => void bridge.call('media.selectSession', { id: s.id }).catch(() => undefined)}
              style={{ height: 20, maxWidth: 96, padding: '0 9px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: s.id === media.currentSession ? 'var(--accent)' : 'var(--fill-3)', color: s.id === media.currentSession ? 'var(--accent-ink)' : 'var(--soft)', transition: 'background-color .14s linear, color .14s linear', ...ellipsis }}
            >
              {s.app}
            </button>
          ))}
        </div>
      )}
      <div style={{ position: 'absolute', left: 16, top: 34, width: 52, height: 52, borderRadius: 10, overflow: 'hidden', background: 'var(--fill-3)', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
        {media.art ? <img src={media.art} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music size={22} strokeWidth={1.5} />}
      </div>
      <div style={{ position: 'absolute', left: 80, top: 34, width: 378, height: 30, lineHeight: '30px', fontSize: 20, fontWeight: 500, ...ellipsis }}>{media.title || 'Unknown title'}</div>
      <div style={{ position: 'absolute', left: 80, top: 64, width: 378, height: 18, lineHeight: '18px', fontSize: 12, color: 'var(--muted)', ...ellipsis }}>{by ? `by ${by}` : media.app}</div>

      <button aria-label="Previous" className={press} onClick={ctl('prev')} style={{ ...circle(30, 44, 470, 'var(--fill-3)', 'var(--text)'), opacity: media.canPrev ? 1 : 0.4 }}><SkipBack size={14} fill="currentColor" /></button>
      <button aria-label={playing ? 'Pause' : 'Play'} className={press} onClick={ctl('toggle')} style={circle(44, 37, 510, '#EDE3C8', '#1A1714')}>
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}
      </button>
      <button aria-label="Next" className={press} onClick={ctl('next')} style={{ ...circle(30, 44, 564, 'var(--fill-3)', 'var(--text)'), opacity: media.canNext ? 1 : 0.4 }}><SkipForward size={14} fill="currentColor" /></button>

      <span style={{ ...time, left: 16, textAlign: 'right' }}>{mmss(drag != null ? drag * dur : pos)}</span>
      <Seek
        frac={frac}
        onChange={setDrag}
        onCommit={v => {
          const ms = Math.round(v * dur)
          mediaSeek(ms)
          setSeek({ ms, at: Date.now() })
          setNow(Date.now())
          setDrag(null)
        }}
      />
      <span style={{ ...time, left: 548, textAlign: 'right' }}>{mmss(dur)}</span>
    </div>
  )
}
