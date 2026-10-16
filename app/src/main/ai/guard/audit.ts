import { createHash } from 'node:crypto'
import { getDb, type Db } from '../db'

// The audit log (plan 3.7, step 11): append-only, hash-chained. Each row stores the hash of the previous row, so editing or deleting
// an earlier row breaks every hash after it and `verify()` says where. Rows say what was attempted, where the arguments came from
// (taint), what the policy decided and why, and what happened. Secrets are redacted before they are written. In lokey.db when
// there is a database, otherwise a short in-memory chain (the phone build).
export interface AuditRecord {
  tool: string; cls: string; origin: string
  /** the untrusted source in force when the call was made ('' = none) */
  taint: string
  /** deny | run | ask-approved | ask-denied | refused */
  decision: string
  reasons: string[]
  outcome: string
  summary: string
  model?: string
}
export interface AuditRow extends AuditRecord { seq: number; at: number }

const GENESIS = '0'.repeat(64)
const hash = (prev: string, payload: string) => createHash('sha256').update(prev).update('\n').update(payload).digest('hex')
const SECRET = /\b(sk|pk|ghp|gho|xox[bap]|AKIA|AIza)[-_A-Za-z0-9]{12,}|\beyJ[\w-]{10,}\.[\w-]{10,}\.|(password|passwd|secret|token|api[_ -]?key)\s*[:=]\s*\S+|\b(?:\d[ -]?){13,19}\b/gi
export const redact = (s: string) => s.replace(SECRET, '[redacted]').slice(0, 240)

export class AuditLog {
  private mem: { seq: number; at: number; payload: string; prev: string; hash: string }[] = []
  private last = GENESIS
  private seq = 0
  constructor(private db: () => Db | null = getDb, private now: () => number = Date.now) {}

  private tail(d: Db | null) {
    if (d) { const r = d.get<{ seq: number; hash: string }>('select seq, hash from audit order by seq desc limit 1'); return { seq: r?.seq ?? 0, hash: r?.hash ?? GENESIS } }
    return { seq: this.seq, hash: this.last }
  }

  append(r: AuditRecord): number {
    const payload = JSON.stringify({ ...r, summary: redact(r.summary), reasons: r.reasons.slice(0, 8) })
    const at = this.now()
    const d = this.db()
    if (d) {
      try {
        return d.tx(() => {
          const t = this.tail(d)
          const h = hash(t.hash, `${at}|${payload}`)
          d.run('insert into audit(at, payload, prev, hash) values(?, ?, ?, ?)', at, payload, t.hash, h)
          return t.seq + 1
        })
      } catch { /* fall through to memory */ }
    }
    const h = hash(this.last, `${at}|${payload}`)
    this.mem.push({ seq: ++this.seq, at, payload, prev: this.last, hash: h })
    this.last = h
    if (this.mem.length > 500) this.mem.shift()
    return this.seq
  }

  recent(limit = 100): AuditRow[] {
    const d = this.db()
    const rows = d ? d.all<{ seq: number; at: number; payload: string }>('select seq, at, payload from audit order by seq desc limit ?', limit) : this.mem.slice(-limit).reverse()
    return rows.map(x => ({ seq: x.seq, at: x.at, ...(JSON.parse(x.payload) as AuditRecord) }))
  }

  /** walk the chain; `brokenAt` is the first row whose hash or link does not match */
  verify(): { ok: boolean; count: number; brokenAt?: number } {
    const d = this.db()
    const rows = d ? d.all<{ seq: number; at: number; payload: string; prev: string; hash: string }>('select seq, at, payload, prev, hash from audit order by seq') : this.mem
    let prev = d ? GENESIS : this.mem[0]?.prev ?? GENESIS
    for (const r of rows) {
      if (r.prev !== prev || hash(r.prev, `${r.at}|${r.payload}`) !== r.hash) return { ok: false, count: rows.length, brokenAt: r.seq }
      prev = r.hash
    }
    return { ok: true, count: rows.length }
  }
}

export const audit = new AuditLog()
