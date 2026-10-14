import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentTask } from '@shared/voice'
import type { FactKind, FactView, GraphView, JournalView, LessonView, MemoryStats } from '@shared/memory'
import { dataDir, settings } from '../../settings'
import { router } from '../router'
import { embed } from './embed'
import { learn, parseJson, type LearnDeps, type Turn } from './learn'
import { sensitive } from './search'
import { weeklyTick } from '../weekly'
import { BrainStore } from './store'

// The memory facade the rest of the app talks to. It owns the store, collects what happened in conversations and jobs, learns from
// it in the background (batched, so a long chat costs a couple of cheap calls, not one per sentence), answers "what do I know about
// this?" for prompts and tools, and tidies up once a day.
const FLUSH_AFTER_MS = 90_000
const FLUSH_AT = 6

export class Memory {
  readonly store: BrainStore
  private queue: Turn[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private busy = false
  private deps: LearnDeps = { chat: (role, req) => router.chat(role, req), embed: t => embed(t) }

  constructor(store = new BrainStore().load(), deps?: Partial<LearnDeps>) { this.store = store; if (deps) this.deps = { ...this.deps, ...deps } }

  get paused() { return !settings.value.brain.learn }

  /** one finished exchange. `app`: the program in front at the time (excluded programs are never learned from). */
  note(t: Turn & { app?: string }) {
    if (this.paused || !t.user.trim() || sensitive(t.user)) return
    const app = (t.app ?? '').toLowerCase()
    if (app && settings.value.brain.excludeApps.some(x => x.trim() && app.includes(x.trim().toLowerCase()))) return
    this.queue.push({ user: t.user, assistant: t.assistant, tools: t.tools })
    if (this.queue.length >= FLUSH_AT) void this.flush()
    else { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => void this.flush(), FLUSH_AFTER_MS); this.timer.unref?.() }
  }

  /** a finished background job becomes an episode; a failure becomes a lesson */
  noteJob(t: AgentTask) {
    if (this.paused || t.status === 'stopped') return
    this.store.episode({ kind: 'job', summary: t.title.slice(0, 120), tools: [t.backend === 'api' ? t.role : t.backend], outcome: t.status === 'done' ? 'ok' : 'failed' })
    if (t.status === 'failed' && t.result && !sensitive(t.result)) this.store.addLesson(`when asked to ${t.title.slice(0, 60)}`, `it failed before: ${t.result.replace(/\s+/g, ' ').slice(0, 140)}`)
  }

