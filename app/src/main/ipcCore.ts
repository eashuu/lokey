import { ipcMain } from 'electron'
import { conversation } from './agent/conversation'
import { clearActions, readActions } from './agent/permissions'
import { clearSecret, hasSecret, setSecret } from './agent/keystore'
import { registerTrustIpc } from './agent/trustIpc'
import type { Agent } from './agent/agent'
import { ai } from './ai/gateway'
import { makePusher, ModelsService } from './ai/modelsFeed'
import { admitProvider, updateAdmitted } from './brain/roleEval'
import { getSecret } from './agent/keystore'
import { audit } from './ai/guard/audit'
import { memory } from './brain/memory'
import { promptsAction } from './brain/prompt'
import { findCli } from './brain/cli'
import { getLyrics, setLyricsOffset } from './lyrics'
import { settings } from './settings'
import { registerGraphIpc } from './agent/graph'

/** The platform-neutral IPC handlers (voice, brain, memory, lyrics, trust): shared by the Windows main process and the Android in-page core.
 *  Anything that touches windows, hotkeys or the sidecar stays with the caller. `broadcast` sends to every window / the page. */
export function registerCoreIpc(agent: Agent, broadcast: (channel: string, ...args: unknown[]) => void) {
  ipcMain.handle('lokey:settings:get', () => settings.value)
  ipcMain.handle('lokey:agents:list', () => agent.tasks.list())
  ipcMain.handle('lokey:agents:interrupted', () => agent.tasks.interrupted().map(r => ({ id: r.id, goal: r.goal, role: r.role, at: r.updated })))
  ipcMain.handle('lokey:agents:resume', (_e, id: string) => agent.tasks.resume(String(id)))
  ipcMain.handle('lokey:agents:discard', (_e, id: string) => { agent.tasks.discard(String(id)) })
  ipcMain.on('lokey:agents:stop', (_e, id: string) => { if (id === 'all') agent.stopAll(); else agent.tasks.stop(String(id)) })
  ipcMain.handle('lokey:brain:usage', () => ai.getUsage())
  ipcMain.handle('lokey:brain:status', () => ai.status())
  ipcMain.handle('lokey:brain:audit', () => audit.verify())
  ipcMain.handle('lokey:brain:traces', (_e, f: { role?: string; provider?: string; failed?: boolean; limit?: number } | undefined) => ai.traces({ role: f?.role ? String(f.role) : undefined, provider: f?.provider ? String(f.provider) : undefined, failed: f?.failed === true, limit: Number(f?.limit) || 100 }))
  ipcMain.handle('lokey:brain:test', async (_e, id: string) => {
    const r = await ai.test(String(id))
    const c = settings.value.brain.providers.find(p => p.id === String(id))
    if (!r.ok || !c) return r
    // the eval set decides whether this model may serve the main and screen roles
    const admission = await admitProvider(c, getSecret)
    settings.set({ brain: { admitted: updateAdmitted(settings.value.brain.admitted ?? [], c, admission) } })
    return { ...r, admission }
  })
  // Settings > Models: the status feed (pushed on change, at most twice a second) and its commands (docs/AI-FAILSAFE.md section 6)
  const models = new ModelsService({
    gw: ai, cfg: () => settings.value.brain.providers, setProviders: providers => { settings.set({ brain: { providers } }) },
    getSecret, setSecret, clearSecret,
    preset: () => settings.value.brain.preset, offlineLocal: () => settings.value.brain.offlineLocal,
    setPreset: preset => { settings.set({ brain: { preset } }) }, setOfflineLocal: offlineLocal => { settings.set({ brain: { offlineLocal } }) },
    voice: () => agent.voiceStatus(),
  })
  const pushModels = makePusher(s => broadcast('lokey:models:status', s), () => models.status())
  ai.onChange(pushModels); ai.onOffline(pushModels); settings.on('changed', pushModels); agent.on('vstate', pushModels)
  ipcMain.handle('lokey:models:status', () => models.status())
  ipcMain.handle('lokey:models:addKey', (_e, a: { family: 'gemini' | 'openrouter' | 'other' | 'ollama'; key: string; baseUrl?: string }) => models.addKey({ family: a?.family, key: String(a?.key ?? ''), baseUrl: a?.baseUrl ? String(a.baseUrl) : undefined }))
  ipcMain.handle('lokey:models:removeKey', (_e, ref: string) => models.removeKey(String(ref ?? '')))
  ipcMain.handle('lokey:models:test', (_e, target: string) => models.test(String(target ?? '')))
  ipcMain.handle('lokey:models:setPreset', (_e, p: 'quality' | 'fast' | 'save') => models.setPreset(p))
  ipcMain.handle('lokey:models:setOfflineLocal', (_e, on: boolean) => models.setOfflineLocal(on === true))
  ipcMain.handle('lokey:brain:hasSecret', (_e, ref: string) => hasSecret(String(ref)))
  ipcMain.handle('lokey:brain:setSecret', (_e, ref: string, value: string) => setSecret(String(ref), String(value ?? '')))
  ipcMain.handle('lokey:brain:clearSecret', (_e, ref: string) => { clearSecret(String(ref)) })
  ipcMain.on('lokey:brain:prompts', (_e, action: string) => promptsAction(action === 'reset' ? 'reset' : 'open'))
  ipcMain.handle('lokey:brain:cli', async () => ({ claude: !!(await findCli('claude')), codex: !!(await findCli('codex')) }))
  ipcMain.handle('lokey:lyrics:get', (_e, t: { title?: string; artist?: string; album?: string; durationMs?: number }) => getLyrics({ title: String(t?.title ?? '').slice(0, 200), artist: String(t?.artist ?? '').slice(0, 200), album: String(t?.album ?? '').slice(0, 200), durationMs: Math.max(0, Number(t?.durationMs) || 0) }))
  ipcMain.handle('lokey:lyrics:offset', (_e, key: string, ms: number) => { setLyricsOffset(String(key ?? ''), Number(ms) || 0) })
  ipcMain.handle('lokey:voice:info', () => agent.info())
  ipcMain.handle('lokey:voice:setKey', (_e, key: string) => agent.setKey(String(key ?? '')))
  ipcMain.handle('lokey:voice:clearKey', () => agent.clearKey())
  ipcMain.on('lokey:voice:say', (_e, text: string) => { void agent.say(String(text ?? '')) })
  ipcMain.on('lokey:voice:hold', (_e, on: boolean) => { if (on) void agent.begin('assistant'); else void agent.end() })
  ipcMain.on('lokey:voice:convo', () => agent.toggleConversation())
  ipcMain.handle('lokey:voice:clearConversation', () => { conversation.clear() })
  ipcMain.handle('lokey:voice:memory', () => memory.list().map(f => f.text))
  ipcMain.handle('lokey:voice:actions', () => readActions(120))
  ipcMain.handle('lokey:voice:clearActions', () => clearActions())
  registerTrustIpc(agent)
  registerGraphIpc(agent, broadcast)
  ipcMain.handle('lokey:voice:mcpStatus', () => agent.hub.status())
  ipcMain.handle('lokey:voice:forget', (_e, fact: string) => { memory.forget(String(fact ?? '')); return memory.list().map(f => f.text) })
  const memChanged = () => broadcast('lokey:memory:changed')
  ipcMain.handle('lokey:memory:list', () => memory.list())
  ipcMain.handle('lokey:memory:search', (_e, q: string) => memory.recall(String(q ?? ''), 12))
  ipcMain.handle('lokey:memory:graph', () => memory.graph())
  ipcMain.handle('lokey:memory:lessons', () => memory.lessons())
  ipcMain.handle('lokey:memory:journal', () => memory.journal())
  ipcMain.handle('lokey:memory:stats', () => memory.stats())
  ipcMain.handle('lokey:memory:add', async (_e, t: string) => { const r = await memory.add(String(t ?? ''), { source: 'manual', importance: 0.75 }); memChanged(); return !!r })
  ipcMain.handle('lokey:memory:edit', async (_e, id: string, t: string) => { const r = await memory.edit(String(id), String(t ?? '')); memChanged(); return r })
  ipcMain.handle('lokey:memory:remove', (_e, id: string) => { memory.remove(String(id)); memChanged() })
  ipcMain.handle('lokey:memory:pin', (_e, id: string, on: boolean) => { memory.pin(String(id), on === true); memChanged() })
  ipcMain.handle('lokey:memory:export', () => memory.exportJson())
  ipcMain.handle('lokey:memory:quarantine', () => memory.quarantine())
  ipcMain.handle('lokey:memory:approve', (_e, id: string) => { const r = memory.approve(String(id)); memChanged(); return r })
  ipcMain.handle('lokey:memory:reject', (_e, id: string) => { const r = memory.reject(String(id)); memChanged(); return r })
  ipcMain.handle('lokey:memory:core', () => ({ text: memory.core(), proposals: memory.proposals() }))
  ipcMain.handle('lokey:memory:setCore', (_e, t: string) => { memory.setCore(String(t ?? '')); memChanged() })
  ipcMain.handle('lokey:memory:proposal', (_e, id: string, ok: boolean) => { if (ok === true) memory.approveProposal(String(id)); else memory.rejectProposal(String(id)); memChanged() })
  ipcMain.handle('lokey:memory:clear', () => { memory.clear(); memChanged() })
  ipcMain.handle('lokey:voice:cancelTask', (_e, id: string) => agent.scheduler.cancel(String(id)))
  ipcMain.handle('lokey:voice:runTaskNow', (_e, id: string) => agent.scheduler.runNow(String(id)))
}
