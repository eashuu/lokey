import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../settings'

// Earned trust: an action the user keeps approving (same tool + same target) can become a "do not ask again" rule.
// 5 approvals, 0 denials, inside 30 days. A denial wipes the history and revokes the rule. Dangerous kinds never qualify.
const DAY = 86_400_000, NEED = 5, WINDOW = 30 * DAY
const NEVER_TOOL = /^(run_command|power|type_text|watch_start|routine_run|routine_delete|draft_reply)$|delete|remove|send|mail|message|sms|whatsapp|^mcp_|^ui_|^screen|^second_screen/i
const BAD_ORIGIN = new Set(['screen', 'web', 'mcp', 'remote'])
const TARGET_KEYS = ['name', 'query', 'path', 'url', 'what', 'app', 'title', 'key']

export function signature(tool: string, a: Record<string, unknown>): string {
  const k = TARGET_KEYS.find(x => typeof a[x] === 'string' && (a[x] as string).trim())
  return `${tool}|${k ? String(a[k]).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80) : ''}`
}
export function eligible(tool: string, origin?: string): boolean {
  return !NEVER_TOOL.test(tool) && !(origin && BAD_ORIGIN.has(origin))
}

interface Entry { yes: number[]; rule: boolean }
export class TrustBook {
  e: Record<string, Entry> = {}
  constructor(private now: () => number = Date.now, private save: (d: Record<string, Entry>) => void = () => {}) {}
  load(d: Record<string, Entry>) { this.e = d && typeof d === 'object' ? d : {} }
  has(sig: string) { return !!this.e[sig]?.rule }
  /** records an approval; true when the user should now be offered the rule */
  approve(sig: string): boolean {
    const t = this.now(), en = (this.e[sig] ??= { yes: [], rule: false })
    en.yes = [...en.yes, t].filter(x => t - x < WINDOW)
    this.save(this.e)
    return !en.rule && en.yes.length >= NEED
  }
  deny(sig: string) { delete this.e[sig]; this.save(this.e) }
  grant(sig: string) { (this.e[sig] ??= { yes: [], rule: false }).rule = true; this.save(this.e) }
  revoke(sig: string) { delete this.e[sig]; this.save(this.e) }
  rules() { return Object.keys(this.e).filter(s => this.e[s].rule) }
}

const file = join(dataDir, 'trust.json')
export const trust = new TrustBook(Date.now, d => { try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file, JSON.stringify(d)) } catch { /* in-memory only */ } })
try { trust.load(JSON.parse(readFileSync(file, 'utf8'))) } catch { /* first run */ }

export function trustSelfCheck(): string {
  let t = 1_000_000
  const b = new TrustBook(() => t)
  const s = signature('open_app', { name: '  Chrome ' })
  if (s !== 'open_app|chrome') throw new Error('signature ' + s)
  for (let i = 0; i < 4; i++) if (b.approve(s)) throw new Error('offered early')
  if (!b.approve(s)) throw new Error('not offered at 5')
  b.grant(s); if (!b.has(s)) throw new Error('grant')
  b.deny(s); if (b.has(s)) throw new Error('deny keeps rule')
  for (let i = 0; i < 4; i++) { t += DAY * 10; b.approve(s) }
  if (b.approve(s)) throw new Error('old approvals should have expired')
  if (eligible('run_command') || eligible('send_email') || eligible('mcp_x_y') || eligible('open_app', 'web')) throw new Error('never-list')
  if (!eligible('open_app', 'voice')) throw new Error('open_app should qualify')
  return 'ok'
}
