import type { ConfirmRequest } from './voice'

// The pure side of "asks inside the island": what the card says, how tall it is, when Allow becomes live and what a key does.
// The main process (agent/permissions.ts) owns the queue, the timer and the answer; the island page only draws what it is told
// (AskState) and reports (id, ok) back, the same answer the separate confirm window gives.

/** what the main process tells the island: the request on screen (with its absolute expiry) and how many wait behind it */
export interface AskState { cur: (ConfirmRequest & { expiresAt: number }) | null; more: number }

/** Allow ignores clicks and the chord for this long after the card appears, so a click aimed at something else cannot land on it */
export const ARM_MS = 650

/** policy card kinds (ai/guard/policy.ts CARD_LABEL) as short chip words */
const CHIP: Record<string, string> = { send: 'Send', buy: 'Purchase', publish: 'Publish', delete: 'Delete', 'share-personal': 'Personal info', credential: 'Credential', run: 'Run' }

export interface AskView {
  chip: string
  title: string
  detail: string
  src: string
  handoff: boolean
  allow: string
  deny: string
  /** a policy-typed card: drawn with a warmer chip */
  typed: boolean
}

export function askView(r: Pick<ConfirmRequest, 'title' | 'detail' | 'cls' | 'kind' | 'src'>): AskView {
  const handoff = r.kind === 'handoff'
  const chip = handoff ? 'Your turn' : r.cls && CHIP[r.cls] ? CHIP[r.cls] : 'Lokey wants to'
  let title = (r.title || '').trim()
  // the policy engine already prefixes its title with the same word; the chip says it once
  const m = /^([A-Za-z][A-Za-z ]{2,20}): /.exec(title)
  if (m && r.cls && !handoff && title.length > m[0].length) title = title.slice(m[0].length)
  // the source reads as its own line; do not repeat it inside the detail
  title = title.charAt(0).toUpperCase() + title.slice(1)
  let detail = (r.detail || '').replace(/\s+/g, ' ').trim()
  const src = (r.src || '').trim()
  if (src) detail = detail.split(/(?<=[.!?]) /).filter(s => !s.includes(src)).join(' ')
  return { chip, title: title.slice(0, 140), detail: detail.slice(0, 600), src: src.slice(0, 120), handoff, allow: handoff ? "I'm done" : 'Allow', deny: handoff ? 'Skip' : 'Deny', typed: !handoff && !!r.cls }
}

const lines = (s: string, perLine: number, max: number) => (s ? Math.min(max, Math.max(1, Math.ceil(s.length / perLine))) : 0)

/** card height in design pixels for a 380 px wide card (padding 18, 15 px title, 12.5 px detail) */
export const ASK_W = 380
export function askHeight(v: Pick<AskView, 'title' | 'detail' | 'src'>): number {
  const t = lines(v.title, 36, 2), d = lines(v.detail, 54, 4)
  return 18 + 16 + 8 + t * 20 + (v.src ? 22 : 0) + (d ? 6 + d * 17 : 0) + 16 + 34 + 18
}

export const remainingMs = (expiresAt: number, now: number) => Math.max(0, expiresAt - now)
export const armed = (shownAt: number, now: number) => now - shownAt >= ARM_MS
/** "24 s" under a minute, "1:40" above */
export const clockText = (ms: number) => { const s = Math.ceil(ms / 1000); return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export interface KeyLike { key: string; repeat?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean }
/**
 * What a key does when the card page receives it (that only happens when the island has the keyboard, e.g. the person pinned it): Esc denies,
 * nothing else answers. Enter and Space work through the focused button itself, so typing elsewhere can never approve; "deny" is the only
 * answer a stray key can give. The global chords live in the main process and are armed only while a card is showing.
 */
export function keyAction(e: KeyLike, cardHasFocus: boolean): 'deny' | null {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return null
  return cardHasFocus && e.key === 'Escape' ? 'deny' : null
}

/** Allow from a click, key or chord is honoured only when the card is armed, still current and not expired */
export function mayAllow(s: AskState, id: string, shownAt: number, now: number): boolean {
  return !!s.cur && s.cur.id === id && armed(shownAt, now) && now < s.cur.expiresAt
}
