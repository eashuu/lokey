import { existsSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentTask } from '@shared/voice'
import type { FactKind, FactView, GraphView, JournalView, LessonView, MemoryStats, ProposalView, QuarantineView } from '@shared/memory'
import { taint as sessionTaint } from '../../ai/guard/taint'
import type { Schema } from '../../ai/runtime/schema'
import { dataDir, settings } from '../../settings'
import { isWait } from '../../ai/errors'
import { ai } from '../../ai/gateway'
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
  /** failed learning attempts in a row (the retry queue backs off with it) */
  private retries = 0
  private deps: LearnDeps = { chat: (role, req) => ai.call(role, req, { background: true, op: 'learn' }), embed: t => embed(t), json: (role, req, schema) => ai.callJson(role, req, schema, { background: true, op: 'learn' }) }

  constructor(store = new BrainStore().load(), deps?: Partial<LearnDeps>) { this.store = store; if (deps) this.deps = { ...this.deps, ...deps } }

  get paused() { return !settings.value.brain.learn }

  /** one finished exchange. `app`: the program in front at the time (excluded programs are never learned from). */
  note(t: Turn & { app?: string }) {
    if (this.paused || !t.user.trim() || sensitive(t.user)) return
    const app = (t.app ?? '').toLowerCase()
    if (app && settings.value.brain.excludeApps.some(x => x.trim() && app.includes(x.trim().toLowerCase()))) return
    this.queue.push({ user: t.user, assistant: t.assistant, tools: t.tools, tainted: t.tainted ?? sessionTaint.source() })
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
    try {
      // what was said right after reading outside content is learned separately and can only land in quarantine
      const groups = new Map<string, Turn[]>()
      for (const t of batch) { const k = t.tainted ?? ''; groups.set(k, [...(groups.get(k) ?? []), t]) }
      for (const [taint, turns] of groups) await learn(this.store, turns, this.deps, { taint })
      this.retries = 0
    } catch (e) {
      // no model reachable right now: keep the conversation and try again later (2, 4, 8... minutes, five times), instead of forgetting it
      if (isWait(e) && this.retries < 5 && this.queue.length + batch.length <= 80) {
        this.queue.unshift(...batch)
        this.timer = setTimeout(() => void this.flush(), 2 * 60_000 * 2 ** this.retries++)
        this.timer.unref?.()
      }
    } finally { this.busy = false }
  }

  // ---- reading ----
  /** what to put in a prompt: with a query, what is relevant to it; without, what matters most */
  forPrompt(query?: string): { facts: string[]; lessons: string[]; core: string } {
    const facts = (query ? this.store.search(query, { k: 10 }) : this.store.core(14)).map(f => f.text)
    const lessons = (query ? this.store.lessonsFor(query, 3) : [...this.store.d.lessons].sort((a, b) => b.hits - a.hits).slice(0, 3)).map(l => `${l.trigger}: ${l.advice}`)
    return { facts, lessons, core: this.store.d.core }
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
  stats(): MemoryStats { const d = this.store.d; const live = this.store.live(); return { facts: live.length, entities: d.entities.length, relations: d.relations.length, episodes: d.episodes.length, lessons: d.lessons.length, paused: this.paused, embedded: live.filter(f => f.emb).length, lastLearned: d.lastLearned, queued: this.queue.length, quarantined: this.store.quarantined().length, encrypted: this.store.backend?.encrypting ?? false, db: !!this.store.backend, plans: d.plans.length } }

  // ---- writing by hand (tools, the Bond page) ----
  async add(text: string, o: { kind?: FactKind; importance?: number; source?: string; pinned?: boolean; taint?: string } = {}): Promise<{ id: string; existing: boolean; quarantined?: boolean } | null> {
    const t = text.replace(/\s+/g, ' ').trim()
    if (t.length < 3 || sensitive(t)) return null
    const e = (await embed([t]))?.[0] ?? null
    const same = this.store.similar(t, e, 1)[0]
    if (same && same.score >= 0.9) { this.store.touch(same.fact.id); if (o.pinned) this.store.pin(same.fact.id, true); this.store.save(); return { id: same.fact.id, existing: true } }
    const f = this.store.add(t, { kind: o.kind ?? 'fact', importance: o.importance ?? 0.7, source: o.source ?? 'manual', pinned: o.pinned, emb: e, taint: o.taint })
    return { id: f.id, existing: false, ...(f.quarantined ? { quarantined: true } : {}) }
  }
  forget(text: string) { return this.store.forget(text) }
  remove(id: string) { return this.store.retire(id, 'removed by the user') }
  async edit(id: string, text: string) { if (sensitive(text)) return false; return !!this.store.update(id, text, 'edited by the user', (await embed([text]))?.[0] ?? null) }
  pin(id: string, on: boolean) { this.store.pin(id, on) }
  exportJson(): string { return JSON.stringify({ exported: new Date().toISOString(), facts: this.store.live().map(f => ({ text: f.text, kind: f.kind, importance: f.importance, pinned: !!f.pinned })), lessons: this.store.d.lessons.map(l => ({ trigger: l.trigger, advice: l.advice })), journal: this.store.d.journal }, null, 2) }
  clear() { this.queue = []; this.store.clear() }

  // ---- read-only views for the MCP server (retrieval rules only: no quarantined fact, nothing touched) ----
  peek(query: string, k: number): FactView[] { return this.store.search(query, { k }).map(f => this.store.view(f)) }
  recent(k: number): FactView[] { return [...this.store.live()].sort((a, b) => b.updated - a.updated).slice(0, k).map(f => this.store.view(f)) }
  pinned(): FactView[] { return this.store.live().filter(f => f.pinned).map(f => this.store.view(f)) }

  // ---- quarantine: what was learned from untrusted content waits here and is never used until the person approves it ----
  quarantine(): QuarantineView[] { return this.store.quarantineViews() }
  approve(id: string) { return this.store.approve(id) }
  reject(id: string) { return this.store.reject(id) }

  // ---- the core block: a short profile that is always in the prompt. Only the person (or an approved proposal) can change it. ----
  core(): string { return this.store.d.core }
  setCore(text: string) { this.store.d.core = text.replace(/\r/g, '').trim().slice(0, 1200); this.store.save() }
  proposals(): ProposalView[] { return this.store.d.proposals.map(p => ({ id: p.id, text: p.text, why: p.why, at: p.at })) }
  approveProposal(id: string) { const p = this.store.d.proposals.find(x => x.id === id); if (!p) return false; this.setCore(p.text); this.store.d.proposals = this.store.d.proposals.filter(x => x.id !== id); this.store.save(); return true }
  rejectProposal(id: string) { this.store.d.proposals = this.store.d.proposals.filter(x => x.id !== id); this.store.save() }

  // ---- per-app plan memory ----
  /** a screen task that ended in confirmed success becomes a reusable plan for that app (not from unattended runs or after outside content) */
  savePlan(app: string, goal: string, steps: string[]) { if (this.paused || sessionTaint.source() && !/screen/i.test(sessionTaint.source())) return; this.store.addPlan(app, goal, steps) }
  planHint(app: string, goal: string): string {
    const p = this.store.planFor(app, goal)
    return p ? `Last time this worked in ${p.app} (${p.successes}x): ${p.steps.slice(0, 12).join(' -> ')}. Use it as a hint only; check the screen.` : ''
  }

  /**
   * Sleep-time consolidation (on the background share of the free quota): give a vector to facts that lack one, fold duplicates and
   * contradictions the cheap upkeep missed, and propose (never apply) a refreshed core block. It sees only trusted facts and so can
   * never promote anything out of quarantine.
   */
  async consolidate(): Promise<{ reembedded: number; merged: number; invalidated: number; proposals: number }> {
    const out = { reembedded: 0, merged: 0, invalidated: 0, proposals: 0 }
    if (this.paused) return out
    const live = this.store.live()
    const need = live.filter(f => !f.emb).slice(0, 20)
    if (need.length) { const e = await this.deps.embed(need.map(f => f.text)).catch(() => null); if (e) need.forEach((f, i) => { if (e[i]) { f.emb = e[i]; out.reembedded++ } }) }
    const json = this.deps.json
    if (!json || live.length < 6) { if (out.reembedded) this.store.save(); return out }
    const ids = new Set(live.map(f => f.id))
    const list = [...live].sort((a, b) => b.updated - a.updated).slice(0, 60).map(f => ({ id: f.id, text: f.text, since: new Date(f.validFrom ?? f.created).toISOString().slice(0, 10) }))
    const schema: Schema = { type: 'object', props: { merge: { type: 'array', max: 10, items: { type: 'object', required: ['keep', 'drop'], props: { keep: { type: 'string', max: 40 }, drop: { type: 'string', max: 40 } } } }, contradicted: { type: 'array', max: 10, items: { type: 'object', required: ['old', 'new'], props: { old: { type: 'string', max: 40 }, new: { type: 'string', max: 40 } } } } } }
    try {
      const r = await json('fast', { system: 'You tidy a personal assistant\'s memory about its user. From the facts (id, text, since), list pairs that say the same thing (merge: keep one id, drop the other) and pairs where a NEWER fact contradicts an OLDER one (contradicted: the old id is no longer true, the new id replaces it). Only use ids from the list; when unsure, leave it out. Answer JSON {"merge":[{"keep":"id","drop":"id"}],"contradicted":[{"old":"id","new":"id"}]}.', messages: [{ role: 'user', text: JSON.stringify(list) }], json: true, temperature: 0, maxTokens: 500 }, schema) as { merge?: { keep: string; drop: string }[]; contradicted?: { old: string; new: string }[] }
      const t = Date.now()
      for (const m of r.merge ?? []) {
        const keep = this.store.fact(m.keep), drop = this.store.fact(m.drop)
        if (!keep || !drop || keep === drop || !ids.has(m.keep) || !ids.has(m.drop) || drop.pinned || drop.supersededBy || drop.gone) continue
        drop.supersededBy = keep.id; drop.validTo = t; keep.importance = Math.min(1, keep.importance + 0.05); this.store.d.ops.push({ at: t, op: 'MERGE', factId: drop.id, before: drop.text, after: keep.text, why: 'consolidation' }); out.merged++
      }
      for (const c of r.contradicted ?? []) {
        const old = this.store.fact(c.old), nu = this.store.fact(c.new)
        if (!old || !nu || old === nu || !ids.has(c.old) || !ids.has(c.new) || old.pinned || old.supersededBy || old.gone || (nu.validFrom ?? nu.created) < (old.validFrom ?? old.created)) continue
        old.supersededBy = nu.id; old.validTo = t; this.store.d.ops.push({ at: t, op: 'DELETE', factId: old.id, before: old.text, after: nu.text, why: 'contradicted by a newer fact' }); out.invalidated++
      }
    } catch { /* no model within the background share: the cheap upkeep already ran */ }
    // a refreshed core block is only ever a proposal
    try {
      const top = [...this.store.live()].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.importance - a.importance).slice(0, 25).map(f => f.text)
      if (top.length >= 5 && !this.store.d.proposals.length) {
        const r = await json('fast', { system: 'Write a short profile of the user (at most 8 plain lines, under 900 characters) from these facts, to sit at the top of an assistant\'s prompt: who they are, how they like things done, their people and projects. Only what the facts say. Answer JSON {"core":"..."}.', messages: [{ role: 'user', text: JSON.stringify({ current: this.store.d.core, facts: top }) }], json: true, temperature: 0.2, maxTokens: 400 }, { type: 'object', required: ['core'], props: { core: { type: 'string', max: 1200 } } }) as { core: string }
        const text = r.core.trim()
        if (text && text !== this.store.d.core.trim() && !sensitive(text)) { this.store.d.proposals.push({ id: Math.random().toString(36).slice(2, 8), kind: 'core', text, why: 'refreshed from your latest memories', at: Date.now() }); out.proposals++ }
      }
    } catch { /* same */ }
    if (out.reembedded || out.merged || out.invalidated || out.proposals) this.store.save()
    return out
  }

  // ---- once a day ----
  /** tidy (fade, merge) and write the day's journal line. Quiet when there is nothing new. */
  async reflect(force = false): Promise<void> {
    const d = this.store.d
    const t = Date.now()
    if (!force && t - d.lastReflect < 20 * 3_600_000) return
    d.lastReflect = t
    this.store.upkeep()
    await this.consolidate()
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
      } catch (e) { if (isWait(e)) d.lastReflect = t - 19 * 3_600_000 /* try again in about an hour */ }
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
    // the encryption setting changed: seal (or unseal) every row again
    let enc = settings.value.memory?.encrypt !== false
    settings.on('changed', () => { const now = settings.value.memory?.encrypt !== false; if (now !== enc) { enc = now; this.store.reseal() } })
    const tick = () => { void this.reflect(); weeklyTick() }
    setTimeout(tick, 60_000).unref?.()
    setInterval(tick, 3 * 3_600_000).unref?.()
  }

  /** best effort at shutdown: what was learned is on disk */
  dispose() { this.store.saveNow() }
}

export const memory = new Memory()
