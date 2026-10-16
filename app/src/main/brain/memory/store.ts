import { join } from 'node:path'
import type { FactKind, FactView, GraphView, LessonView, QuarantineView } from '@shared/memory'
import { dataDir, settings } from '../../settings'
import { getDb, readDoc, writeDoc } from '../../ai/db'
import { SqlBackend } from '../../ai/memory/sqlstore'
import { Vault } from '../../ai/memory/vault'
import { cosine, jaccardMax, overlap, rank, tokens, type Doc } from './search'

// What Lokey knows, as plain data in one file (brain.json): atomic facts about the user, the people, projects and places they
// mention (entities) and how they relate, short episodes (what happened in a conversation or job), lessons (how to do things for
// THIS user) and a daily journal. Nothing is ever hard-deleted by the engine itself: a fact that is replaced is kept as history
// (`supersededBy`), and every change is appended to an operation log, so "why does it think that?" always has an answer.
/** how far a fact can be believed: confirmed (the person said or approved it), inferred (the assistant concluded it), untrusted (learned while reading outside content) */
export type Trust = 'confirmed' | 'inferred' | 'untrusted'
export type Origin = 'user-said' | 'agent-inferred' | 'screen' | 'web' | 'email' | 'mcp' | 'phone' | 'import'
export interface Fact {
  id: string; text: string; kind: FactKind; entities: string[]; source: string
  importance: number; confidence: number
  created: number; updated: number; lastSeen: number
  pinned?: boolean; supersededBy?: string; gone?: boolean
  emb?: number[] | null
  /** bi-temporal: when it became true (validFrom) and, once replaced or retracted, when it stopped (validTo); `created` is when Lokey recorded it */
  validFrom?: number; validTo?: number | null
  trust?: Trust; origin?: Origin
  /** the untrusted source in force when it was learned ('' / absent = none) */
  taint?: string
  /** learned from untrusted content and not yet approved: never retrieved, never put in a prompt */
  quarantined?: boolean
}
export interface Proposal { id: string; kind: 'core'; text: string; why: string; at: number }
/** per-app plan memory: how a screen task was done successfully in an app */
export interface PlanMem { id: string; app: string; goal: string; steps: string[]; successes: number; at: number }
export interface Entity { id: string; name: string; type: string; created: number }
export interface Relation { id: string; src: string; rel: string; dst: string; at: number }
export interface Episode { id: string; at: number; kind: 'chat' | 'job'; summary: string; tools: string[]; outcome: 'ok' | 'failed' | 'denied' | 'corrected' }
export interface Lesson { id: string; trigger: string; advice: string; hits: number; at: number; emb?: number[] | null }
export interface Op { at: number; op: 'ADD' | 'UPDATE' | 'DELETE' | 'FORGET' | 'MERGE'; factId: string; before?: string; after?: string; why?: string }
export interface Data { v: 1 | 2; facts: Fact[]; entities: Entity[]; relations: Relation[]; episodes: Episode[]; lessons: Lesson[]; journal: Record<string, string>; ops: Op[]; lastReflect: number; lastLearned: number | null; core: string; proposals: Proposal[]; plans: PlanMem[] }

const file = join(dataDir, 'brain.json')
const id = () => Math.random().toString(36).slice(2, 10)
const MAX_FACTS = 2500, MAX_EPISODES = 400, MAX_OPS = 1500, MAX_LESSONS = 120

export const emptyData = (): Data => ({ v: 2, facts: [], entities: [], relations: [], episodes: [], lessons: [], journal: {}, ops: [], lastReflect: 0, lastLearned: null, core: '', proposals: [], plans: [] })

