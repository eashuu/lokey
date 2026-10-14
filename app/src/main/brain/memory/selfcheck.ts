import { settings } from '../../settings'
import type { ChatRequest, ChatResponse } from '../types'
import { Memory } from './index'
import { BrainStore } from './store'
import { searchSelfCheck } from './search'

// `--selfcheck` for the memory engine: a scripted "model" stands in for the cheap model, the store lives in memory only.
const reply = (obj: unknown): ChatResponse => ({ text: JSON.stringify(obj), toolCalls: [], usage: { in: 1, out: 1, cached: 0 }, provider: 'script', model: 'script' })

export async function memorySelfCheck(): Promise<string> {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('memory: ' + m) }
  searchSelfCheck()

  let extraction: unknown = { facts: [], relations: [], lessons: [] }
  let decide: (req: ChatRequest) => unknown = () => ({ ops: [] })
  let journal: unknown = { text: 'A quiet day.' }
  const mem = new Memory(new BrainStore(false), {
    embed: async () => null,
    chat: async (_role, req) => (/journal entry/.test(req.system) ? reply(journal) : /decide how NEW/.test(req.system) ? reply(decide(req)) : reply(extraction)),
  })

  // 1. a conversation is learned from: facts, people, places, a relation and a lesson
  extraction = {
    facts: [
      { text: 'Prefers dark mode everywhere', kind: 'preference', importance: 0.7, entities: [] },
      { text: 'Her sister Priya lives in Chennai', kind: 'person', importance: 0.8, entities: [{ name: 'Priya', type: 'person' }, { name: 'Chennai', type: 'place' }] },
      { text: 'password is hunter2 for the router', kind: 'fact', importance: 0.9, entities: [] },
    ],
    relations: [{ src: 'Priya', rel: 'lives in', dst: 'Chennai' }],
    lessons: [{ trigger: 'when opening Chrome', advice: 'use the Work profile, not the personal one' }],
  }
  mem.note({ user: 'I like everything dark, and my sister Priya is in Chennai', assistant: 'Noted.', tools: ['remember'] })
  mem.note({ user: 'my password is hunter2', assistant: 'I will not store that.' })
  need(mem.stats().queued === 1, 'a sentence with a password is never even queued')
  await mem.flush()
  let s = mem.stats()
  need(s.facts === 2 && s.entities === 2 && s.relations === 1 && s.lessons === 1, `learned two facts, two entities, a relation and a lesson (got ${JSON.stringify(s)})`)
  need(mem.store.search('where does priya live')[0]?.text.includes('Priya'), 'found by name')
  need(mem.forPrompt('Chrome').lessons[0]?.includes('Work profile'), 'the lesson comes back for a related request')

  // 2. a similar new statement goes through the decide step and UPDATES instead of duplicating
  extraction = { facts: [{ text: 'Prefers dark mode in every app and website', kind: 'preference', importance: 0.7, entities: [] }], relations: [], lessons: [] }
  decide = req => { const j = JSON.parse((req.messages[0].text ?? '{}')); return { ops: [{ i: j.new[0].i, op: 'UPDATE', id: j.existing[0].id, text: 'Prefers dark mode in every app and website' }] } }
  mem.note({ user: 'actually dark mode in every app and website', assistant: 'Okay.' })
  await mem.flush()
  s = mem.stats()
  need(s.facts === 2 && mem.list().some(f => f.text === 'Prefers dark mode in every app and website') && mem.store.d.ops.some(o => o.op === 'UPDATE'), 'a refined fact replaces the old one and the change is logged')

  // 3. a fact the user retracts is retired, and a contradicting one replaces it
  decide = req => { const j = JSON.parse((req.messages[0].text ?? '{}')); return { ops: [{ i: j.new[0].i, op: 'DELETE', id: j.existing[0].id }] } }
  extraction = { facts: [{ text: 'Her sister Priya now lives in Bengaluru', kind: 'person', importance: 0.8, entities: [{ name: 'Priya', type: 'person' }] }], relations: [], lessons: [] }
  mem.note({ user: 'Priya moved to Bengaluru', assistant: 'Updated.' })
  await mem.flush()
  const live = mem.list().map(f => f.text)
  need(live.some(t => /Bengaluru/.test(t)) && !live.some(t => /lives in Chennai/.test(t)), 'the old statement is retired when it is replaced')

  // 4. forgetting, pausing
  need(mem.forget('bengaluru') === 1 && !mem.list().some(f => /Bengaluru/.test(f.text)), 'forget removes what matches')
  settings.value.brain.learn = false
  mem.note({ user: 'I love jazz and play the piano every evening', assistant: 'Nice.' })
  settings.value.brain.learn = true
  need(mem.stats().queued === 0, 'paused learning stores nothing')

  // 5. upkeep merges near-duplicates; manual adds
  mem.store.add('Drinks filter coffee every morning', { kind: 'routine', importance: 0.5 })
  mem.store.add('Drinks filter coffee every morning.', { kind: 'routine', importance: 0.4 })
  need(mem.store.upkeep().merged === 1, 'near-duplicate facts are merged')
  const a = await mem.add('Works on the lokey project', { source: 'manual' })
  const b = await mem.add('Works on the lokey project', { source: 'manual' })
  need(!!a && !!b && !a.existing && b.existing, 'saying the same thing twice does not store it twice')
  need((await mem.add('my api key is AIzaSyA1234567890abcdefghij')) === null, 'secrets are refused')

  // 6. the daily reflection writes a journal line
  await mem.reflect(true)
  need(mem.journal().length === 1 && mem.journal()[0].text === 'A quiet day.', 'journal entry written')
  need(JSON.parse(mem.exportJson()).facts.length === mem.stats().facts && mem.graph().nodes.length >= 2, 'export and graph')
  mem.clear()
  need(mem.stats().facts === 0, 'clear')
  return 'memory ok'
}
