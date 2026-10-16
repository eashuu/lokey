import { createHash } from 'node:crypto'
import type { Data, Fact } from '../../brain/memory/store'
import type { Db } from '../db'
import type { Vault } from './vault'

// Memory as real tables in lokey.db (round-9 plan 3.8), replacing the single JSON document of step R1:
//   facts(id, trust, origin, quarantined, valid_from, valid_to, superseded_by, gone, pinned, importance, updated, body)  <- body = sealed JSON
//   entities, relations, episodes, lessons, journal, ops, plans, proposals, core, meta
// The columns outside `body` are the structure (queryable without the key); the content is inside the sealed `body` (vault.ts).
// Search: a TEMPORARY FTS5 table (in memory, never written to disk) is filled from the decrypted facts, so encryption at rest does not
// mean giving up full-text ranking. The working copy of the data stays in the BrainStore (a few thousand rows); this class loads it
// and writes back only the rows that changed.
const CREATE = `
create table if not exists m_facts(id text primary key, trust text, origin text, quarantined integer, valid_from integer, valid_to integer, superseded_by text, gone integer, pinned integer, importance real, updated integer, body text not null);
create table if not exists m_entities(id text primary key, body text not null);
create table if not exists m_relations(id text primary key, body text not null);
create table if not exists m_episodes(id text primary key, at integer, body text not null);
create table if not exists m_lessons(id text primary key, body text not null);
create table if not exists m_journal(day text primary key, body text not null);
create table if not exists m_ops(id text primary key, at integer, body text not null);
create table if not exists m_plans(id text primary key, app text, updated integer, body text not null);
create table if not exists m_proposals(id text primary key, body text not null);
create table if not exists m_meta(key text primary key, body text not null);
`
// Tamil vowel signs are combining marks; listing them as token characters keeps Tamil words whole
const TAMIL = Array.from({ length: 0x0BCD - 0x0BBE + 1 }, (_, i) => String.fromCharCode(0x0BBE + i)).join('') + 'ஂஃ'

const h = (s: string) => createHash('sha1').update(s).digest('hex')

interface Row { id: string; cols: unknown[]; body: unknown }
const TABLES: { name: string; cols: string[]; rows: (d: Data) => Row[] }[] = [
  { name: 'm_facts', cols: ['trust', 'origin', 'quarantined', 'valid_from', 'valid_to', 'superseded_by', 'gone', 'pinned', 'importance', 'updated'], rows: d => d.facts.map(f => ({ id: f.id, cols: [f.trust ?? 'inferred', f.origin ?? 'agent-inferred', f.quarantined ? 1 : 0, f.validFrom ?? f.created, f.validTo ?? null, f.supersededBy ?? null, f.gone ? 1 : 0, f.pinned ? 1 : 0, f.importance, f.updated], body: f })) },
  { name: 'm_entities', cols: [], rows: d => d.entities.map(e => ({ id: e.id, cols: [], body: e })) },
  { name: 'm_relations', cols: [], rows: d => d.relations.map(r => ({ id: r.id, cols: [], body: r })) },
  { name: 'm_episodes', cols: ['at'], rows: d => d.episodes.map(e => ({ id: e.id, cols: [e.at], body: e })) },
  { name: 'm_lessons', cols: [], rows: d => d.lessons.map(l => ({ id: l.id, cols: [], body: l })) },
  { name: 'm_journal', cols: [], rows: d => Object.entries(d.journal).map(([day, text]) => ({ id: day, cols: [], body: text })) },
  { name: 'm_ops', cols: ['at'], rows: d => d.ops.map(o => ({ id: h(JSON.stringify(o)).slice(0, 16), cols: [o.at], body: o })) },
  { name: 'm_plans', cols: ['app', 'updated'], rows: d => d.plans.map(p => ({ id: p.id, cols: [p.app, p.at], body: p })) },
  { name: 'm_proposals', cols: [], rows: d => d.proposals.map(p => ({ id: p.id, cols: [], body: p })) },
]
const KEY: Record<string, string> = { m_journal: 'day', m_facts: 'id' }

export class SqlBackend {
  private seen = new Map<string, Map<string, string>>()      // table -> id -> hash of what is stored
  private fts = new Map<string, string>()                     // fact id -> hash of what is indexed
  constructor(private db: Db, private vault: () => Vault) {
    db.exec(CREATE)
    db.exec('pragma temp_store = memory')
    try { db.exec(`create virtual table if not exists temp.fact_fts using fts5(id unindexed, text, ents, tokenize = "unicode61 tokenchars '${TAMIL}'")`) } catch { /* FTS5 missing: search falls back to the in-process ranking */ }
  }

  get encrypting() { return this.vault().encrypting }
  get hasFts() { try { this.db.all('select 1 from temp.fact_fts limit 1'); return true } catch { return false } }
  private seal(v: unknown) { return this.vault().seal(JSON.stringify(v)) }
  private open<T>(s: string): T { return JSON.parse(this.vault().open(s)) as T }

  /** are there any memory rows at all? */
  private empty() { return !this.db.get('select 1 as x from m_facts limit 1') && !this.db.get('select 1 as x from m_meta limit 1') }

  /** the data, from the tables; if there are none yet, from the step-R1 document (kept as a backup under another name) */
  load(emptyData: () => Data): { data: Data; migrated: boolean } {
    let migrated = false
    if (this.empty()) {
      const doc = this.db.get<{ json: string }>("select json from kv where name = 'brain'")
      if (doc) {
        const old = JSON.parse(doc.json) as Data
        const d = { ...emptyData(), ...old }
        this.save(d)
        // read back and compare before the old document is renamed: a mismatch leaves it where it is
        const back = this.read(emptyData)
        if (back.facts.length === d.facts.length && back.entities.length === d.entities.length && back.lessons.length === d.lessons.length && back.episodes.length === d.episodes.length) {
          this.db.run("update kv set name = 'brain.v1.migrated' where name = 'brain'")
          migrated = true
        } else { for (const t of TABLES) this.db.run(`delete from ${t.name}`); this.db.run('delete from m_meta'); this.seen.clear() }
      }
    }
    return { data: this.read(emptyData), migrated }
  }