/** facts written by older builds get their provenance filled in from the source string */
export function upgrade(d: Data): Data {
  for (const f of d.facts) {
    if (!f.trust) { f.trust = f.source === 'manual' ? 'confirmed' : 'inferred' }
    if (!f.origin) f.origin = f.source === 'manual' ? 'user-said' : f.source === 'phone' ? 'phone' : f.source === 'migrated' ? 'import' : 'agent-inferred'
    if (f.validFrom === undefined) f.validFrom = f.created
    if (f.validTo === undefined && (f.gone || f.supersededBy)) f.validTo = f.updated
  }
  d.core ??= ''; d.proposals ??= []; d.plans ??= []
  d.v = 2
  return d
}
const ORIGIN_OF_TAINT = (t: string): Origin => /screen/i.test(t) ? 'screen' : /mail|calendar/i.test(t) ? 'email' : /web|page|search/i.test(t) ? 'web' : /mcp|server/i.test(t) ? 'mcp' : 'web'
export const provenance = (source: string, taint: string): { trust: Trust; origin: Origin; quarantined: boolean } =>
  taint ? { trust: 'untrusted', origin: ORIGIN_OF_TAINT(taint), quarantined: true }
    : source === 'manual' ? { trust: 'confirmed', origin: 'user-said', quarantined: false }
      : source === 'phone' ? { trust: 'inferred', origin: 'phone', quarantined: false }
        : source === 'migrated' || source === 'import' ? { trust: 'inferred', origin: 'import', quarantined: false }
          : { trust: 'inferred', origin: 'agent-inferred', quarantined: false }

export class BrainStore {
  d: Data = emptyData()
  private timer: ReturnType<typeof setTimeout> | null = null
  /** lokey.db tables when there is a database (and encrypt = the vault seals the content); otherwise the JSON document, as before */
  backend: SqlBackend | null = null
  /** the stored memory could not be opened (encrypted and the key is gone): nothing is written until it can be */
  locked = false
  migrated = false
  constructor(private persist = true, private now: () => number = Date.now, backend?: SqlBackend | null) {
    this.backend = backend !== undefined ? backend : null
    this.useDefaultBackend = backend === undefined
  }
  private useDefaultBackend: boolean

  load() {
    if (!this.persist) return this
    try {
      if (this.useDefaultBackend) { const db = getDb(); this.backend = db ? new SqlBackend(db, () => Vault.current(settings.value.memory?.encrypt !== false)) : null }
      if (this.backend) { const r = this.backend.load(emptyData); this.d = upgrade(r.data); this.migrated = r.migrated; return this }
      const j = readDoc<Data>('brain', file)    // brain.json where there is no database
      if (j && (j.v === 1 || j.v === 2)) this.d = upgrade({ ...emptyData(), ...j })
    } catch { if (this.backend) this.locked = true /* the stored memory could not be read (its key is not available): never write over it */ }
    return this
  }

