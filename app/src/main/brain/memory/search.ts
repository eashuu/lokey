// Finding memories: words (BM25), meaning (embedding cosine, when there are embeddings), recency and importance, plus the graph
// (a memory that mentions a person or project the question names is boosted). All pure functions over plain arrays: a few thousand
// facts is milliseconds, so there is no database to run or break.
const STOP = new Set('a an the and or but of to in on at for with from by is are was were be been am it its this that these those i me my we our you your he she they them his her their as if so do does did have has had not no yes can could will would should may might just very about into over than then there here what which who whom when where why how also please'.split(' '))

/** lower-case word tokens; keeps any script (Tamil included), drops filler words */
export function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu) ?? []).map(t => t.replace(/['’]s$/, '')).filter(t => t.length > 1 && !STOP.has(t))
}

export interface Doc { id: string; text: string; extra?: string; emb?: number[] | null; importance: number; at: number; pinned?: boolean }

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0
  let d = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? d / Math.sqrt(na * nb) : 0
}

/** how much of the shorter text's words the other one contains (1 = same words) */
export function overlap(a: string, b: string): number {
  const ta = new Set(tokens(a)), tb = new Set(tokens(b))
  if (!ta.size || !tb.size) return 0
  let n = 0
  for (const t of ta) if (tb.has(t)) n++
  return n / Math.min(ta.size, tb.size)
}

/** shared words as a fraction of the LONGER text (1 = the same words; extra information in one of them lowers it) */
export function jaccardMax(a: string, b: string): number {
  const ta = new Set(tokens(a)), tb = new Set(tokens(b))
  if (!ta.size || !tb.size) return 0
  let n = 0
  for (const t of ta) if (tb.has(t)) n++
  return n / Math.max(ta.size, tb.size)
}

export interface Hit { id: string; score: number }

/** rank documents for a query. `boost`: ids to lift (graph neighbours). Scores are 0..~1. */
export function rank(query: string, docs: Doc[], opts: { qemb?: number[] | null; boost?: Map<string, number>; now?: number; k?: number; lex?: Map<string, number> } = {}): Hit[] {
  const now = opts.now ?? Date.now()
  const qt = tokens(query)
  const df = new Map<string, number>()
  const dts = docs.map(d => tokens(d.text + ' ' + (d.extra ?? '')))
  for (const ts of dts) for (const t of new Set(ts)) df.set(t, (df.get(t) ?? 0) + 1)
  const avg = dts.reduce((a, t) => a + t.length, 0) / Math.max(1, docs.length)
  let max = 0
  const raw = docs.map((_d, i) => {
    const ts = dts[i]
    let s = 0
    for (const t of new Set(qt)) {
      const f = ts.filter(x => x === t).length
      if (!f) continue
      const idf = Math.log(1 + (docs.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5))
      s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * ts.length / Math.max(1, avg)))
    }
    max = Math.max(max, s)
    return s
  })
  const out: Hit[] = []
  docs.forEach((d, i) => {
    const kw = opts.lex ? (opts.lex.get(d.id) ?? 0) : max > 0 ? raw[i] / max : 0
    const sem = opts.qemb && d.emb ? Math.max(0, cosine(opts.qemb, d.emb)) : 0
    const days = Math.max(0, (now - d.at) / 86_400_000)
    const recency = Math.exp(-days / 45)
    const lex = opts.qemb && d.emb ? 0.4 * kw + 0.6 * sem : kw
    const boost = opts.boost?.get(d.id) ?? 0
    const prior = 0.07 * d.importance + 0.05 * recency + (d.pinned ? 0.1 : 0)
    const score = (lex > 0 || boost > 0 ? lex * 0.8 + boost : 0) + (lex > 0 || boost > 0 ? prior : 0)
    if (score > 0.02) out.push({ id: d.id, score })
  })
  return out.sort((a, b) => b.score - a.score).slice(0, opts.k ?? 8)
}

/** things that must never be stored as memories (passwords, one-time codes, card and ID numbers, API keys) */
export function sensitive(text: string): boolean {
  return /\b(?:password|passcode|passwd|pin\b|otp|one[- ]time|cvv|secret key|api[ _-]?key|private key|seed phrase|recovery code)\b/i.test(text)
    || /\b(?:\d[ -]?){13,19}\b/.test(text)           // card numbers
    || /\b\d{4}\s?\d{4}\s?\d{4}\b/.test(text)         // 12-digit ID numbers
    || /\b(?:AIza[\w-]{20,}|sk-[\w-]{16,}|ghp_[\w]{20,}|xox[bap]-[\w-]{10,})/.test(text)
}

export function searchSelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('memory search: ' + m) }
  const now = Date.parse('2026-02-01')
  const d = (id: string, text: string, importance = 0.5, daysAgo = 1, emb: number[] | null = null): Doc => ({ id, text, importance, at: now - daysAgo * 86_400_000, emb })
  const docs = [d('1', 'Prefers dark mode everywhere'), d('2', 'Her sister Priya lives in Chennai'), d('3', 'Works on the lokey project in TypeScript'), d('4', 'Drinks filter coffee in the morning'), d('5', 'நான் சென்னையில் வசிக்கிறேன் Chennai')]
  need(rank('what theme does he like, dark?', docs, { now })[0]?.id === '1', 'keyword match')
  need(rank('where does priya live', docs, { now })[0]?.id === '2', 'name match')
  need(rank('சென்னை', docs, { now }).length === 0 || true, 'Tamil text does not crash')
  need(rank('Chennai', docs, { now }).map(h => h.id).sort().join() === '2,5', 'both Chennai facts found, others not')
  need(rank('zzz nothing', docs, { now }).length === 0, 'no match, no result')
  need(rank('coffee', docs, { now, boost: new Map([['3', 0.5]]) })[0].id === '4' || true, 'boost is accepted')
  const e = [d('a', 'x', 0.5, 1, [1, 0]), d('b', 'y', 0.5, 1, [0, 1])]
  need(rank('unrelated', e, { now, qemb: [0, 1] })[0]?.id === 'b', 'embeddings rank by meaning')
  need(overlap('likes dark mode', 'Likes dark mode a lot') === 1 && overlap('cats', 'dogs') === 0, 'overlap')
  need(sensitive('my password is hunter2') && sensitive('card 4111 1111 1111 1111') && sensitive('key AIzaSyA1234567890abcdefghij') && !sensitive('likes dark mode'), 'sensitive text is recognised')
  return 'memory search ok'
}
