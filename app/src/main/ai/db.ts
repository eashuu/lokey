import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite' // type only: the module itself is loaded at run time, see load()
import { dataDir } from '../settings'

// lokey.db: one SQLite file (WAL) for what used to be scattered JSON: usage and quota, model health, traces, and the documents of
// the memory and the conversation. SQLite comes from Node itself (node:sqlite, SQLite 3.53 with FTS5 inside Electron 44), so there
// is no native add-on to build or ship. Where it is not available (the Android build, or a runtime without it) getDb() is null and
// every caller keeps the JSON-file behaviour it had before: the database is an upgrade, never a requirement.
export interface Db {
  readonly path: string
  exec(sql: string): void
  run(sql: string, ...p: unknown[]): void
  all<T = Record<string, unknown>>(sql: string, ...p: unknown[]): T[]
  get<T = Record<string, unknown>>(sql: string, ...p: unknown[]): T | undefined
  /** run `fn` as one transaction */
  tx<T>(fn: () => T): T
  close(): void
}

const SCHEMA = `
create table if not exists kv(name text primary key, json text not null, updated integer not null);
create table if not exists usage(day text not null, provider text not null, requests integer not null default 0, tin integer not null default 0, tout integer not null default 0, errors integer not null default 0, bg integer not null default 0, last text, primary key(day, provider));
create table if not exists quota(provider text not null, model text not null, win text not null, used integer not null default 0, lim integer not null default 0, reset_at integer not null default 0, source text not null default '', primary key(provider, model, win));
create table if not exists health(provider text primary key, json text not null);
create table if not exists traces(id integer primary key autoincrement, at integer not null, op text, role text, provider text, model text, ok integer, kind text, attempt integer, ms integer, ttft integer, tin integer, tout integer, cached integer, chain text, note text);
create index if not exists traces_at on traces(at);
create table if not exists runs(id text primary key, goal text not null, role text not null, origin text not null, status text not null, created integer not null, updated integer not null, budget text);
create table if not exists steps(run_id text not null, n integer not null, idx integer not null, kind text not null, name text, args text, idem text, hash text, status text not null, output text, started integer not null, ended integer, primary key(run_id, n, idx, kind));
create index if not exists steps_idem on steps(idem);
create table if not exists audit(seq integer primary key autoincrement, at integer not null, payload text not null, prev text not null, hash text not null);
`

function load(): typeof import('node:sqlite') | null {
  try {
    const g = (globalThis as { process?: { getBuiltinModule?: (n: string) => unknown; platform?: string } }).process
    if (!g?.getBuiltinModule || g.platform === 'android') return null
    return (g.getBuiltinModule('node:sqlite') as typeof import('node:sqlite')) ?? null
  } catch { return null }
}

export function openDb(path: string): Db | null {
  const m = load()
  if (!m) return null
  try {
    if (path !== ':memory:') mkdirSync(join(path, '..'), { recursive: true })
    const d: DatabaseSync = new m.DatabaseSync(path)
    d.exec('pragma journal_mode=wal; pragma synchronous=normal; pragma busy_timeout=3000;')
    d.exec(SCHEMA)
    return {
      path,
      exec: s => d.exec(s),
      run: (s, ...p) => { d.prepare(s).run(...(p as never[])) },
      all: <T>(s: string, ...p: unknown[]) => d.prepare(s).all(...(p as never[])) as unknown as T[],
      get: <T>(s: string, ...p: unknown[]) => d.prepare(s).get(...(p as never[])) as unknown as T | undefined,
      tx: fn => { d.exec('begin'); try { const r = fn(); d.exec('commit'); return r } catch (e) { try { d.exec('rollback') } catch { /* already closed */ } throw e } },
      close: () => { try { d.close() } catch { /* closed */ } },
    }
  } catch { return null }
}

// ---- the shared instance -------------------------------------------------------------------------------------------------------
let shared: Db | null | undefined

/** Self-checks and `--eval` must never touch the real data folder, so the shared database stays off there unless a test sets one. */
const offByMode = () => { try { const a = (globalThis as { process?: { argv?: string[] } }).process?.argv ?? []; return a.includes('--selfcheck') || a.includes('--eval') || a.includes('--livetest') || a.includes('--memcheck') } catch { return false } }

