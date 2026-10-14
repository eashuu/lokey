import { ipcMain } from 'electron'
import type { Agent } from './agent'
import { trust } from './trust'
import { undoList } from './undo'
import { openLoops, setPromise } from '../brain/memory/promises'

/** Settings > Permissions (trust rules), Desk Undo and Desk Open loops */
export function registerTrustIpc(agent: Agent) {
  ipcMain.handle('lokey:trust:rules', () => trust.rules())
  ipcMain.handle('lokey:trust:revoke', (_e, sig: string) => { trust.revoke(String(sig)) })
  ipcMain.handle('lokey:undo:list', () => undoList().map(u => ({ id: u.id, at: u.at, summary: u.summary })))
  ipcMain.handle('lokey:undo:run', async (_e, id: string) => (await agent.runUndo(String(id))).say ?? 'Done.')
  ipcMain.handle('lokey:loops:list', () => openLoops().map(p => ({ id: p.id, what: p.what, who: p.who, due: p.due })))
  ipcMain.handle('lokey:loops:set', (_e, id: string, action: 'done' | 'drop' | 'snooze') => setPromise(String(id), action))
}
