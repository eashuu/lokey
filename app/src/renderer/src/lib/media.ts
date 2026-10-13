import { useEffect, useState } from 'react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { clamp } from '@/lib/format'

export type MediaAction = 'toggle' | 'next' | 'prev'

let verify: ReturnType<typeof setTimeout> | undefined

/**
 * Sends a transport command. Play/pause flips the UI immediately (players report back 100-400 ms later, some never
 * do); the sidecar's media.changed event then confirms, and if nothing arrives we re-read the real state.
 */
export function mediaControl(action: MediaAction) {
  const m = useData.getState().media
  if (action === 'toggle' && m?.hasSession) {
    const now = Date.now()
    const pos = m.positionMs + (m.playing ? now - m.sampledAt : 0)
    useData.setState({ media: { ...m, playing: !m.playing, positionMs: pos, sampledAt: now } })
  }
  void bridge.call('media.control', { action }).catch(() => undefined)
  clearTimeout(verify)
  verify = setTimeout(() => { void bridge.call('media.get', {}).then(media => useData.setState({ media })).catch(() => undefined) }, 1200)
}

export function mediaSeek(positionMs: number) {
  const m = useData.getState().media
  if (m?.hasSession) useData.setState({ media: { ...m, positionMs, sampledAt: Date.now() } })
  void bridge.call('media.control', { action: 'seek', positionMs: Math.round(positionMs) }).catch(() => undefined)
}

/** Live playback position: sample + elapsed, ticked by one 500 ms interval that exists only while mounted and playing. */
export function useMediaPosition() {
  const media = useData(s => s.media)
  const playing = !!media?.hasSession && media.playing
  const [, tick] = useState(0)
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => tick(n => n + 1), 500)
    return () => clearInterval(t)
  }, [playing])
  const dur = media?.hasSession ? Math.max(0, media.durationMs) : 0
  const pos = media?.hasSession ? clamp(media.positionMs + (playing ? Date.now() - media.sampledAt : 0), 0, dur || Infinity) : 0
  return { media, playing, pos, dur }
}