  save() {
    if (!this.persist || this.timer) return
    this.timer = setTimeout(() => this.saveNow(), 1200)
    this.timer.unref?.()
  }
  saveNow() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.persist || this.locked) return
    if (this.backend) { try { this.backend.save(this.d) } catch { /* the working copy in memory is still right; the next save tries again */ } return }
    writeDoc('brain', this.d, file)
  }

  private log(op: Op['op'], factId: string, before?: string, after?: string, why?: string) {
    this.d.ops.push({ at: this.now(), op, factId, before, after, why })
    if (this.d.ops.length > MAX_OPS) this.d.ops.splice(0, this.d.ops.length - MAX_OPS)
  }

  /** the facts that are still true (not replaced, not forgotten) */
  live(): Fact[] { return this.d.facts.filter(f => !f.supersededBy && !f.gone && f.validTo == null && !f.quarantined) }
  /** learned from untrusted content, waiting for the person's approval. NEVER returned by live(), search(), core() or similar(). */
  quarantined(): Fact[] { return this.d.facts.filter(f => f.quarantined && !f.gone && !f.supersededBy) }
  approve(fid: string): boolean { const f = this.fact(fid); if (!f || !f.quarantined || f.gone) return false; f.quarantined = false; f.trust = 'confirmed'; f.updated = this.now(); this.log('ADD', fid, undefined, f.text, 'approved by the user'); this.save(); return true }
  reject(fid: string): boolean { const f = this.fact(fid); if (!f || !f.quarantined) return false; f.gone = true; f.validTo = this.now(); this.log('DELETE', fid, f.text, undefined, 'rejected by the user'); this.save(); return true }
  fact(fid: string) { return this.d.facts.find(f => f.id === fid) }

  // ---- entities ----
  entity(name: string, type = 'thing'): Entity {
    const n = name.trim().replace(/\s+/g, ' ')
    const key = n.toLowerCase()
    let e = this.d.entities.find(x => x.name.toLowerCase() === key)
    if (!e) { e = { id: id(), name: n.slice(0, 60), type, created: this.now() }; this.d.entities.push(e) }
    else if (e.type === 'thing' && type !== 'thing') e.type = type
    return e
  }

  relate(src: string, rel: string, dst: string) {
    const a = this.entity(src), b = this.entity(dst)
    const r = rel.trim().toLowerCase().slice(0, 40)
    if (!r || a.id === b.id) return
    if (this.d.relations.some(x => x.src === a.id && x.dst === b.id && x.rel === r)) return
    this.d.relations.push({ id: id(), src: a.id, rel: r, dst: b.id, at: this.now() })
  }

  // ---- facts ----
  add(text: string, o: { kind?: FactKind; entities?: { name: string; type?: string }[]; source?: string; importance?: number; confidence?: number; pinned?: boolean; emb?: number[] | null; why?: string; taint?: string; trust?: Trust; origin?: Origin } = {}): Fact {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 300)
    const t0 = this.now()
    const f: Fact = {
      id: id(), text: t, kind: o.kind ?? 'fact', entities: (o.entities ?? []).filter(e => e.name.trim()).map(e => this.entity(e.name, e.type).id),
      source: o.source ?? 'chat', importance: Math.max(0.05, Math.min(1, o.importance ?? 0.5)), confidence: o.confidence ?? 0.8,
      created: t0, updated: t0, lastSeen: t0, pinned: o.pinned, emb: o.emb ?? null,
      validFrom: t0, validTo: null, ...provenance(o.source ?? 'chat', o.taint ?? ''), ...(o.trust ? { trust: o.trust } : {}), ...(o.origin ? { origin: o.origin } : {}), taint: o.taint || undefined,
    }
    this.d.facts.push(f)
    if (this.d.facts.length > MAX_FACTS) this.prune()
    this.log('ADD', f.id, undefined, t, o.why)
    this.d.lastLearned = t0
    this.save()
    return f
  }

  /** a changed fact: a NEW row takes over from now on, the old one is closed (validTo) and kept as history, never overwritten */
  update(fid: string, text: string, why?: string, emb?: number[] | null): Fact | null {
    const old = this.fact(fid)
    if (!old || old.gone) return null
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 300)
    if (!t || t === old.text) { old.lastSeen = this.now(); return old }
    const t0 = this.now()
    const nf: Fact = { ...old, id: id(), text: t, emb: emb ?? null, created: t0, updated: t0, lastSeen: t0, validFrom: t0, validTo: null, supersededBy: undefined, gone: undefined }
    old.validTo = t0; old.supersededBy = nf.id
    this.d.facts.push(nf)
    this.log('UPDATE', fid, old.text, t, why)
    this.d.lastLearned = t0
    this.save()
    return nf
  }

  /** a fact that is no longer true (kept in the log, not shown or used) */
  retire(fid: string, why?: string) {
    const f = this.fact(fid)
    if (!f || f.gone) return false
    f.gone = true; f.validTo = this.now()
    this.log('DELETE', fid, f.text, undefined, why)
    this.save()
    return true
  }

  forget(match: string): number {
    const m = match.trim().toLowerCase()
    if (m.length < 3) return 0
    let n = 0
    for (const f of this.live()) if (f.text.toLowerCase().includes(m)) { f.gone = true; f.validTo = this.now(); this.log('FORGET', f.id, f.text, undefined, 'asked to forget'); n++ }
    if (n) this.save()
    return n
  }

  touch(fid: string) { const f = this.fact(fid); if (f) { f.lastSeen = this.now(); f.importance = Math.min(1, f.importance + 0.03) } }
  pin(fid: string, on: boolean) { const f = this.fact(fid); if (f) { f.pinned = on; this.save() } }

  /** the live facts most like some text: shared words as a share of the longer text, or (with embeddings) meaning. 1 = the same thing. */
  similar(text: string, emb: number[] | null, k = 3): { fact: Fact; score: number }[] {
    return this.live()
      .map(f => { const c = emb && f.emb ? cosine(emb, f.emb) : 0; return { fact: f, score: Math.max(jaccardMax(text, f.text), c >= 0.97 ? 1 : c * 0.8) } })
      .filter(x => x.score > 0.1).sort((a, b) => b.score - a.score).slice(0, k)
  }

  // ---- search with the graph ----
  search(query: string, o: { qemb?: number[] | null; k?: number } = {}): Fact[] {
    const live = this.live()
    const docs: Doc[] = live.map(f => ({ id: f.id, text: f.text, extra: f.entities.map(e => this.d.entities.find(x => x.id === e)?.name ?? '').join(' '), importance: f.importance, at: f.updated, pinned: f.pinned, emb: f.emb }))
    // entities the question names lift the facts about them, and (less) the facts about what they are related to
    const q = query.toLowerCase()
    const named = this.d.entities.filter(e => e.name.length > 2 && q.includes(e.name.toLowerCase()))
    const boost = new Map<string, number>()
    for (const e of named) {
      for (const f of live) if (f.entities.includes(e.id)) boost.set(f.id, Math.max(boost.get(f.id) ?? 0, 0.3))
      for (const r of this.d.relations) {
        const other = r.src === e.id ? r.dst : r.dst === e.id ? r.src : null
        if (other) for (const f of live) if (f.entities.includes(other)) boost.set(f.id, Math.max(boost.get(f.id) ?? 0, 0.12))
      }
    }
    const lex = this.backend?.search(tokens(query)) ?? undefined      // FTS5 bm25 when there is a database, the in-process ranking otherwise
    return rank(query, docs, { qemb: o.qemb, boost, k: o.k ?? 8, lex }).map(h => this.fact(h.id)!).filter(Boolean)
  }

  /** what to tell the assistant at the start of a conversation: pinned and important/recent facts */
  core(k = 14): Fact[] {
    const t = this.now()
    return [...this.live()].map(f => ({ f, s: f.importance * 0.6 + Math.exp(-(t - f.lastSeen) / (60 * 86_400_000)) * 0.3 + (f.pinned ? 1 : 0) })).sort((a, b) => b.s - a.s).slice(0, k).map(x => x.f)
  }

  // ---- per-app plan memory: how a screen task was done successfully in an app (kept only from confirmed successes) ----
  addPlan(app: string, goal: string, steps: string[]) {
    const a = app.toLowerCase().replace(/\.exe$/, '').slice(0, 60), g = goal.replace(/\s+/g, ' ').trim().slice(0, 160)
    if (!a || g.length < 4 || steps.length < 1) return
    const st = steps.slice(0, 30).map(s => s.slice(0, 120))
    const same = this.d.plans.find(p => p.app === a && jaccardMax(p.goal, g) >= 0.8)
    if (same) { same.successes++; same.steps = st; same.at = this.now() } else this.d.plans.push({ id: id(), app: a, goal: g, steps: st, successes: 1, at: this.now() })
    const mine = this.d.plans.filter(p => p.app === a).sort((x, y) => y.successes - x.successes || y.at - x.at)
    for (const p of mine.slice(5)) this.d.plans.splice(this.d.plans.indexOf(p), 1)
    this.save()
  }
  planFor(app: string, goal: string): PlanMem | null {
    const a = app.toLowerCase().replace(/\.exe$/, '')
    return this.d.plans.filter(p => p.app === a).map(p => ({ p, s: jaccardMax(p.goal, goal) })).filter(x => x.s >= 0.4).sort((x, y) => y.s - x.s || y.p.successes - x.p.successes)[0]?.p ?? null
  }

  // ---- lessons & episodes ----
  addLesson(trigger: string, advice: string, emb?: number[] | null) {
    const t = trigger.trim().slice(0, 140), a = advice.trim().slice(0, 240)
    if (!t || !a) return
    const dup = this.d.lessons.find(l => overlap(l.advice, a) > 0.8 || (l.trigger === t && overlap(l.advice, a) > 0.5))
    if (dup) { dup.hits++; return }
    this.d.lessons.push({ id: id(), trigger: t, advice: a, hits: 1, at: this.now(), emb: emb ?? null })
    if (this.d.lessons.length > MAX_LESSONS) this.d.lessons.sort((x, y) => y.hits - x.hits).length = MAX_LESSONS
    this.save()
  }
  lessonsFor(query: string, k = 3): Lesson[] {
    const docs: Doc[] = this.d.lessons.map(l => ({ id: l.id, text: `${l.trigger} ${l.advice}`, importance: Math.min(1, 0.3 + l.hits * 0.1), at: l.at }))
    return rank(query, docs, { k }).map(h => this.d.lessons.find(l => l.id === h.id)!).filter(Boolean)
  }
  episode(e: Omit<Episode, 'id' | 'at'>) {
    this.d.episodes.push({ id: id(), at: this.now(), ...e })
    if (this.d.episodes.length > MAX_EPISODES) this.d.episodes.splice(0, this.d.episodes.length - MAX_EPISODES)
    this.save()
  }

  private prune() {
    // over the cap: drop the least important, least recently seen, unpinned facts that are already history first
    const score = (f: Fact) => (f.gone || f.supersededBy ? -1 : f.importance + (f.pinned ? 5 : 0)) + Math.exp(-(this.now() - f.lastSeen) / (90 * 86_400_000)) * 0.2
    this.d.facts.sort((a, b) => score(b) - score(a)).length = MAX_FACTS - 100
  }

  // ---- upkeep (no model needed): fade what is never used, merge near-duplicates ----
  upkeep(): { merged: number; faded: number; dropped: number } {
    const t = this.now()
    let merged = 0, faded = 0, dropped = 0
    const live = this.live()
    for (const f of live) {
      if (f.pinned) continue
      const idle = (t - f.lastSeen) / 86_400_000
      if (idle > 14) { const next = Math.max(0.05, f.importance * Math.pow(0.985, Math.min(idle - 14, 60))); if (next < f.importance - 0.01) { f.importance = next; faded++ } }
    }
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j]
      if (a.gone || b.gone || a.supersededBy || b.supersededBy || a.kind !== b.kind) continue
      if (overlap(a.text, b.text) >= 0.9 && Math.abs(a.text.length - b.text.length) < Math.max(a.text.length, b.text.length) * 0.4) {
        const keep = a.pinned || a.importance >= b.importance ? a : b, drop = keep === a ? b : a
        drop.supersededBy = keep.id; drop.validTo = t; keep.importance = Math.min(1, keep.importance + 0.05); keep.entities = [...new Set([...keep.entities, ...drop.entities])]
        this.log('MERGE', drop.id, drop.text, keep.text, 'near duplicate'); merged++
      }
    }
    const before = this.d.facts.length
    this.d.facts = this.d.facts.filter(f => !((f.gone || f.supersededBy) && t - f.updated > 60 * 86_400_000) && !(!f.pinned && !f.gone && !f.supersededBy && f.importance <= 0.06 && t - f.lastSeen > 150 * 86_400_000))
    dropped = before - this.d.facts.length
    if (merged || faded || dropped) this.save()
    return { merged, faded, dropped }
  }

  // ---- views for the UI ----
  view(f: Fact): FactView { return { id: f.id, text: f.text, kind: f.kind, entities: f.entities.map(e => this.d.entities.find(x => x.id === e)?.name ?? '').filter(Boolean), source: f.source, importance: f.importance, pinned: !!f.pinned, updated: f.updated, created: f.created, trust: f.trust ?? 'inferred', origin: f.origin ?? 'agent-inferred', validFrom: f.validFrom ?? f.created } }
  quarantineViews(): QuarantineView[] { return this.quarantined().map(f => ({ ...this.view(f), taint: f.taint ?? '' })) }
  graph(max = 70): GraphView {
    const live = this.live()
    const w = new Map<string, number>()
    for (const f of live) for (const e of f.entities) w.set(e, (w.get(e) ?? 0) + 1)
    for (const r of this.d.relations) { w.set(r.src, (w.get(r.src) ?? 0) + 0.5); w.set(r.dst, (w.get(r.dst) ?? 0) + 0.5) }
    const nodes = this.d.entities.filter(e => w.has(e.id)).sort((a, b) => (w.get(b.id) ?? 0) - (w.get(a.id) ?? 0)).slice(0, max)
    const ids = new Set(nodes.map(n => n.id))
    return { nodes: nodes.map(n => ({ id: n.id, name: n.name, type: n.type, weight: w.get(n.id) ?? 1 })), edges: this.d.relations.filter(r => ids.has(r.src) && ids.has(r.dst)).map(r => ({ src: r.src, dst: r.dst, rel: r.rel })) }
  }
  lessonViews(): LessonView[] { return [...this.d.lessons].sort((a, b) => b.hits - a.hits).map(l => ({ id: l.id, trigger: l.trigger, advice: l.advice, hits: l.hits })) }
  clear() { this.d = emptyData(); this.saveNow() }
  /** the encryption setting changed: write everything again with the current vault */
  reseal() { if (this.locked) return; try { this.backend?.rewriteAll(this.d) } catch { /* next save tries again */ } }
}
