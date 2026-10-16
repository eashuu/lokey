import { BrowserWindow, ipcMain, screen } from 'electron'
import type { AskState } from '@shared/ask'
import { settings } from '../settings'
import { answerLocal, currentAskState, islandGone, setIslandRoute } from './permissions'

// Requests for the person, drawn inside the island instead of a separate window. This file is only the transport: permissions.ts keeps the
// queue, the timer and the answer; the island page draws what it is sent and reports (id, ok). Nothing here focuses a window.
//
// When the island cannot be trusted to show a card (disabled, hidden for a full-screen app, not loaded, crashed, the screens changed so it
// sits outside every display, or the page does not confirm within 1.5 s) usable() or shown() says so and permissions.ts opens the old window.

type Lite = { webContents: { send(ch: string, ...a: unknown[]): void; isLoading(): boolean; isCrashed?(): boolean; id: number }; isDestroyed(): boolean; isVisible(): boolean; getBounds(): { x: number; y: number; width: number; height: number } }

/** pure: does a window rectangle still lie on some display? (a removed or rearranged monitor leaves the island floating in nowhere) */
export function onSomeDisplay(b: { x: number; y: number; width: number; height: number }, displays: { x: number; y: number; width: number; height: number }[]): boolean {
  const cx = b.x + b.width / 2, cy = b.y + Math.min(b.height / 2, 40)
  return displays.some(d => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height)
}

export function wireAskIsland(o: { overlay: () => BrowserWindow | null; hidden: () => boolean }) {
  const acks = new Map<string, () => void>()
  const win = () => { const w = o.overlay(); return w && !w.isDestroyed() ? w : null }
  const fromOverlay = (e: Electron.IpcMainEvent) => { const w = win(); return !!w && e.sender === w.webContents }

  ipcMain.on('lokey:ask:ready', e => { if (fromOverlay(e)) e.sender.send('lokey:ask:state', currentAskState()) })
  ipcMain.on('lokey:ask:shown', (e, id: string) => { if (fromOverlay(e)) acks.get(String(id))?.() })
  // only the island page itself may answer, and only with a real boolean
  ipcMain.on('lokey:ask:answer', (e, id: string, ok: unknown) => { if (fromOverlay(e) && typeof ok === 'boolean') answerLocal(String(id), ok) })

  setIslandRoute({
    usable() {
      const w = win() as Lite | null
      if (!w || !settings.value.island.enabled || o.hidden()) return false
      if (!w.isVisible() || w.webContents.isLoading() || w.webContents.isCrashed?.()) return false
      return onSomeDisplay(w.getBounds(), screen.getAllDisplays().map(d => d.bounds))
    },
    push(s: AskState) { win()?.webContents.send('lokey:ask:state', s) },
    shown(id, ms) {
      return new Promise<boolean>(resolve => {
        const t = setTimeout(() => { acks.delete(id); resolve(false) }, ms)
        acks.set(id, () => { clearTimeout(t); acks.delete(id); resolve(true) })
      })
    },
  })

  // the page went away while a card was on it: deny, and let permissions.ts show nothing stale
  const watch = () => {
    const w = win()
    if (!w) return
    w.webContents.on('render-process-gone', () => islandGone())
    w.webContents.on('did-start-loading', () => islandGone())
    w.on('closed', () => islandGone())
  }
  watch()
}