  private read(emptyData: () => Data): Data {
    const d = emptyData()
    const all = <T>(table: string) => this.db.all<{ id?: string; day?: string; body: string }>(`select ${KEY[table] ?? 'id'} as id, body from ${table}`).map(r => ({ id: r.id!, v: this.open<T>(r.body) }))
    d.facts = all<Fact>('m_facts').map(r => r.v)
    d.entities = all<Data['entities'][number]>('m_entities').map(r => r.v)
    d.relations = all<Data['relations'][number]>('m_relations').map(r => r.v)
    d.episodes = all<Data['episodes'][number]>('m_episodes').map(r => r.v).sort((a, b) => a.at - b.at)
    d.lessons = all<Data['lessons'][number]>('m_lessons').map(r => r.v)
    d.ops = all<Data['ops'][number]>('m_ops').map(r => r.v).sort((a, b) => a.at - b.at)
    d.plans = all<Data['plans'][number]>('m_plans').map(r => r.v)
    d.proposals = all<Data['proposals'][number]>('m_proposals').map(r => r.v)
    for (const r of all<string>('m_journal')) d.journal[r.id] = r.v
    const meta = this.db.all<{ key: string; body: string }>('select key, body from m_meta')
    for (const m of meta) { const v = this.open<unknown>(m.body); if (m.key === 'core') d.core = String(v); else if (m.key === 'lastReflect') d.lastReflect = Number(v); else if (m.key === 'lastLearned') d.lastLearned = v === null ? null : Number(v) }
    // what is stored now is what the next save compares against
    this.seen.clear()
    for (const t of TABLES) {
      const m = new Map<string, string>()
      for (const r of t.rows(d)) m.set(r.id, h(JSON.stringify([r.cols, r.body])))
      this.seen.set(t.name, m)
    }
    this.reindex(d)
    return d
  }

  /** write back what changed since the last save (one transaction) */
  save(d: Data) {
    this.db.tx(() => {
      for (const t of TABLES) {
        const seen = this.seen.get(t.name) ?? new Map<string, string>()
        const now = new Map<string, string>()
        const key = KEY[t.name] ?? 'id'
        for (const r of t.rows(d)) {
          const fp = h(JSON.stringify([r.cols, r.body]))
          now.set(r.id, fp)
          if (seen.get(r.id) === fp) continue
          const names = t.cols.length ? `, ${t.cols.join(', ')}` : ''
          const q = t.cols.length ? `, ${t.cols.map(() => '?').join(', ')}` : ''
          this.db.run(`insert or replace into ${t.name}(${key}${names}, body) values(?${q}, ?)`, r.id, ...r.cols, this.seal(r.body))
        }
        for (const id of seen.keys()) if (!now.has(id)) this.db.run(`delete from ${t.name} where ${key} = ?`, id)
        this.seen.set(t.name, now)
      }
      const meta: [string, unknown][] = [['core', d.core], ['lastReflect', d.lastReflect], ['lastLearned', d.lastLearned]]
      for (const [k, v] of meta) { const fp = h(JSON.stringify(v)); const m = this.seen.get('m_meta') ?? new Map(); if (m.get(k) !== fp) { this.db.run('insert or replace into m_meta(key, body) values(?, ?)', k, this.seal(v)); m.set(k, fp); this.seen.set('m_meta', m) } }
    })
    this.reindex(d)
  }

  /** every row sealed again with the current vault (after the encryption setting changed) */
  rewriteAll(d: Data) { this.seen.clear(); this.db.exec('delete from m_meta'); this.save(d) }

  // ---- full-text search over the facts that may be retrieved --------------------------------------------------------------------
  private reindex(d: Data) {
    if (!this.hasFts) return
    const live = d.facts.filter(f => !f.supersededBy && !f.gone && f.validTo == null && !f.quarantined)
    const want = new Map(live.map(f => [f.id, h(f.text + '|' + f.entities.join(','))]))
    for (const id of [...this.fts.keys()]) if (!want.has(id) || this.fts.get(id) !== want.get(id)) { this.db.run('delete from temp.fact_fts where id = ?', id); this.fts.delete(id) }
    for (const f of live) if (!this.fts.has(f.id)) {
      const ents = f.entities.map(e => d.entities.find(x => x.id === e)?.name ?? '').join(' ')
      this.db.run('insert into temp.fact_fts(id, text, ents) values(?, ?, ?)', f.id, f.text, ents)
      this.fts.set(f.id, want.get(f.id)!)
    }
  }

  /** BM25 scores (0..1, best = 1) for the words of a query; null when FTS5 is not available */
  search(words: string[], k = 60): Map<string, number> | null {
    if (!this.hasFts) return null
    const q = [...new Set(words)].filter(w => w.length > 1).map(w => `"${w.replace(/"/g, '')}"`).join(' OR ')
    if (!q) return new Map()
    try {
      const rows = this.db.all<{ id: string; s: number }>('select id, bm25(temp.fact_fts, 0.0, 1.0, 0.6) as s from temp.fact_fts where temp.fact_fts match ? order by s limit ?', q, k)
      const worst = Math.max(...rows.map(r => -r.s), 1e-9)
      return new Map(rows.map(r => [r.id, Math.max(0, -r.s) / worst]))
    } catch { return null }
  }
}
