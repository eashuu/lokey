import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FactKind, FactView, GraphView, LessonView } from '@shared/memory'
import { dataDir } from '../../settings'
import { cosine, jaccardMax, overlap, rank, type Doc } from './search'

// What Lokey knows, as plain data in one file (brain.json): atomic facts about the user, the people, projects and places they
// mention (entities) and how they relate, short episodes (what happened in a conversation or job), lessons (how to do things for
// THIS user) and a daily journal. Nothing is ever hard-deleted by the engine itself: a fact that is replaced is kept as history
// (`supersededBy`), and every change is appended to an operation log, so "why does it think that?" always has an answer.
export interface Fact {
  id: string; text: string; kind: FactKind; entities: string[]; source: string
  importance: number; confidence: number
  created: number; updated: number; lastSeen: number
  pinned?: boolean; supersededBy?: string; gone?: boolean
  emb?: number[] | null
}
export interface Entity { id: string; name: string; type: string; created: number }
export interface Relation { id: string; src: string; rel: string; dst: string; at: number }
export interface Episode { id: string; at: number; kind: 'chat' | 'job'; summary: string; tools: string[]; outcome: 'ok' | 'failed' | 'denied' | 'corrected' }
export interface Lesson { id: string; trigger: string; advice: string; hits: number; at: number; emb?: number[] | null }
export interface Op { at: number; op: 'ADD' | 'UPDATE' | 'DELETE' | 'FORGET' | 'MERGE'; factId: string; before?: string; after?: string; why?: string }
export interface Data { v: 1; facts: Fact[]; entities: Entity[]; relations: Relation[]; episodes: Episode[]; lessons: Lesson[]; journal: Record<string, string>; ops: Op[]; lastReflect: number; lastLearned: number | null }

const file = join(dataDir, 'brain.json')
const id = () => Math.random().toString(36).slice(2, 10)
const MAX_FACTS = 2500, MAX_EPISODES = 400, MAX_OPS = 1500, MAX_LESSONS = 120

export const emptyData = (): Data => ({ v: 1, facts: [], entities: [], relations: [], episodes: [], lessons: [], journal: {}, ops: [], lastReflect: 0, lastLearned: null })

export class BrainStore {
  d: Data = emptyData()
  private timer: ReturnType<typeof setTimeout> | null = null
  constructor(private persist = true, private now: () => number = Date.now) {}

  load() {
    if (!this.persist) return this
    try {
      const j = JSON.parse(readFileSync(file, 'utf8')) as Data
      if (j && j.v === 1) this.d = { ...emptyData(), ...j }
    } catch { /* first run */ }
    return this
  }

  save() {
    if (!this.persist || this.timer) return
    this.timer = setTimeout(() => this.saveNow(), 1200)
    this.timer.unref?.()
  }
  saveNow() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
    if (!this.persist) return
    try { mkdirSync(dataDir, { recursive: true }); writeFileSync(file + '.tmp', JSON.stringify(this.d)); renameSync(file + '.tmp', file) } catch { /* keep in memory */ }
  }

  private log(op: Op['op'], factId: string, before?: string, after?: string, why?: string) {
    this.d.ops.push({ at: this.now(), op, factId, before, after, why })
    if (this.d.ops.length > MAX_OPS) this.d.ops.splice(0, this.d.ops.length - MAX_OPS)
  }

  /** the facts that are still true (not replaced, not forgotten) */
  live(): Fact[] { return this.d.facts.filter(f => !f.supersededBy && !f.gone) }
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
  add(text: string, o: { kind?: FactKind; entities?: { name: string; type?: string }[]; source?: string; importance?: number; confidence?: number; pinned?: boolean; emb?: number[] | null; why?: string } = {}): Fact {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 300)
    const t0 = this.now()
    const f: Fact = {
      id: id(), text: t, kind: o.kind ?? 'fact', entities: (o.entities ?? []).filter(e => e.name.trim()).map(e => this.entity(e.name, e.type).id),
      source: o.source ?? 'chat', importance: Math.max(0.05, Math.min(1, o.importance ?? 0.5)), confidence: o.confidence ?? 0.8,
      created: t0, updated: t0, lastSeen: t0, pinned: o.pinned, emb: o.emb ?? null,
    }
    this.d.facts.push(f)
    if (this.d.facts.length > MAX_FACTS) this.prune()
    this.log('ADD', f.id, undefined, t, o.why)
    this.d.lastLearned = t0
    this.save()
    return f
  }

  /** a changed fact: the old wording stays as history, the new one takes over */
  update(fid: string, text: string, why?: string, emb?: number[] | null): Fact | null {
    const old = this.fact(fid)
    if (!old || old.gone) return null
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 300)
    if (!t || t === old.text) { old.lastSeen = this.now(); return old }
    this.log('UPDATE', fid, old.text, t, why)
    old.text = t; old.updated = this.now(); old.lastSeen = old.updated; old.emb = emb ?? null
    this.d.lastLearned = old.updated
    this.save()
    return old
  }

  /** a fact that is no longer true (kept in the log, not shown or used) */
  retire(fid: string, why?: string) {
    const f = this.fact(fid)
    if (!f || f.gone) return false
    f.gone = true
    this.log('DELETE', fid, f.text, undefined, why)
    this.save()
    return true
  }

  forget(match: string): number {
    const m = match.trim().toLowerCase()
    if (m.length < 3) return 0
    let n = 0
    for (const f of this.live()) if (f.text.toLowerCase().includes(m)) { f.gone = true; this.log('FORGET', f.id, f.text, undefined, 'asked to forget'); n++ }
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
    return rank(query, docs, { qemb: o.qemb, boost, k: o.k ?? 8 }).map(h => this.fact(h.id)!).filter(Boolean)
  }

  /** what to tell the assistant at the start of a conversation: pinned and important/recent facts */
  core(k = 14): Fact[] {
    const t = this.now()
    return [...this.live()].map(f => ({ f, s: f.importance * 0.6 + Math.exp(-(t - f.lastSeen) / (60 * 86_400_000)) * 0.3 + (f.pinned ? 1 : 0) })).sort((a, b) => b.s - a.s).slice(0, k).map(x => x.f)
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
        drop.supersededBy = keep.id; keep.importance = Math.min(1, keep.importance + 0.05); keep.entities = [...new Set([...keep.entities, ...drop.entities])]
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
  view(f: Fact): FactView { return { id: f.id, text: f.text, kind: f.kind, entities: f.entities.map(e => this.d.entities.find(x => x.id === e)?.name ?? '').filter(Boolean), source: f.source, importance: f.importance, pinned: !!f.pinned, updated: f.updated, created: f.created } }
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
}
