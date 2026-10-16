import { ipcMain } from 'electron'
import type { Agent } from './agent'
import { trust } from './trust'
import { undoList } from './undo'
import { openLoops, setPromise } from '../brain/memory/promises'
import { book, startWatching, stopWatching, watcher } from './watch'

/** Settings > Permissions (trust rules), Desk Undo and Desk Open loops */
export function registerTrustIpc(agent: Agent) {
  ipcMain.handle('lokey:trust:rules', () => trust.rules())
  ipcMain.handle('lokey:trust:revoke', (_e, sig: string) => { trust.revoke(String(sig)) })
  ipcMain.handle('lokey:undo:list', () => undoList().map(u => ({ id: u.id, at: u.at, summary: u.summary })))
  ipcMain.handle('lokey:undo:run', async (_e, id: string) => (await agent.runUndo(String(id))).say ?? 'Done.')
  ipcMain.handle('lokey:loops:list', () => openLoops().map(p => ({ id: p.id, what: p.what, who: p.who, due: p.due })))
  ipcMain.handle('lokey:routines:list', () => book.list().map(r => ({ id: r.id, name: r.name, steps: r.steps.map(s => ({ app: s.args.name ?? Object.values(s.args)[0] ?? '', label: s.label })), runs: r.runs, approved: book.approved(r) })))
  ipcMain.handle('lokey:routines:save', (_e, id: string, patch: { name?: string; steps?: { app: string; label?: string }[] }) => book.update(String(id), { name: patch?.name, steps: Array.isArray(patch?.steps) ? patch.steps.map(s => ({ tool: 'open_app', args: { name: String(s.app ?? '') }, label: String(s.label ?? '') || `Open ${String(s.app ?? '')}` })) : undefined }))
  ipcMain.handle('lokey:routines:delete', (_e, id: string) => book.remove(String(id)))
  ipcMain.handle('lokey:watch:status', () => ({ active: watcher.active, name: watcher.active ? watcher.name : undefined, steps: watcher.steps.length }))
  ipcMain.handle('lokey:watch:start', (_e, name: string) => { if (!watcher.active) startWatching(String(name ?? '')); return true })
  ipcMain.handle('lokey:watch:stop', () => stopWatching()?.id ?? null)
  ipcMain.handle('lokey:loops:set', (_e, id: string, action: 'done' | 'drop' | 'snooze') => setPromise(String(id), action))
}
