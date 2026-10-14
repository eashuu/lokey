import type { FactKind } from '@shared/memory'
import type { BrainRole } from '@shared/bridge'
import type { ChatRequest, ChatResponse } from '../types'
import type { BrainStore } from './store'
import { sensitive } from './search'
import { addPromise } from './promises'

// How Lokey learns. After a conversation (or a finished job) a cheap model reads it and writes down what is worth keeping across
// weeks; each candidate is compared with what is already known, and one small second call (only when something is ambiguous) decides
// ADD / UPDATE / DELETE / NOOP, which is what stops memory from filling up with the same thing said five ways, and what lets a
// changed fact replace the old one instead of contradicting it. Corrections and failures become short lessons.
export interface Turn { user: string; assistant: string; tools?: string[] }
export interface LearnDeps {
  chat: (role: BrainRole, req: ChatRequest) => Promise<ChatResponse>
  embed: (texts: string[]) => Promise<number[][] | null>
}
export interface LearnResult { added: number; updated: number; retired: number; lessons: number; skipped: number }

const EXTRACT = `You keep the long-term memory of a personal assistant that lives on the user's PC. Read the conversation and extract ONLY durable information about the USER that will still matter in weeks: preferences, people in their life, projects, places, routines, decisions, details of their setup. Return JSON:
{"facts":[{"text":"...","kind":"preference|fact|person|project|routine|place","importance":0.1-1,"entities":[{"name":"...","type":"person|project|place|app|org|thing"}]}],"relations":[{"src":"...","rel":"...","dst":"..."}],"lessons":[{"trigger":"when ...","advice":"..."}],"commitments":[{"what":"send Ravi the report","who":"Ravi","due":"ISO date-time or empty"}]}
A commitment is something the USER promised to do or was asked to do ("I'll send it tomorrow"); only concrete ones.
Rules: each fact is ONE short standalone sentence about the user ("Prefers filter coffee in the morning"), in the language the user used (Tamil stays Tamil). Never include passwords, keys, OTPs, card or ID numbers. Skip small talk, one-off requests ("open Chrome", "what time is it"), questions, and anything only the assistant said. A lesson is only for a CORRECTION or a failure ("no, I meant the other Chrome profile", the user declined an action): how to behave next time, in one sentence. Use empty arrays when there is nothing worth keeping.`

const DECIDE = `You decide how NEW memories fit with EXISTING ones. For each new item return exactly one op:
ADD = it is new information; UPDATE = it refines or corrects the existing fact with that id (give the final merged text); NOOP = already known; DELETE = the existing fact with that id is no longer true and the new item replaces it.
Return JSON {"ops":[{"i":0,"op":"ADD|UPDATE|NOOP|DELETE","id":"existing id (UPDATE and DELETE only)","text":"final text (UPDATE only)"}]}`

const KINDS = new Set(['preference', 'fact', 'person', 'project', 'routine', 'place'])

/** a model's JSON answer, tolerant of code fences and chatter around it */
export function parseJson(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(t) } catch { /* try the outermost braces */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { /* give up */ } }
  return null
}

