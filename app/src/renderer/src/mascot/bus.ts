// Tiny event bus between the app and every mascot instance in this window: `mascot.play('celebrate')`,
// `mascot.emote('idea')`, speech level for lip-sync and the pointer for eye contact.

export type EmoteKind = 'think' | 'alert' | 'sleep' | 'idea' | 'success' | 'love' | 'sweat' | 'search' | 'clock' | 'write' | 'music' | 'muted' | 'error' | 'wave'

/** 3 = critical (voice results, errors, a confirm card), 2 = a reaction to something the user did, 1 = ambient (idle fidgets, greetings) */
export type Prio = 1 | 2 | 3
export interface PlayOpts { prio?: Prio }

type Ev = { type: 'play'; name: string; opts?: PlayOpts } | { type: 'emote'; kind: EmoteKind }
const listeners = new Set<(e: Ev) => void>()
const emit = (e: Ev) => listeners.forEach(f => f(e))

// Nobody listens while the mascot is hidden (sleeping notch, open menu). A reaction that happens then is kept for a moment and
// shown when the mascot appears, instead of being lost or played long after the fact.
const KEEP_MS = 2500
let waiting: { name: string; opts?: PlayOpts; at: number }[] = []

// Emotes are small floating icons: never a burst of them. One at a time, the same kind not again right away.
let lastEmoteAt = 0
const lastKind: Partial<Record<EmoteKind, number>> = {}

export const mascot = {
  /** one-shot pose or action by name (see poses.ts); returns to the state pose when it ends */
  play: (name: string, opts?: PlayOpts) => {
    if (!listeners.size) { waiting = [...waiting.filter(w => performance.now() - w.at < KEEP_MS), { name, opts, at: performance.now() }].slice(-3); return }
    emit({ type: 'play', name, opts })
  },
  emote: (kind: EmoteKind) => {
    const now = performance.now()
    if (kind !== 'error' && (now - lastEmoteAt < 600 || now - (lastKind[kind] ?? -1e9) < 1500)) return
    lastEmoteAt = now; lastKind[kind] = now
    emit({ type: 'emote', kind })
  },
  on: (f: (e: Ev) => void) => {
    listeners.add(f)
    const now = performance.now()
    const late = waiting.filter(w => now - w.at < KEEP_MS && (w.opts?.prio ?? 2) >= 2).slice(-1)
    waiting = []
    for (const w of late) f({ type: 'play', name: w.name, opts: w.opts })
    return () => { listeners.delete(f) }
  },

  /** speech output level 0..1 (drives the mouth while talking); stale after 300 ms */
  level: 0,
  levelAt: 0,
  setLevel(v: number) { this.level = v; this.levelAt = performance.now() },

  /** where the pointer is relative to the mascot, -1..1 (+y = up); `at` = when it was last seen */
  gaze: { x: 0, y: 0, at: 0 },
  look(x: number, y: number) { this.gaze.x = Math.max(-1, Math.min(1, x)); this.gaze.y = Math.max(-1, Math.min(1, y)); this.gaze.at = performance.now() },
  lookAway() { this.gaze.at = 0 },
}