  /** learn from everything collected so far (also called when a conversation ends) */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (this.busy || !this.queue.length || this.paused) return
    this.busy = true
    const batch = this.queue.splice(0)
    try { await learn(this.store, batch, this.deps) } catch { /* no model reachable right now: the conversation just is not learned from */ } finally { this.busy = false }
  }

  // ---- reading ----
  /** what to put in a prompt: with a query, what is relevant to it; without, what matters most */
  forPrompt(query?: string): { facts: string[]; lessons: string[] } {
    const facts = (query ? this.store.search(query, { k: 10 }) : this.store.core(14)).map(f => f.text)
    const lessons = (query ? this.store.lessonsFor(query, 3) : [...this.store.d.lessons].sort((a, b) => b.hits - a.hits).slice(0, 3)).map(l => `${l.trigger}: ${l.advice}`)
    return { facts, lessons }
  }

  async recall(query: string, k = 6): Promise<FactView[]> {
    const q = query.trim()
    if (!q) return []
    const qe = (await embed([q], 'query'))?.[0] ?? null
    const hits = this.store.search(q, { qemb: qe, k })
    for (const f of hits) this.store.touch(f.id)
    return hits.map(f => this.store.view(f))
  }

  list(): FactView[] { return [...this.store.live()].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated).map(f => this.store.view(f)) }
  graph(): GraphView { return this.store.graph() }
  lessons(): LessonView[] { return this.store.lessonViews() }
  setJournal(day: string, text: string) { this.store.d.journal[day] = text.slice(0, 500); this.store.save() }
  journal(): JournalView[] { return Object.entries(this.store.d.journal).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 14).map(([day, text]) => ({ day, text })) }
  stats(): MemoryStats { const d = this.store.d; const live = this.store.live(); return { facts: live.length, entities: d.entities.length, relations: d.relations.length, episodes: d.episodes.length, lessons: d.lessons.length, paused: this.paused, embedded: live.filter(f => f.emb).length, lastLearned: d.lastLearned, queued: this.queue.length } }

  // ---- writing by hand (tools, the Bond page) ----
  async add(text: string, o: { kind?: FactKind; importance?: number; source?: string; pinned?: boolean } = {}): Promise<{ id: string; existing: boolean } | null> {
    const t = text.replace(/\s+/g, ' ').trim()
    if (t.length < 3 || sensitive(t)) return null
    const e = (await embed([t]))?.[0] ?? null
    const same = this.store.similar(t, e, 1)[0]
    if (same && same.score >= 0.9) { this.store.touch(same.fact.id); if (o.pinned) this.store.pin(same.fact.id, true); this.store.save(); return { id: same.fact.id, existing: true } }
    const f = this.store.add(t, { kind: o.kind ?? 'fact', importance: o.importance ?? 0.7, source: o.source ?? 'manual', pinned: o.pinned, emb: e })
    return { id: f.id, existing: false }
  }
  forget(text: string) { return this.store.forget(text) }
  remove(id: string) { return this.store.retire(id, 'removed by the user') }
  async edit(id: string, text: string) { if (sensitive(text)) return false; return !!this.store.update(id, text, 'edited by the user', (await embed([text]))?.[0] ?? null) }
  pin(id: string, on: boolean) { this.store.pin(id, on) }
  exportJson(): string { return JSON.stringify({ exported: new Date().toISOString(), facts: this.store.live().map(f => ({ text: f.text, kind: f.kind, importance: f.importance, pinned: !!f.pinned })), lessons: this.store.d.lessons.map(l => ({ trigger: l.trigger, advice: l.advice })), journal: this.store.d.journal }, null, 2) }
  clear() { this.queue = []; this.store.clear() }

  // ---- once a day ----
  /** tidy (fade, merge) and write the day's journal line. Quiet when there is nothing new. */
  async reflect(force = false): Promise<void> {
    const d = this.store.d
    const t = Date.now()
    if (!force && t - d.lastReflect < 20 * 3_600_000) return
    d.lastReflect = t
    this.store.upkeep()
    const day = new Date().toISOString().slice(0, 10)
    const since = t - 24 * 3_600_000
    const eps = d.episodes.filter(e => e.at > since)
    const added = this.store.live().filter(f => f.created > since)
    if (!d.journal[day] && (eps.length || added.length) && !this.paused) {
      try {
        const r = await this.deps.chat('fast', {
          system: 'Write a two-sentence journal entry about the user\'s day with their PC assistant, from the episodes and new memories. Plain, warm, specific; no advice. Output JSON {"text":"..."}.',
          messages: [{ role: 'user', text: JSON.stringify({ episodes: eps.map(e => `${e.kind}: ${e.summary} (${e.outcome})`).slice(0, 20), learned: added.map(f => f.text).slice(0, 12) }) }], json: true, temperature: 0.4, maxTokens: 200,
        })
        const text = parseJson(r.text)?.text
        if (typeof text === 'string' && text.trim() && !sensitive(text)) d.journal[day] = text.trim().slice(0, 500)
      } catch { /* no model: no journal today */ }
    }
    this.store.save()
  }

  /** the old flat memory.json becomes facts, once */
  migrate() {
    const f = join(dataDir, 'memory.json')
    if (!existsSync(f) || this.store.d.facts.length) return
    try {
      const old = JSON.parse(readFileSync(f, 'utf8')) as unknown
      if (Array.isArray(old)) for (const t of old) if (typeof t === 'string' && t.trim() && !sensitive(t)) this.store.add(t, { source: 'migrated', importance: 0.6, kind: 'fact' })
      renameSync(f, join(dataDir, 'memory.migrated.json'))
      this.store.saveNow()
    } catch { /* leave it where it is */ }
  }

  start() {
    this.migrate()
    const tick = () => { void this.reflect(); weeklyTick() }
    setTimeout(tick, 60_000).unref?.()
    setInterval(tick, 3 * 3_600_000).unref?.()
  }

  /** best effort at shutdown: what was learned is on disk */
  dispose() { this.store.saveNow() }
}

export const memory = new Memory()
