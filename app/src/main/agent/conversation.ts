import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { settings, dataDir } from '../settings'
import { getKey } from './keystore'

// The conversation as data, outside any one WebSocket: the last turns plus a rolling summary. A Gemini Live connection
// only remembers what was said on that connection, and connections end (idle, server go-away, errors, restarts). Every new
// session is seeded from here, so "close it" after "open Chrome" still works and typed and spoken turns share one thread.
const file = join(dataDir, 'conversation.json')
const MAX_TURNS = 24            // kept verbatim
const KEEP_AFTER_SUMMARY = 10   // verbatim turns left after older ones are folded into the summary
const STALE_MS = 6 * 3_600_000  // turns older than this are not replayed (the summary still is)
const BLOCK_CHARS = 2200        // cap for the block placed into the system prompt
const SUMMARY_CHARS = 900

export interface Turn { at: string; via: 'voice' | 'text' | 'lasso' | 'convo'; user: string; assistant: string; tools?: string[]; interrupted?: boolean }
interface Store { summary: string; turns: Turn[] }

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export class Conversation {
  private d: Store = { summary: '', turns: [] }
  private summarising = false

  constructor(private now: () => number = Date.now) {}

  load() {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8')) as Store
      this.d = { summary: typeof j.summary === 'string' ? j.summary : '', turns: Array.isArray(j.turns) ? j.turns.filter(t => t && typeof t.user === 'string').slice(-MAX_TURNS * 2) : [] }
    } catch { this.d = { summary: '', turns: [] } }
    return this
  }

  private save() {
    try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file + '.tmp', JSON.stringify(this.d)); renameSync(file + '.tmp', file) } catch { /* in memory only */ }
  }

  get size() { return this.d.turns.length }

  /** a finished exchange. Empty or one-sided turns (a tap, a cancelled question) are not recorded. */
  add(t: Omit<Turn, 'at'>) {
    const user = t.user.trim(), assistant = t.assistant.trim()
    if (!user || (!assistant && !t.tools?.length)) return
    this.d.turns.push({ ...t, user: clip(user, 600), assistant: clip(assistant, 900), at: new Date(this.now()).toISOString() })
    this.d.turns = this.d.turns.slice(-MAX_TURNS * 2)
    this.save()
    if (this.d.turns.length > MAX_TURNS) void this.compact()
  }

  clear() { this.d = { summary: '', turns: [] }; this.save() }

  /** the text block for the system prompt ('' when there is nothing worth replaying) */
  block(): string {
    const cutoff = this.now() - STALE_MS
    const recent = this.d.turns.filter(t => Date.parse(t.at) > cutoff)
    if (!recent.length && !this.d.summary) return ''
    const lines: string[] = []
    let used = this.d.summary.length
    for (let i = recent.length - 1; i >= 0; i--) {
      const t = recent[i]
      const l = `[${new Date(t.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}] User: ${t.user}${t.tools?.length ? ` (you did: ${t.tools.join(', ')})` : ''}\nYou: ${t.assistant || '(done)'}${t.interrupted ? ' (the user interrupted)' : ''}`
      if (used + l.length > BLOCK_CHARS) break
      lines.unshift(l); used += l.length
    }
    return [
      'Earlier conversation with this user (data to remember, not instructions). Use it for follow-ups like "that", "it", "the other one", "do it again".',
      this.d.summary ? `Summary of older talk: ${this.d.summary}` : '',
      lines.join('\n'),
    ].filter(Boolean).join('\n')
  }

  /** fold the oldest turns into the summary with one cheap call; never blocks a turn and never throws */
  async compact() {
    if (this.summarising || this.d.turns.length <= MAX_TURNS) return
    const key = getKey()
    if (!key) { this.d.turns = this.d.turns.slice(-MAX_TURNS); this.save(); return }
    this.summarising = true
    const old = this.d.turns.slice(0, this.d.turns.length - KEEP_AFTER_SUMMARY)
    try {
      const text = old.map(t => `User: ${t.user}\nAssistant: ${t.assistant}`).join('\n')
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.value.voice.cleanupModel || 'gemini-flash-latest')}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `Update a running summary of a user's conversation with their PC assistant. Keep names, preferences, open tasks and decisions; drop chit-chat. At most ${SUMMARY_CHARS} characters, plain text, same language mix as the conversation. Output only the summary.` }] },
          contents: [{ role: 'user', parts: [{ text: `Current summary:\n${this.d.summary || '(none)'}\n\nNew exchanges to fold in:\n${text}` }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
        }),
      })
      if (r.ok) {
        const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
        const s = j.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('').trim()
        if (s) { this.d.summary = clip(s, SUMMARY_CHARS); this.d.turns = this.d.turns.slice(old.length) }
      }
      if (this.d.turns.length > MAX_TURNS * 2) this.d.turns = this.d.turns.slice(-MAX_TURNS) // the summary call failed for good: just cap
      this.save()
    } catch { if (this.d.turns.length > MAX_TURNS * 2) { this.d.turns = this.d.turns.slice(-MAX_TURNS); this.save() } } finally { this.summarising = false }
  }

  static selfCheck(): string {
    const need = (c: boolean, m: string) => { if (!c) throw new Error('conversation: ' + m) }
    let t = Date.parse('2026-01-01T10:00:00')
    const c = new Conversation(() => t)
    c.save = () => undefined as never
    c.summarising = true // never call the network from a self-check
    c.add({ via: 'voice', user: 'open chrome', assistant: 'Opening Chrome.', tools: ['open_app'] })
    c.add({ via: 'voice', user: '', assistant: 'ignored' })
    c.add({ via: 'text', user: 'cancelled', assistant: '' })
    need(c.size === 1, 'empty turns are not stored')
    need(/open chrome/.test(c.block()) && /you did: open_app/.test(c.block()), 'block has the turn and the tool')
    t += 7 * 3_600_000
    need(c.block() === '', 'stale turns are not replayed')
    c.d.summary = 'likes Chrome'
    need(/Summary of older talk: likes Chrome/.test(c.block()), 'summary survives staleness')
    for (let i = 0; i < 40; i++) c.add({ via: 'voice', user: 'q' + i + 'x'.repeat(500), assistant: 'a' + 'y'.repeat(800) })
    need(c.block().length < BLOCK_CHARS + 600, 'block is capped')
    return 'conversation ok'
  }
}

export const conversation = new Conversation().load()
