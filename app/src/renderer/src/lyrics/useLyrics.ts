import { useEffect, useState } from 'react'
import type { Lyrics } from '@shared/lyrics'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'

// Lyrics for whatever is playing: asked of the main process (which caches on disk and talks to LRCLIB), remembered here for the
// session so switching back to a song is instant.
const cache = new Map<string, Lyrics>()
/** QA only: put fake lyrics in the cache so a lab render needs no network */
export const seedLyrics = (id: string, l: Lyrics) => { cache.set(id, l) }

export const trackId = (m: { title: string; artist: string; album: string; durationMs: number }) => `${m.title}|${m.artist}|${m.album}|${Math.round(m.durationMs / 1000)}`

export function useLyrics(): { lyrics: Lyrics | null; loading: boolean; id: string } {
  const media = useData(s => s.media)
  const on = useData(s => s.settings.island.lyrics) !== 'off'
  const id = on && media?.hasSession && media.title ? trackId(media) : ''
  const [res, setRes] = useState<{ id: string; lyrics: Lyrics } | null>(() => (id && cache.has(id) ? { id, lyrics: cache.get(id)! } : null))
  useEffect(() => {
    if (!id || !media) return
    const hit = cache.get(id)
    if (hit) { setRes({ id, lyrics: hit }); return }
    let live = true
    void bridge.lyrics.get({ title: media.title, artist: media.artist, album: media.album, durationMs: media.durationMs })
      .then(l => {
        if (l.source !== 'none' || l.state !== 'none') cache.set(id, l)
        if (cache.size > 40) cache.delete(cache.keys().next().value as string)
        if (live) setRes({ id, lyrics: l })
      })
      .catch(() => undefined)
    return () => { live = false }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  return { lyrics: res && res.id === id ? res.lyrics : null, loading: !!id && !(res && res.id === id), id }
}
