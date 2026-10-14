import { ipcMain } from 'electron'
import type { Agent } from '../agent/agent'
import type { Sidecar } from '../sidecar'
import type { AgentTask } from '@shared/voice'
import { memory } from '../brain/memory'
import { linkNewCode, linkPush, linkRevoke, linkSetEnabled, linkState, startLink } from './server'

let done = false
/** Wires Lokey Link into the app: the Settings > Devices IPC and the deps the server needs. Safe to call twice. */
export function registerLink(agent: Agent, sidecar: Sidecar) {
  if (done) return
  done = true
  ipcMain.handle('lokey:link:state', () => linkState())
  ipcMain.handle('lokey:link:enabled', (_e, on: boolean) => linkSetEnabled(on === true))
  ipcMain.handle('lokey:link:code', () => linkNewCode())
  ipcMain.handle('lokey:link:revoke', (_e, id: string) => linkRevoke(String(id)))
  let battery: unknown = null
  sidecar.onEvent('stats.tick', t => { battery = (t as unknown as { battery?: unknown }).battery ?? battery })
  const seen = new Map<string, string>()
  agent.on('agents', (l: AgentTask[]) => {
    for (const t of l) {
      if (seen.get(t.id) !== t.status && t.status !== 'running') linkPush('job', { title: t.title, text: `${t.status}: ${t.title}` })
      seen.set(t.id, t.status)
    }
  })
  startLink({
    say: text => { if (agent.info().state !== 'idle') return false; void agent.say(text, 'assistant', 'remote'); return true }, // 'remote': at most 'risky', no earned trust, no settings tools
    status: async () => {
      const media = await sidecar.call('media.get', {}).catch(() => null)
      return { pc: 'online', agent: agent.info().state, battery, nowPlaying: media && media.hasSession ? { app: media.app, title: media.title, artist: media.artist, playing: media.playing } : null, jobs: agent.tasks.list().filter(t => t.status === 'running').map(t => t.title) }
    },
    facts: () => memory.list().slice(0, 300).map(f => ({ text: f.text, kind: f.kind, pinned: !!f.pinned, updated: (f as unknown as { updated?: number }).updated ?? 0 })),
    addFacts: async items => { let n = 0; for (const i of items) { const r = await memory.add(i.text, { source: 'phone', kind: (['fact','preference','person','project','routine'].includes(i.kind ?? '') ? i.kind : 'fact') as never }); if (r && !r.existing) n++ } return n },
    recall: q => (q ? memory.recall(q, 8) : Promise.resolve([])),
  })
}
