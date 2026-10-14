import { useEffect, useRef, useState } from 'react'
import { Minus, Pin, PinOff, Plus, Type, X } from 'lucide-react'
import { bridge } from '@/bridge'
import { initData, useData } from '@/lib/data'
import { mediaSeek } from '@/lib/media'
import { applyTheme } from '@/lib/theme'
import { isPhone } from '@/lib/platform'
import { LyricsStage } from './LyricsStage'
import { useLyrics } from './useLyrics'
import './lyrics.css'

// #lyrics: the lyrics pop-up. A normal window that stays until it is closed (X, or the shortcut again), remembers where it was,
// can be pinned above other windows, and follows whatever is playing. `lab` freezes the clock for a screenshot.
let booted = false

export function LyricsWindow({ lab }: { lab?: { pos: number } }) {
  useEffect(() => {
    if (isPhone) return // the phone shell owns the theme and the data (it shows this page as an overlay)
    applyTheme('dark', 1)
    if (!lab && !booted) { booted = true; void initData() }
  }, [lab])
  const media = useData(s => s.media)
  const win = useData(s => s.settings.lyricsWin)
  const reduced = useData(s => s.settings.appearance.reduceMotion)
  const { lyrics, loading } = useLyrics()
  const [offset, setOffset] = useState(0)
  useEffect(() => { setOffset(lyrics?.offsetMs ?? 0) }, [lyrics?.key])
  const nudge = (d: number) => {
    const v = Math.max(-10_000, Math.min(10_000, offset + d))
    setOffset(v)
    if (lyrics) void bridge.lyrics.setOffset(lyrics.key, v)
  }
  const setScale = (d: number) => bridge.settings.set({ lyricsWin: { scale: Math.max(0.6, Math.min(1.8, +(win.scale + d).toFixed(2))) } })

  // a steady function the stage can call every frame (position = last sample + time since it was taken, only while playing)
  const posRef = useRef<() => number>(() => 0)
  posRef.current = () => {
    if (lab) return lab.pos
    const m = useData.getState().media
    if (!m?.hasSession) return 0
    return m.positionMs + (m.playing ? Date.now() - m.sampledAt : 0)
  }

  const has = !!media?.hasSession
  const art = has ? media!.art : null
  // the background: when the cover changes the new one slides in from the right as the old one leaves to the left
  const [layers, setLayers] = useState<{ id: number; art: string; out: boolean }[]>([])
  const layerId = useRef(0)
  useEffect(() => {
    if (!art) { setLayers([]); return }
    setLayers(ls => {
      if (ls.length && ls[ls.length - 1].art === art) return ls
      return [...ls.map(l => ({ ...l, out: true })), { id: ++layerId.current, art, out: false }]
    })
    const t = setTimeout(() => setLayers(ls => ls.filter(l => !l.out)), 950)
    return () => clearTimeout(t)
  }, [art])
  const lines = lyrics?.state === 'ready' ? lyrics.lines : null

  return (
    <div className="lw" style={{ ['--ls' as string]: win.scale }}>
      <div className={layers.length ? 'lw-bg' : 'lw-bg none'}>
        {layers.map((l, i) => <div key={l.id} className={`lw-bg-layer ${l.out ? 'out' : i === 0 && layers.length === 1 ? '' : 'in'}`} style={{ backgroundImage: `url(${l.art})` }} />)}
      </div>
      <div className="lw-shade" />
      <div className="lw-bar">
        <div className="meta">{has ? <><b>{media!.title}</b>{media!.artist ? ` · ${media!.artist}` : ''}</> : 'Lyrics'}</div>
        <div className="tools">
          {lines && <>
            <button className="lw-btn" aria-label="Lyrics earlier" title="Lyrics earlier (-0.1 s)" onClick={() => nudge(-100)}><Minus size={15} /></button>
            <span className="lw-sync" title="Reset timing" onClick={() => nudge(-offset)}>{offset === 0 ? 'sync' : `${offset > 0 ? '+' : ''}${(offset / 1000).toFixed(1)}s`}</span>
            <button className="lw-btn" aria-label="Lyrics later" title="Lyrics later (+0.1 s)" onClick={() => nudge(100)}><Plus size={15} /></button>
          </>}
          <button className="lw-btn" aria-label="Smaller text" title="Smaller text" onClick={() => setScale(-0.1)}><Type size={13} /></button>
          <button className="lw-btn" aria-label="Larger text" title="Larger text" onClick={() => setScale(0.1)}><Type size={18} /></button>
          <button className={`lw-btn${win.pinned ? ' on' : ''}`} aria-label={win.pinned ? 'Unpin' : 'Keep on top'} title={win.pinned ? 'Stop keeping on top' : 'Keep on top of other windows'} onClick={() => bridge.lyrics.win.setPinned(!win.pinned)}>{win.pinned ? <Pin size={15} /> : <PinOff size={15} />}</button>
        </div>
        <button className="lw-btn close" aria-label="Close lyrics" title="Close" onClick={() => bridge.lyrics.win.close()}><X size={16} /></button>
      </div>

      {lines ? (
        <LyricsStage lines={lines} durationMs={media?.durationMs ?? 0} getPos={() => posRef.current()} offsetMs={offset} reduced={reduced} onSeek={ms => mediaSeek(ms)} />
      ) : lyrics?.state === 'plain' ? (
        <div className="lw-plain">{lyrics.plain}</div>
      ) : (
        <div className="lw-msg">{!has ? 'Play a song and its lyrics will appear here.' : loading ? 'Finding lyrics…' : 'No synced lyrics for this song.'}</div>
      )}
      <div className="lw-credit">{lyrics && lyrics.state !== 'none' ? 'Lyrics: LRCLIB · animation style inspired by Spicy Lyrics' : ''}</div>
    </div>
  )
}
