// The voice ladder (docs/AI-FAILSAFE.md section 5), the decisions that do not need a socket or a window, so they can be checked on their own.
// Rungs, best first: Live on the first model id -> Live on another id -> cascade (speech-to-text on the kept audio, a text model answers) ->
// text answers -> text answers that are also spoken. Each rung drops to the next after one failed try; the person is told once.
export type Rung = 'live' | 'live-alt' | 'cascade' | 'text' | 'spoken-text'

/** what is left of a push-to-talk or typed turn when the Live socket dies under it: the typed text, the kept audio, or nothing worth keeping */
export function salvageKind(t: { typed: boolean; text: string; audioBytes: number }): 'text' | 'audio' | 'none' {
  if (t.typed && t.text.trim()) return 'text'
  // 16 kHz PCM16: 32 bytes a millisecond; under 300 ms is a tap or a click, not speech
  if (!t.typed && t.audioBytes > 32 * 300) return 'audio'
  return 'none'
}

/** which rung is active */
export function rungOf(o: { liveDown: boolean; usingAlternate: boolean; viaAudio: boolean; speak: boolean }): Rung {
  if (!o.liveDown) return o.usingAlternate ? 'live-alt' : 'live'
  if (o.viaAudio && !o.speak) return 'cascade'
  return o.speak ? 'spoken-text' : 'text'
}

/** the one line the person gets when the ladder drops (never one per attempt) */
export function rungNotice(rung: Rung, why: string): string {
  switch (rung) {
    case 'live-alt': return 'Voice switched to a backup Live model.'
    case 'cascade': return `${why}. Voice is using backup (speech to text, then a text answer) until Live recovers.`
    case 'text': return `${why}. Voice is using backup (text) until Live recovers.`
    case 'spoken-text': return `${why}. Voice is using backup (text + spoken) until Live recovers.`
    default: return 'Voice is back.'
  }
}

/** a plain sentence for the speaker: no markup, no links, a sensible length */
export function speakable(text: string, max = 500): string {
  const t = text.replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' link ').replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max), i = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return i > max / 3 ? cut.slice(0, i + 1) : cut + '...'
}

/** the language to speak in: Tamil letters -> Tamil, otherwise the system default (Chromium picks a matching installed voice) */
export const speakLang = (text: string) => (/[஀-௿]/.test(text) ? 'ta-IN' : '')
