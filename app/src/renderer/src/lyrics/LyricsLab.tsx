import { useState, useEffect } from 'react'
import { defaultSettings } from '@shared/bridge'
import { useData } from '@/lib/data'
import { LyricsWindow } from './LyricsWindow'
import { seedLyrics, trackId } from './useLyrics'

// QA page (#lyricslab, `--lab --lab-page lyricslab`): the lyrics window over fake data with the clock frozen, so the layout and the
// word sweep can be checked without a player or the network. ?pos=19200 sets the song position in ms.
const LINES = ['Moonlight on the water', 'carries every word I never said', 'and the city hums below', '', 'நிலா வெளிச்சம் நீரில் விழ', 'we keep drifting with the tide', 'one more time, one more time', 'hold the night a little longer']
const FAKE = { title: 'Sample Song', artist: 'Sample Artist', album: 'Sample', durationMs: 200_000 }

export function LyricsLab() {
  const [ready, setReady] = useState(false)
  const pos = Number(new URLSearchParams(location.hash.split('?')[1] ?? '').get('pos')) || 19200
  useEffect(() => {
    seedLyrics(trackId(FAKE), { key: 'lab', state: 'ready', source: 'cache', offsetMs: 0, lines: LINES.map((text, i) => ({ t: 8000 + i * 4500, text })) })
    useData.setState({
      settings: { ...defaultSettings, island: { ...defaultSettings.island, lyrics: 'on' } },
      media: { hasSession: true, app: 'Lab', ...FAKE, playing: false, positionMs: pos, sampledAt: Date.now(), art: null, canNext: true, canPrev: true, sessions: [], currentSession: null },
    })
    setReady(true)
  }, [pos])
  return <div style={{ position: 'absolute', inset: 0, width: 460, height: 700 }}>{ready && <LyricsWindow lab={{ pos }} />}</div>
}
