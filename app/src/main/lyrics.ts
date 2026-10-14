import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanTitle, mainArtist, parseLrc, trackKey, type Lyrics, type TrackQuery } from '@shared/lyrics'
import { dataDir } from './settings'

// Synced lyrics from LRCLIB (https://lrclib.net, a free, open lyrics database: no key, no account). One request per new track,
// answers (and "not found") are cached on disk, so a song you play often costs nothing. The only data sent is the track's
// title, artist, album and length.
const API = 'https://lrclib.net/api'
const UA = 'Lokey/0.3 (https://github.com/eashuu/lokey)'
const dir = join(dataDir, 'lyrics')
const NEGATIVE_TTL = 7 * 86_400_000

interface Cached { v: number; at: number; lyrics: Omit<Lyrics, 'key' | 'source'> }
interface Hit { syncedLyrics?: string | null; plainLyrics?: string | null; instrumental?: boolean; duration?: number; trackName?: string; artistName?: string }

const fileFor = (key: string) => join(dir, createHash('sha1').update(key).digest('hex').slice(0, 20) + '.json')
const inflight = new Map<string, Promise<Lyrics>>()

/** null = the database has nothing for it; NET = it could not be asked (offline, timeout): that must never be remembered as "no lyrics" */
const NET = Symbol('net')
async function getJson<T>(path: string): Promise<T | null | typeof NET> {
  try {
    const r = await fetch(`${API}${path}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(7000) })
    if (r.status === 404) return null
    return r.ok ? ((await r.json()) as T) : NET
  } catch { return NET }
}

const qs = (o: Record<string, string | number>) => Object.entries(o).filter(([, v]) => v !== '' && v !== 0).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')

/** the best database entry for this track: exact lookup first, then a search ranked by how close the length is */
async function lookup(t: TrackQuery): Promise<Hit | null | typeof NET> {
  const title = cleanTitle(t.title), artist = mainArtist(t.artist), secs = Math.round(t.durationMs / 1000)
  if (!title) return null
  const exact = await getJson<Hit>(`/get?${qs({ track_name: title, artist_name: artist, album_name: t.album, duration: secs })}`)
  if (exact === NET) return NET
  if (exact && (exact.syncedLyrics || exact.plainLyrics || exact.instrumental)) return exact
  let found = await getJson<Hit[]>(`/search?${qs({ track_name: title, artist_name: artist })}`)
  if (found === NET) return NET
  if (!found?.length) found = await getJson<Hit[]>(`/search?${qs({ q: `${title} ${artist}` })}`)
  if (found === NET) return NET
  const close = (found ?? [])
    .filter(h => h.syncedLyrics || h.plainLyrics)
    .map(h => ({ h, d: secs && h.duration ? Math.abs(h.duration - secs) : 0, s: h.syncedLyrics ? 0 : 1 }))
    .filter(x => !secs || x.d <= 5)
    .sort((a, b) => a.s - b.s || a.d - b.d)
  return close[0]?.h ?? null
}

function fromHit(h: Hit | null): Omit<Lyrics, 'key' | 'source'> {
  if (h?.syncedLyrics) { const lines = parseLrc(h.syncedLyrics); if (lines.length) return { state: 'ready', lines, offsetMs: 0 } }
  if (h?.plainLyrics?.trim()) return { state: 'plain', lines: [], plain: h.plainLyrics.trim(), offsetMs: 0 }
  return { state: 'none', lines: [], offsetMs: 0 }
}

export function getLyrics(t: TrackQuery): Promise<Lyrics> {
  const key = trackKey(t)
  const busy = inflight.get(key)
  if (busy) return busy
  const p = (async (): Promise<Lyrics> => {
    try {
      const c = JSON.parse(readFileSync(fileFor(key), 'utf8')) as Cached
      if (c.v === 1 && (c.lyrics.state !== 'none' || Date.now() - c.at < NEGATIVE_TTL)) return { key, source: 'cache', ...c.lyrics }
    } catch { /* not cached */ }
    const hit = await lookup(t)
    if (hit === NET) return { key, source: 'none', state: 'none', lines: [], offsetMs: 0 }
    const lyrics = fromHit(hit)
    save(key, lyrics)
    return { key, source: lyrics.state === 'none' ? 'none' : 'lrclib', ...lyrics }
  })().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

function save(key: string, lyrics: Omit<Lyrics, 'key' | 'source'>) {
  try { mkdirSync(dir, { recursive: true }); writeFileSync(fileFor(key), JSON.stringify({ v: 1, at: Date.now(), lyrics } satisfies Cached)) } catch { /* the cache is a convenience */ }
}

/** remember the user's sync nudge for a track */
export function setLyricsOffset(key: string, offsetMs: number) {
  try {
    const c = JSON.parse(readFileSync(fileFor(key), 'utf8')) as Cached
    c.lyrics.offsetMs = Math.max(-10_000, Math.min(10_000, Math.round(offsetMs)))
    writeFileSync(fileFor(key), JSON.stringify(c))
  } catch { /* nothing cached for this key */ }
}