export async function learn(store: BrainStore, turns: Turn[], deps: LearnDeps): Promise<LearnResult> {
  const res: LearnResult = { added: 0, updated: 0, retired: 0, lessons: 0, skipped: 0 }
  const kept = turns.filter(t => t.user.trim() && !sensitive(t.user) && !sensitive(t.assistant))
  res.skipped = turns.length - kept.length
  if (!kept.length) return res
  const transcript = kept.map(t => `User: ${t.user.slice(0, 500)}\nAssistant: ${t.assistant.slice(0, 400)}${t.tools?.length ? ` [did: ${t.tools.join(', ')}]` : ''}`).join('\n').slice(0, 6000)
  const out = await deps.chat('fast', { system: EXTRACT, messages: [{ role: 'user', text: transcript }], json: true, temperature: 0, maxTokens: 900 })
  const j = parseJson(out.text)
  if (!j) return res

  type Cand = { text: string; kind: FactKind; importance: number; entities: { name: string; type?: string }[] }
  const cands: Cand[] = (Array.isArray(j.facts) ? j.facts : []).slice(0, 8).map((f: any): Cand => ({
    text: String(f?.text ?? '').trim(), kind: (KINDS.has(f?.kind) ? f.kind : 'fact') as FactKind, importance: Math.max(0.1, Math.min(1, Number(f?.importance) || 0.5)),
    entities: (Array.isArray(f?.entities) ? f.entities : []).filter((e: any) => e && typeof e.name === 'string').slice(0, 5).map((e: any) => ({ name: String(e.name), type: typeof e.type === 'string' ? e.type : undefined })),
  })).filter((c: Cand) => c.text.length >= 8 && c.text.length <= 300 && !sensitive(c.text))

  const embs = cands.length ? await deps.embed(cands.map(c => c.text)) : null
  const ambiguous: { i: number; sims: { id: string; text: string }[] }[] = []
  const addNow = (i: number) => { const c = cands[i]; store.add(c.text, { kind: c.kind, entities: c.entities, importance: c.importance, source: 'chat', emb: embs?.[i] ?? null }); res.added++ }
  cands.forEach((c, i) => {
    const sims = store.similar(c.text, embs?.[i] ?? null, 3)
    const best = sims[0]
    if (best && best.score >= 0.9) { store.touch(best.fact.id); return }
    if (!best || best.score < 0.4) { addNow(i); return }
    ambiguous.push({ i, sims: sims.filter(s => s.score >= 0.3).map(s => ({ id: s.fact.id, text: s.fact.text })) })
  })

  if (ambiguous.length) {
    let ops: any[] | null = null
    try {
      const r = await deps.chat('fast', { system: DECIDE, messages: [{ role: 'user', text: JSON.stringify({ new: ambiguous.map(a => ({ i: a.i, text: cands[a.i].text })), existing: [...new Map(ambiguous.flatMap(a => a.sims).map(s => [s.id, s])).values()] }) }], json: true, temperature: 0, maxTokens: 500 })
      ops = parseJson(r.text)?.ops ?? null
    } catch { ops = null }
    for (const a of ambiguous) {
      const op = ops?.find((o: any) => o?.i === a.i)
      const known = (id: unknown) => typeof id === 'string' && store.fact(id) && !store.fact(id)!.gone
      if (op?.op === 'NOOP') { if (known(op.id)) store.touch(op.id); else if (a.sims[0]) store.touch(a.sims[0].id) }
      else if (op?.op === 'UPDATE' && known(op.id) && typeof op.text === 'string' && op.text.trim().length >= 8 && !sensitive(op.text)) { const e = (await deps.embed([op.text]))?.[0] ?? null; store.update(op.id, op.text, 'merged with a newer statement', e); res.updated++ }
      else if (op?.op === 'DELETE' && known(op.id)) { store.retire(op.id, 'replaced by a newer statement'); addNow(a.i); res.retired++ }
      else addNow(a.i) // ADD, or no usable answer: keeping a near-duplicate is safer than losing information (upkeep merges them later)
    }
  }

  for (const r of Array.isArray(j.relations) ? j.relations.slice(0, 8) : []) if (r && typeof r.src === 'string' && typeof r.dst === 'string' && typeof r.rel === 'string') store.relate(r.src, r.rel, r.dst)
  for (const l of Array.isArray(j.lessons) ? j.lessons.slice(0, 3) : []) if (l && typeof l.trigger === 'string' && typeof l.advice === 'string' && !sensitive(l.advice)) { store.addLesson(l.trigger, l.advice); res.lessons++ }
  for (const c of Array.isArray(j.commitments) ? j.commitments.slice(0, 3) : []) if (c && typeof c.what === 'string' && !sensitive(c.what)) addPromise(c.what, typeof c.who === 'string' ? c.who : undefined, typeof c.due === 'string' ? c.due : undefined)
  store.episode({ kind: 'chat', summary: kept[0].user.replace(/\s+/g, ' ').slice(0, 100), tools: [...new Set(kept.flatMap(t => t.tools ?? []))].slice(0, 8), outcome: 'ok' })
  store.save()
  return res
}

export const LEARN_PROMPTS = { EXTRACT, DECIDE }
