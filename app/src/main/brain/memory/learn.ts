import type { FactKind } from '@shared/memory'
import { isWait } from '../../ai/errors'
import type { BrainRole } from '@shared/bridge'
import type { ChatRequest, ChatResponse } from '../types'
import type { Schema } from '../../ai/runtime/schema'
import type { BrainStore } from './store'
import { jaccardMax, sensitive } from './search'
import { addPromise } from './promises'

// How Lokey learns (memory v2). After a conversation (or a finished job) ONE cheap-model call reads it together with the few existing
// memories it might touch and returns operations: ADD (new), UPDATE (a changed fact: the old row is closed, a new one starts),
// DELETE (no longer true), NOOP (already known). That replaces the extract-then-decide pair of calls (one add-only call scores as
// well, per Mem0 v3) and halves the cost. Corrections and failures become short lessons.
//
// Trust: when the conversation happened right after reading untrusted content (a web page, mail, the screen: `taint`), nothing it
// produces can be believed. New facts go to QUARANTINE (never retrieved or put in a prompt until the person approves them), such a
// session cannot update or delete facts the person can rely on, and it writes no lessons, relations or commitments.
export interface Turn { user: string; assistant: string; tools?: string[]; tainted?: string }
export interface LearnDeps {
  chat: (role: BrainRole, req: ChatRequest) => Promise<ChatResponse>
  embed: (texts: string[]) => Promise<number[][] | null>
  /** a JSON answer checked against a schema, repaired once, then the next model (the gateway's callJson). Without it the answer is parsed leniently. */
  json?: (role: BrainRole, req: ChatRequest, schema: Schema) => Promise<unknown>
}
export interface LearnResult { added: number; updated: number; retired: number; lessons: number; skipped: number; quarantined: number }

const PROMPT = `You keep the long-term memory of a personal assistant that lives on the user's PC. Read the conversation and decide what to remember about the USER. You also get EXISTING memories (id + text) that might be related. Return JSON:
{"ops":[{"op":"ADD|UPDATE|DELETE|NOOP","id":"existing id (UPDATE and DELETE only)","text":"one short standalone sentence (ADD and UPDATE)","kind":"preference|fact|person|project|routine|place","importance":0.1-1,"entities":[{"name":"...","type":"person|project|place|app|org|thing"}]}],"relations":[{"src":"...","rel":"...","dst":"..."}],"lessons":[{"trigger":"when ...","advice":"..."}],"commitments":[{"what":"send Ravi the report","who":"Ravi","due":"ISO date-time or empty"}]}
ADD = durable new information that will matter in weeks: preferences, people in their life, projects, places, routines, decisions, details of their setup. UPDATE = it refines or corrects the existing memory with that id (text = the final merged sentence). DELETE = that existing memory is no longer true. NOOP = already known (or not worth keeping).
Rules: each text is ONE short sentence about the user ("Prefers filter coffee in the morning"), in the language the user used (Tamil stays Tamil). Never include passwords, keys, OTPs, card or ID numbers. Skip small talk, one-off requests ("open Chrome", "what time is it"), questions, and anything only the assistant said. A lesson is only for a CORRECTION or a failure ("no, I meant the other Chrome profile"): how to behave next time, in one sentence. A commitment is something the USER promised or was asked to do; only concrete ones. Use empty arrays when there is nothing to keep.`

const KINDS = new Set(['preference', 'fact', 'person', 'project', 'routine', 'place'])
const str = (max: number): Schema => ({ type: 'string', max })
const OPS_SCHEMA: Schema = { type: 'object', required: ['ops'], props: {
  ops: { type: 'array', max: 12, items: { type: 'object', required: ['op'], props: { op: { type: 'string', enum: ['ADD', 'UPDATE', 'DELETE', 'NOOP'] }, id: str(40), text: str(400), kind: str(20), importance: { type: 'number' }, entities: { type: 'array', max: 8, items: { type: 'object', props: { name: str(80), type: str(20) } } } } } },
  relations: { type: 'array', max: 12, items: { type: 'object', props: { src: str(80), rel: str(60), dst: str(80) } } },
  lessons: { type: 'array', max: 6, items: { type: 'object', props: { trigger: str(200), advice: str(300) } } },
  commitments: { type: 'array', max: 6, items: { type: 'object', props: { what: str(200), who: str(80), due: str(40) } } },
} }

/** a model's JSON answer, tolerant of code fences and chatter around it */
export function parseJson(text: string): any {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(t) } catch { /* try the outermost braces */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { /* give up */ } }
  return null
}

