import type { GraphSnapshot } from '@shared/graph'

// Demo / browser data for the Flow tab (README art, --lab, tests): busy, attention (parked / failed / interrupted + a reroute), many (overflow) and idle scenarios.
// `window.__agentsGraph.set('empty')` switches.
const M = 60_000
export type GraphScenario = 'rich' | 'attention' | 'many' | 'empty'
export function mockGraph(scenario: GraphScenario, now = Date.now()): GraphSnapshot {
  const flash = { id: 'flash', name: 'Gemini Flash', model: 'main-model', roles: ['main', 'vision'], requests: 84, tokens: 212_000, note: '' }
  if (scenario === 'empty') {
    return {
      at: now, voice: 'idle', offline: false, jobs: [], loops: [], mcp: [],
      schedule: [{ id: 's1', title: 'Morning briefing', runAt: now + 11 * 3_600_000 + 20 * M, repeat: 'daily', status: 'pending' }],
      models: [{ ...flash, state: 'idle', requests: 0, tokens: 0 }],
    }
  }
  const models: GraphSnapshot['models'] = [
    { ...flash, state: 'serving' },
    { id: 'flash-lite', name: 'Flash-Lite', model: 'fast-model', state: 'serving', roles: ['fast'], requests: 31, tokens: 40_000, note: '' },
    { id: 'openrouter', name: 'FreeLLMAPI', model: 'free', state: 'resting', roles: [], requests: 12, tokens: 9_000, note: 'rate limited, resting', until: now + 8 * M },
  ]
  const mcp: GraphSnapshot['mcp'] = [
    { id: 'gh', name: 'GitHub', ok: true, tools: 12 },
    { id: 'mail', name: 'Gmail', ok: true, tools: 9 },
    { id: 'notion', name: 'Notion', ok: false, tools: 0, error: 'could not start' },
  ]
  const schedule: GraphSnapshot['schedule'] = [
    { id: 's1', title: 'Open Netflix', runAt: now + 14 * M, status: 'pending' },
    { id: 's2', title: 'Stand-up reminder', runAt: now + 80 * M, repeat: 'weekdays', status: 'pending' },
    { id: 's3', title: 'Morning briefing', runAt: now + 15 * 3_600_000, repeat: 'daily', status: 'pending' },
  ]
  const loops: GraphSnapshot['loops'] = [
    { id: 'l1', what: 'Send Priya the Q3 deck', who: 'Priya', due: now + 20 * 3_600_000 },
    { id: 'l2', what: 'Call the bank', due: now - 3 * 3_600_000 },
  ]
  const j1 = { id: 'j1', role: 'researcher', title: 'Find the best standing desks under 30k', goal: 'Find the best standing desks under 30k rupees and compare three of them', status: 'running' as const, kind: 'task', backend: 'api', startedAt: now - 2.5 * M, steps: 6, line: 'searching: standing desk reviews India', model: 'flash' }
  const j2 = { id: 'j2', role: 'operator', title: 'Fill in the expense form in Chrome', goal: 'Fill in the expense form in Chrome with last month\'s receipts', status: 'running' as const, kind: 'operator', backend: 'api', startedAt: now - 70_000, steps: 3, line: 'click element 14 "Add receipt"', model: 'flash' }
  const j3 = { id: 'j3', role: 'coder', title: 'Fix the failing tests in lokey/app', goal: 'Fix the failing tests in lokey/app', status: 'running' as const, kind: 'cli', backend: 'claude', startedAt: now - 8 * M, steps: 21, line: 'Edit src/main/ai/gateway.ts' }
  const j4 = { id: 'j4', role: 'writer', title: 'Draft a reply to Priya about the deck', goal: 'Draft a reply to Priya about the deck', status: 'done' as const, kind: 'task', backend: 'api', startedAt: now - 9 * M, endedAt: now - 6 * M, steps: 5, line: 'Saved to Documents/reply-priya.txt', result: 'Drafted a short, friendly reply and saved it to Documents/reply-priya.txt.', model: 'flash' }
  const j5 = { id: 'j5', role: 'general', title: 'Organise the Downloads folder', goal: 'Organise the Downloads folder', status: 'failed' as const, kind: 'task', backend: 'api', startedAt: now - 20 * M, endedAt: now - 17 * M, steps: 9, line: 'The model failed twice', result: 'I could not finish: the model failed' }
  const j6 = { id: 'j6', role: 'general', title: 'Summarise this week\'s newsletters', goal: 'Summarise this week\'s newsletters', status: 'interrupted' as const, kind: 'task', backend: 'api', startedAt: now - 3 * 3_600_000, steps: 0, line: 'the app was closed while this ran' }
  const reroute = { from: 'openrouter', to: 'flash', at: now - 40_000, role: 'main' }
  const events = [{ id: 'r1', at: now - 40_000, kind: 'retry' as const, text: 'Retrying on Gemini Flash', sub: 'FreeLLMAPI is resting' }]
  if (scenario === 'attention') {
    return {
      at: now, voice: 'idle', offline: false, schedule: schedule.slice(0, 1), loops, models, mcp, reroutes: [reroute], events,
      jobs: [
        j5,
        { id: 'j7', role: 'researcher', title: 'Compare noise-cancelling headphones for flights', goal: 'Compare noise-cancelling headphones for flights', status: 'parked', kind: 'task', backend: 'api', startedAt: now - 5 * M, steps: 4, line: 'waiting for a model', until: now + 6 * M, waitKind: 'RATE_MINUTE' },
        j6,
        j4,
      ],
    }
  }
  if (scenario === 'many') {
    const more = Array.from({ length: 5 }, (_, i) => ({ ...j2, id: 'jm' + i, title: `Check invoice batch ${i + 1} against the bank statement`, startedAt: now - (i + 1) * 30_000, status: (i < 2 ? 'running' : 'done') as 'running' | 'done', endedAt: i < 2 ? undefined : now - i * M }))
    return {
      at: now, voice: 'working', offline: false, models, mcp, reroutes: [reroute], events,
      jobs: [j1, j2, j3, j4, j5, j6, ...more],
      schedule: [...schedule, { id: 's4', title: 'Water the plants reminder', runAt: now + 5 * 3_600_000, status: 'pending' }, { id: 's5', title: 'Weekly review', runAt: now + 2 * 86_400_000, repeat: 'weekly', status: 'pending' }],
      loops: [...loops, { id: 'l3', what: 'Reply to the landlord about the lease' }, { id: 'l4', what: 'Book flights for March' }, { id: 'l5', what: 'Send invoice to Acme' }],
    }
  }
  return { at: now, voice: 'thinking', offline: false, jobs: [j1, j2, j3, j4, j5], schedule, loops, models, mcp, reroutes: [reroute], events }
}

export function createGraphMock() {
  const q = new URLSearchParams(location.search).get('graph')
  let scenario: GraphScenario = q === 'empty' || q === 'attention' || q === 'many' ? q : 'rich'
  const cbs = new Set<(g: GraphSnapshot) => void>()
  ;(window as unknown as { __agentsGraph: unknown }).__agentsGraph = { set(s: GraphScenario) { scenario = s; cbs.forEach(cb => cb(mockGraph(s))) } }
  return {
    graph: async () => mockGraph(scenario),
    watchGraph() {},
    onGraph: (cb: (g: GraphSnapshot) => void) => { cbs.add(cb); return () => { cbs.delete(cb) } },
    retry: async () => ({ id: 'new' }),
  }
}
