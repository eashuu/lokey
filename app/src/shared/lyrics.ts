// Synced lyrics: types and the pure parts (LRC parsing, which line is current, per-word timing). Used by the main process
// (parse what LRCLIB returns) and by the island (find the current line while the song plays).

export interface LyricWord { t: number; w: string }
/** `t` is the start time in ms; `text` may be '' for an instrumental gap; `words` only when the source had word timing. */
export interface LyricLine { t: number; text: string; words?: LyricWord[] }

export interface TrackQuery { title: string; artist: string; album: string; durationMs: number }

export interface Lyrics {
  /** stable id of the track (used for the cache and the saved sync offset) */
  key: string
  state: 'ready' | 'plain' | 'none'
  lines: LyricLine[]
  /** unsynced text, when that is all there is */
  plain?: string
  /** user nudge in ms (positive = lyrics later) */
  offsetMs: number
  source: 'lrclib' | 'cache' | 'none'
}

const STAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const WORD_STAMP = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g

const ms = (m: string, s: string, f?: string) => Number(m) * 60_000 + Number(s) * 1000 + (f ? Math.round(Number(f.padEnd(3, '0').slice(0, 3))) : 0)

/** LRC text -> lines sorted by time. Handles several stamps on one line, [offset:ms], and enhanced `<mm:ss.xx>word` tags. */
export function parseLrc(src: string): LyricLine[] {
  const out: LyricLine[] = []
  let offset = 0
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const off = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i)
    if (off) { offset = Number(off[1]); continue }
    const stamps: number[] = []
    let last = 0
    STAMP.lastIndex = 0
    for (let m = STAMP.exec(line); m; m = STAMP.exec(line)) { if (m.index !== last) break; stamps.push(ms(m[1], m[2], m[3])); last = STAMP.lastIndex }
    if (!stamps.length) continue // [ar:..] [ti:..] and other metadata
    const body = line.slice(last)
    let words: LyricWord[] | undefined
    let text = body.replace(/\s+/g, ' ').trim()
    if (WORD_STAMP.test(body)) {
      WORD_STAMP.lastIndex = 0
      const ws: LyricWord[] = []
      let pos = 0, cur: number | null = null
      for (let m = WORD_STAMP.exec(body); m; m = WORD_STAMP.exec(body)) {
        const piece = body.slice(pos, m.index).trim()
        if (piece && cur !== null) ws.push({ t: cur, w: piece })
        cur = ms(m[1], m[2], m[3]); pos = WORD_STAMP.lastIndex
      }
      const tail = body.slice(pos).trim()
      if (tail && cur !== null) ws.push({ t: cur, w: tail })
      WORD_STAMP.lastIndex = 0
      text = body.replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim()
      if (ws.length) words = ws
    }
    for (const t of stamps) out.push({ t: Math.max(0, t + offset), text, ...(words ? { words: words.map(w => ({ t: w.t + offset, w: w.w })) } : {}) })
  }
  out.sort((a, b) => a.t - b.t)
  // two stamps at the same time: keep the later text (duplicated translations)
  return out.filter((l, i) => !(i > 0 && out[i - 1].t === l.t && out[i - 1].text === l.text))
}

/** index of the line being sung at `tMs` (-1 before the first line) */
export function activeLine(lines: LyricLine[], tMs: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].t <= tMs) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

/**
 * Word start times for a line. Real word timing wins; otherwise the words are spread over the line (up to the next line, at
 * most 9 s, leaving a short breath before it) in proportion to their length, which reads like karaoke without being exact.
 */
export function wordTimes(line: LyricLine, nextT: number | undefined): LyricWord[] {
  if (line.words?.length) return line.words
  const words = line.text.split(' ').filter(Boolean)
  if (!words.length) return []
  const span = Math.max(600, Math.min(9000, (nextT ?? line.t + 4000) - line.t - 180))
  const weights = words.map(w => Array.from(w).length + 1)
  const total = weights.reduce((a, b) => a + b, 0)
  let acc = 0
  return words.map((w, i) => { const t = line.t + (acc / total) * span; acc += weights[i]; return { t, w } })
}

/** "Song (feat. X) - Remastered 2011" -> "Song": streaming apps decorate titles in ways lyric databases do not */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([](?:feat\.?|ft\.?|with|prod\.?)[^)\]]*[)\]]/gi, '')
    .replace(/\s*[([][^)\]]*(?:remaster|version|edit|live|mono|stereo|deluxe|bonus|explicit|from\s+["“]|original motion picture|soundtrack)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|single version|radio edit|live|mono|stereo|bonus track|from\s+["“]).*$/i, '')
    .replace(/\s+/g, ' ').trim()
}

/** "A, B & C" -> "A": the first credited artist matches best */
export function mainArtist(artist: string): string {
  return artist.split(/\s*(?:,|&|;| feat\.? | ft\.? | x | and )\s*/i)[0].trim()
}

export function trackKey(t: TrackQuery): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return `${norm(mainArtist(t.artist))}|${norm(cleanTitle(t.title))}|${Math.round(t.durationMs / 5000)}`
}

export function lyricsSelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('lyrics: ' + m) }
  const l = parseLrc('[ar:X]\n[offset:+500]\n[00:12.00] Hello world\n[00:20.5][01:00.25]Again\n[00:30.00]\n[00:05.00]<00:05.00>Fast <00:05.50>words')
  need(l.length === 5 && l[0].t === 5500 && l[0].text === 'Fast words' && l[0].words?.length === 2 && l[0].words[1].t === 6000, 'enhanced word tags + offset')
  need(l[1].t === 12500 && l[1].text === 'Hello world', 'plain line')
  need(l.filter(x => x.text === 'Again').length === 2 && l[l.length - 1].t === 60750, 'several stamps on one line, sorted')
  need(l.find(x => x.t === 30500)?.text === '', 'empty line kept as a gap')
  need(activeLine(l, 0) === -1 && activeLine(l, 5500) === 0 && activeLine(l, 99999) === l.length - 1 && activeLine(l, 13000) === 1, 'active line')
  const w = wordTimes({ t: 1000, text: 'one three' }, 5000)
  need(w.length === 2 && w[0].t === 1000 && w[1].t > 1000 && w[1].t < 5000, 'word times spread over the line')
  need(cleanTitle('Song Name (feat. Someone) - Remastered 2011') === 'Song Name' && cleanTitle('Kadhal (From "Movie")') === 'Kadhal', 'title cleaning')
  need(mainArtist('A. R. Rahman, Chinmayi') === 'A. R. Rahman', 'main artist')
  need(trackKey({ title: 'Song (Live)', artist: 'A & B', album: '', durationMs: 200000 }) === trackKey({ title: 'Song', artist: 'A', album: 'x', durationMs: 201000 }), 'same track, same key')
  return 'lyrics ok'
}