export async function learn(store: BrainStore, turns: Turn[], deps: LearnDeps, o: { taint?: string } = {}): Promise<LearnResult> {
  const res: LearnResult = { added: 0, updated: 0, retired: 0, lessons: 0, skipped: 0, quarantined: 0 }
  const taint = o.taint ?? ''
  const kept = turns.filter(t => t.user.trim() && !sensitive(t.user) && !sensitive(t.assistant))
  res.skipped = turns.length - kept.length
  if (!kept.length) return res
  const transcript = kept.map(t => `User: ${t.user.slice(0, 500)}\nAssistant: ${t.assistant.slice(0, 400)}${t.tools?.length ? ` [did: ${t.tools.join(', ')}]` : ''}`).join('\n').slice(0, 6000)
  // the existing memories the conversation might touch (trusted ones only: what is in quarantine is not shown to the model either)
  const related = [...new Map([...store.search(kept.map(t => `${t.user} ${t.assistant}`).join(' '), { k: 10 }), ...store.core(6)].map(f => [f.id, f])).values()].slice(0, 14)   // what the words match, plus what matters most (a follow-up like "with jaggery actually" names nothing)
  const req: ChatRequest = { system: PROMPT, messages: [{ role: 'user', text: `EXISTING:\n${JSON.stringify(related.map(f => ({ id: f.id, text: f.text })))}\n\nCONVERSATION:\n${transcript}` }], json: true, temperature: 0, maxTokens: 1100 }
  let j: any
  try {
    j = deps.json ? await deps.json('fast', req, OPS_SCHEMA) : parseJson((await deps.chat('fast', req)).text)
  } catch (e) { if (isWait(e)) throw e; return res }   // a wait is retried later by the caller (memory.flush)
  if (!j || !Array.isArray(j.ops)) return res

  type Op = { op: string; id?: string; text?: string; kind?: string; importance?: number; entities?: { name: string; type?: string }[] }
  const ops: Op[] = j.ops.slice(0, 12)
  const texts = ops.filter(p => (p.op === 'ADD' || p.op === 'UPDATE') && typeof p.text === 'string').map(p => p.text!.replace(/\s+/g, ' ').trim()).filter(t => t.length >= 8 && t.length <= 300 && !sensitive(t))
  const embs = texts.length ? await deps.embed(texts) : null
  const embOf = (t: string) => { const i = texts.indexOf(t); return i >= 0 ? embs?.[i] ?? null : null }
  const known = (id: unknown) => typeof id === 'string' && store.live().some(f => f.id === id)
  const ents = (p: Op) => (Array.isArray(p.entities) ? p.entities : []).filter(e => e && typeof e.name === 'string').slice(0, 5).map(e => ({ name: String(e.name), type: typeof e.type === 'string' ? e.type : undefined }))

  const addNew = (t: string, p: Op) => {
    const emb = embOf(t)
    const same = store.similar(t, emb, 1)[0]
    if (same && same.score >= 0.9) { store.touch(same.fact.id); return }
    // a quarantined fact the person is now (without any outside content in play) saying again is corroborated
    if (!taint) { const q = store.quarantined().find(f => jaccardMax(f.text, t) >= 0.9); if (q) { store.approve(q.id); res.added++; return } }
    const kind = (KINDS.has(String(p.kind)) ? p.kind : 'fact') as FactKind
    store.add(t, { kind, entities: ents(p), importance: Math.max(0.1, Math.min(1, Number(p.importance) || 0.5)), source: 'chat', emb, taint })
    if (taint) res.quarantined++; else res.added++
  }

  for (const p of ops) {
    const t = typeof p.text === 'string' ? p.text.replace(/\s+/g, ' ').trim() : ''
    const good = t.length >= 8 && t.length <= 300 && !sensitive(t)
    if (p.op === 'ADD' && good) addNew(t, p)
    else if (p.op === 'UPDATE' && good && known(p.id)) {
      if (taint) addNew(t, p)                       // untrusted content may propose a change, never make it
      else { store.update(p.id!, t, 'merged with a newer statement', embOf(t)); res.updated++ }
    } else if (p.op === 'DELETE' && known(p.id) && !taint) { store.retire(p.id!, 'no longer true'); res.retired++ }
    else if (p.op === 'NOOP' && known(p.id)) store.touch(p.id!)
  }

  if (!taint) {
    for (const r of Array.isArray(j.relations) ? j.relations.slice(0, 8) : []) if (r && typeof r.src === 'string' && typeof r.dst === 'string' && typeof r.rel === 'string') store.relate(r.src, r.rel, r.dst)
    for (const l of Array.isArray(j.lessons) ? j.lessons.slice(0, 3) : []) if (l && typeof l.trigger === 'string' && typeof l.advice === 'string' && !sensitive(l.advice)) { store.addLesson(l.trigger, l.advice); res.lessons++ }
    for (const c of Array.isArray(j.commitments) ? j.commitments.slice(0, 3) : []) if (c && typeof c.what === 'string' && !sensitive(c.what)) addPromise(c.what, typeof c.who === 'string' ? c.who : undefined, typeof c.due === 'string' ? c.due : undefined)
  }
  store.episode({ kind: 'chat', summary: kept[0].user.replace(/\s+/g, ' ').slice(0, 100), tools: [...new Set(kept.flatMap(t => t.tools ?? []))].slice(0, 8), outcome: 'ok' })
  store.save()
  return res
}

export const LEARN_PROMPTS = { PROMPT }
