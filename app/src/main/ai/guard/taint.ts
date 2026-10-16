// Session taint (round-9 plan 3.7, steps 2 and 5.4): the bookkeeping behind the Rule of Two.
// An agent session may hold at most two of: [A] untrusted input (web pages, screens, mail, files from outside, MCP results),
// [B] sensitive data (memory, files, the timeline: Lokey always carries the person's memory, so B is held by default), and
// [C] the power to change state or communicate outward. Holding all three, every [C] action asks, whatever the autonomy level or
// earned trust. This module remembers WHICH untrusted content was read, and the destinations (addresses, paths, commands) it
// contained, so an argument that came out of untrusted text can be recognised and shown to the person ("this address came from a web page").
export const TAINT_TTL_MS = 10 * 60_000
const MAX_TOKENS = 300

const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/gi
const MAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g
const PATH_RE = /[A-Za-z]:\\[^\s"'<>|*?]{3,}|\\\\[\w.$-]+\\[^\s"']+/g
const CMD_RE = /(?:^|\n)[ \t]*(?:\$|PS>|>)[ \t]*([^\n]{6,200})|(?:^|\n)[ \t]*((?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|powershell|cmd|rm|del|Remove-Item|certutil|bitsadmin)\b[^\n]{3,200})/gi

const trimEnd = (s: string) => s.replace(/[.,;:!?'")\]}]+$/, '')
const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase() } catch { return '' } }

/** the destinations and commands found in a piece of text, lower-cased */
export function extractTokens(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(URL_RE)) { const u = trimEnd(m[0]).toLowerCase(); out.add(u); const h = hostOf(u); if (h) out.add(h) }
  for (const m of text.matchAll(MAIL_RE)) out.add(trimEnd(m[0]).toLowerCase())
  for (const m of text.matchAll(PHONE_RE)) { const d = m[0].replace(/\D/g, ''); if (d.length >= 9) out.add(d) }
  for (const m of text.matchAll(PATH_RE)) out.add(trimEnd(m[0]).toLowerCase())
  for (const m of text.matchAll(CMD_RE)) out.add((m[1] ?? m[2] ?? '').trim().toLowerCase())
  return [...out].filter(t => t.length >= 6)
}

const flat = (v: unknown, depth = 0): string[] => (typeof v === 'string' ? [v] : depth > 3 || !v || typeof v !== 'object' ? [] : Object.values(v as object).flatMap(x => flat(x, depth + 1)))

export class Taint {
  private at = 0
  private src = ''
  private tokens = new Map<string, string>()
  /** a classifier flagged the content as an injection attempt (the optional Prompt Guard hook) */
  hostile = false
  /** [B]: sensitive data in reach. Always true in the app (the assistant carries the person's memory); tests turn it off to show the rule needs all three. */
  sensitive = true
  constructor(private now: () => number = Date.now) {}

  /** untrusted content was read; `text` (optional) is scanned for destinations */
  read(src: string, text = '', hostile = false) {
    this.at = this.now(); this.src = src
    if (hostile) this.hostile = true
    for (const t of extractTokens(text)) { this.tokens.delete(t); this.tokens.set(t, src) }
    while (this.tokens.size > MAX_TOKENS) this.tokens.delete(this.tokens.keys().next().value as string)
  }
  /** [A] is held right now */
  get untrusted() { return this.now() - this.at < TAINT_TTL_MS && this.at > 0 }
  source() { return this.untrusted ? this.src : '' }
  /** all three legs held: every state change must ask */
  ruleOfTwo(): boolean { return this.untrusted && this.sensitive }
  /** the first argument value that contains (or is the start of) something found in untrusted text */
  flows(args: Record<string, unknown>): { src: string; token: string } | null {
    if (!this.untrusted) return null
    for (const raw of flat(args)) {
      const v = raw.toLowerCase().trim()
      if (v.length < 6) continue
      for (const [t, src] of this.tokens) if (v.includes(t) || (v.length >= 10 && t.startsWith(v))) return { src, token: t }
    }
    return null
  }
  clear() { this.at = 0; this.src = ''; this.tokens.clear(); this.hostile = false }
}

export const taint = new Taint()
