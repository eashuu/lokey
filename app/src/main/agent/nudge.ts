// One path for every proactive nudge: daily budget, quiet hours, no nudges during focus, per-kind mute,
// and a kind that keeps being ignored loses priority until it stops getting through.
export interface NudgeState { day: string; sent: number; muted: string[]; ignored: Record<string, number> }
export interface NudgeEnv { now: Date; focus: boolean; budget?: number; quiet?: [number, number]; deliver: (kind: string, text: string) => void }
const st: NudgeState = { day: '', sent: 0, muted: [], ignored: {} }

export function nudge(kind: string, text: string, priority: number, env: NudgeEnv, s: NudgeState = st): boolean {
  const day = env.now.toDateString()
  if (s.day !== day) { s.day = day; s.sent = 0 }
  const h = env.now.getHours(), [qa, qb] = env.quiet ?? [22, 8]
  if (qa > qb ? h >= qa || h < qb : h >= qa && h < qb) return false
  if (env.focus || s.muted.includes(kind) || s.sent >= (env.budget ?? 5)) return false
  // each ignored nudge of this kind costs 2 priority points; urgent (>=9) always clears the bar
  if (priority - (s.ignored[kind] ?? 0) * 2 < 3 && priority < 9) return false
  s.sent++
  env.deliver(kind, text)
  return true
}
export const nudgeIgnored = (kind: string, s: NudgeState = st) => { s.ignored[kind] = (s.ignored[kind] ?? 0) + 1 }
export const nudgeActedOn = (kind: string, s: NudgeState = st) => { s.ignored[kind] = 0 }
export const muteNudges = (kind: string, s: NudgeState = st) => { if (!s.muted.includes(kind)) s.muted.push(kind) }

export function nudgeSelfCheck(): string {
  const s: NudgeState = { day: '', sent: 0, muted: [], ignored: {} }
  const out: string[] = []
  const env = (h: number, focus = false, budget = 2): NudgeEnv => ({ now: new Date(2026, 0, 5, h), focus, budget, deliver: (k, t) => out.push(k + t) })
  if (nudge('a', 'x', 5, env(23), s)) throw new Error('quiet hours')
  if (nudge('a', 'x', 5, env(12, true), s)) throw new Error('focus')
  if (!nudge('a', '1', 5, env(12), s) || !nudge('a', '2', 5, env(12), s) || nudge('a', '3', 5, env(12), s)) throw new Error('budget')
  const t: NudgeState = { day: '', sent: 0, muted: [], ignored: {} }
  nudgeIgnored('b', t); nudgeIgnored('b', t)
  if (nudge('b', 'x', 5, env(12), t)) throw new Error('ignored kind should drop')
  muteNudges('c', t); if (nudge('c', 'x', 9, env(12), t)) throw new Error('mute')
  return 'ok'
}
