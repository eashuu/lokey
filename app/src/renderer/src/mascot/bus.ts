// Tiny event bus between the app and every mascot instance in this window: `mascot.play('celebrate')`,
// `mascot.emote('idea')`, speech level for lip-sync and the pointer for eye contact.

export type EmoteKind = 'think' | 'alert' | 'sleep' | 'idea' | 'success' | 'love' | 'sweat' | 'search' | 'clock' | 'write' | 'music' | 'muted' | 'error' | 'wave'

type Ev = { type: 'play'; name: string } | { type: 'emote'; kind: EmoteKind }
const listeners = new Set<(e: Ev) => void>()
const emit = (e: Ev) => listeners.forEach(f => f(e))

export const mascot = {
  /** one-shot pose or action by name (see poses.ts); returns to the state pose when it ends */
  play: (name: string) => emit({ type: 'play', name }),
  emote: (kind: EmoteKind) => emit({ type: 'emote', kind }),
  on: (f: (e: Ev) => void) => { listeners.add(f); return () => { listeners.delete(f) } },

  /** speech output level 0..1 (drives the mouth while talking); stale after 300 ms */
  level: 0,
  levelAt: 0,
  setLevel(v: number) { this.level = v; this.levelAt = performance.now() },

  /** where the pointer is relative to the mascot, -1..1 (+y = up); `at` = when it was last seen */
  gaze: { x: 0, y: 0, at: 0 },
  look(x: number, y: number) { this.gaze.x = Math.max(-1, Math.min(1, x)); this.gaze.y = Math.max(-1, Math.min(1, y)); this.gaze.at = performance.now() },
  lookAway() { this.gaze.at = 0 },
}