export function getDb(): Db | null {
  if (shared !== undefined) return shared
  if (offByMode()) return (shared = null)
  shared = openDb(join(dataDir, 'lokey.db'))
  if (shared) { try { migrateLegacy(shared, dataDir) } catch { /* the old files stay where they are */ } }
  return shared
}
/** tests: use this database (or none) from now on */
export function setDb(d: Db | null) { shared = d }

// ---- documents: whole JSON values by name (memory, conversation) ----------------------------------------------------------------
export function readDoc<T>(name: string, legacyFile: string): T | null {
  const db = getDb()
  if (db) {
    try { const r = db.get<{ json: string }>('select json from kv where name = ?', name); return r ? (JSON.parse(r.json) as T) : null } catch { return null }
  }
  try { return JSON.parse(readFileSync(legacyFile, 'utf8')) as T } catch { return null }
}

export function writeDoc(name: string, value: unknown, legacyFile: string): void {
  const db = getDb()
  if (db) { try { db.run('insert into kv(name, json, updated) values(?, ?, ?) on conflict(name) do update set json = excluded.json, updated = excluded.updated', name, JSON.stringify(value), Date.now()); return } catch { /* fall through to the file */ } }
  try { mkdirSync(dataDir, { recursive: true }); writeFileSync(legacyFile + '.tmp', JSON.stringify(value)); renameSync(legacyFile + '.tmp', legacyFile) } catch { /* in memory only */ }
}

// ---- one-time import of the old JSON stores ------------------------------------------------------------------------------------
export interface MigrationReport { migrated: string[]; skipped: string[]; errors: string[] }

const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const dayKey = () => new Date().toDateString()

/**
 * brain.json and conversation.json become documents, usage.json becomes today's usage rows. The old file is renamed to
 * `<name>.migrated` only after the new rows were read back and matched, so a failure at any step leaves the original untouched
 * (and to go back to an older build, rename the `.migrated` file back). A document already in the database is never overwritten.
 */
export function migrateLegacy(db: Db, dir: string): MigrationReport {
  const rep: MigrationReport = { migrated: [], skipped: [], errors: [] }
  const keep = (file: string) => { let to = file + '.migrated'; if (existsSync(to)) to = `${file}.${stamp()}.migrated`; renameSync(file, to) }
  const docs: [string, string, (j: any) => boolean][] = [
    ['brain', 'brain.json', j => !!j && j.v === 1 && Array.isArray(j.facts)],
    ['conversation', 'conversation.json', j => !!j && Array.isArray(j.turns)],
  ]
  for (const [name, f, valid] of docs) {
    const file = join(dir, f)
    if (!existsSync(file)) continue
    try {
      const text = readFileSync(file, 'utf8')
      const j = JSON.parse(text)
      if (!valid(j)) { rep.errors.push(`${f}: not a ${name} file, left as it is`); continue }
      if (db.get('select 1 as x from kv where name = ?', name)) { rep.skipped.push(`${f}: the database already has ${name}`); continue }
      db.run('insert into kv(name, json, updated) values(?, ?, ?)', name, JSON.stringify(j), Date.now())
      const back = db.get<{ json: string }>('select json from kv where name = ?', name)
      if (!back || back.json !== JSON.stringify(j)) { db.run('delete from kv where name = ?', name); rep.errors.push(`${f}: read-back did not match, left as it is`); continue }
      keep(file); rep.migrated.push(f)
    } catch (e) { rep.errors.push(`${f}: ${e instanceof Error ? e.message : e}`) }
  }
  const uf = join(dir, 'usage.json')
  if (existsSync(uf)) {
    try {
      const u = JSON.parse(readFileSync(uf, 'utf8')) as { day?: string; providers?: Record<string, { requests?: number; in?: number; out?: number; errors?: number; last?: string }> }
      if (!u || typeof u.providers !== 'object') throw new Error('not a usage file')
      db.tx(() => {
        if (u.day === dayKey()) for (const [id, p] of Object.entries(u.providers ?? {})) db.run('insert or ignore into usage(day, provider, requests, tin, tout, errors, last) values(?, ?, ?, ?, ?, ?, ?)', u.day, id, p.requests ?? 0, p.in ?? 0, p.out ?? 0, p.errors ?? 0, p.last ?? null)
      })
      keep(uf); rep.migrated.push('usage.json')
    } catch (e) { rep.errors.push(`usage.json: ${e instanceof Error ? e.message : e}`) }
  }
  return rep
}
