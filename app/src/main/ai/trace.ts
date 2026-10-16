import type { TraceRow } from '@shared/bridge'
import type { Db } from './db'

// One row per model-call attempt: what was asked (operation, role), who answered or failed (provider, model, error kind), how long
// it took, the tokens, and the chain of earlier attempts that led here. Field names follow the OpenTelemetry GenAI conventions
// (operation, provider, model, tokens in/out). Prompt and answer BODIES are never stored, so there is nothing to redact; nothing
// leaves the PC either.
export interface Span { op: string; role: string; provider: string; model: string; ok: boolean; kind: string; attempt: number; ms: number; ttft?: number; tin?: number; tout?: number; cached?: number; chain?: string; note?: string }
export interface TraceFilter { role?: string; provider?: string; failed?: boolean; limit?: number }

const KEEP = 5000

export class Tracer {
  private ring: TraceRow[] = []     // used when there is no database
  private seq = 0
  private n = 0
  /** called after every recorded attempt (the Agents tab refreshes its models from it) */
  onRecord?: () => void
  constructor(private db: Db | null, private now: () => number = Date.now) {}

  record(s: Span) {
    const at = this.now()
    queueMicrotask(() => this.onRecord?.())
    const row: TraceRow = { id: ++this.seq, at, op: s.op, role: s.role, provider: s.provider, model: s.model, ok: s.ok, kind: s.kind, attempt: s.attempt, ms: Math.round(s.ms), tin: s.tin ?? 0, tout: s.tout ?? 0, chain: s.chain ?? '', note: (s.note ?? '').slice(0, 240) }
    if (this.db) {
      try {
        this.db.run('insert into traces(at, op, role, provider, model, ok, kind, attempt, ms, ttft, tin, tout, cached, chain, note) values(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', at, s.op, s.role, s.provider, s.model, s.ok ? 1 : 0, s.kind, s.attempt, row.ms, s.ttft ?? null, row.tin, row.tout, s.cached ?? 0, row.chain, row.note)
        if (++this.n % 200 === 0) this.db.run('delete from traces where id <= (select max(id) from traces) - ?', KEEP)
        return
      } catch { /* keep it in memory */ }
    }
    this.ring.push(row)
    if (this.ring.length > 300) this.ring.shift()
  }

  list(f: TraceFilter = {}): TraceRow[] {
    const limit = Math.max(1, Math.min(500, f.limit ?? 100))
    if (this.db) {
      try {
        const where: string[] = [], p: unknown[] = []
        if (f.role) { where.push('role = ?'); p.push(f.role) }
        if (f.provider) { where.push('provider = ?'); p.push(f.provider) }
        if (f.failed) where.push('ok = 0')
        return this.db.all<Omit<TraceRow, 'ok'> & { ok: number }>(`select id, at, op, role, provider, model, ok, kind, attempt, ms, tin, tout, chain, note from traces ${where.length ? 'where ' + where.join(' and ') : ''} order by id desc limit ${limit}`, ...p).map(r => ({ ...r, ok: !!r.ok }))
      } catch { /* fall back to the ring */ }
    }
    return this.ring.filter(r => (!f.role || r.role === f.role) && (!f.provider || r.provider === f.provider) && (!f.failed || !r.ok)).slice(-limit).reverse()
  }
}
