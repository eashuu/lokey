import { BrowserWindow, ipcMain, screen } from 'electron'
import { effectWindow } from '../effects'

// Transient click-through windows for the voice features (caption bar, dictation bubble, lasso canvas). Each is created
// when first needed, gets messages only after its page said it is ready, and is destroyed shortly after it clears.

class Overlay {
  private win: BrowserWindow | null = null
  private ready = false
  private queue: unknown[] = []
  private kill: ReturnType<typeof setTimeout> | null = null
  private clickable = false

  constructor(private name: 'caption' | 'dictation' | 'lasso', private bounds: () => Electron.Rectangle, private focusableLevel: 'floating' | 'screen-saver' = 'floating') {
    ipcMain.on('lokey:ov:ready', (e, ch: string) => {
      if (ch !== this.name || !this.win || this.win.isDestroyed() || e.sender !== this.win.webContents) return
      this.ready = true
      for (const m of this.queue.splice(0)) this.win.webContents.send(`lokey:ov:${this.name}`, m)
      if (!this.win.isVisible()) this.win.showInactive()
    })
  }

  send(msg: unknown) {
    if (this.kill) { clearTimeout(this.kill); this.kill = null }
    if (!this.win || this.win.isDestroyed()) {
      const w = (this.win = effectWindow(this.name, this.bounds()))
      if (this.focusableLevel === 'screen-saver') w.setAlwaysOnTop(true, 'screen-saver')
      w.setIgnoreMouseEvents(!this.clickable)
      this.ready = false
      w.on('closed', () => { if (this.win === w) { this.win = null; this.ready = false } })
    }
    if (this.ready) {
      if (!this.win.isVisible()) this.win.showInactive() // a kept-alive window that was hidden between uses
      this.win.webContents.send(`lokey:ov:${this.name}`, msg)
    } else this.queue.push(msg)
  }

  /** let the window receive the mouse (lasso drawing). It still never takes keyboard focus. */
  interactive(on: boolean) {
    this.clickable = on
    if (this.win && !this.win.isDestroyed()) this.win.setIgnoreMouseEvents(!on)
  }

  /** is this webContents our page (only it may report strokes) */
  owns(wc: Electron.WebContents) { return !!this.win && !this.win.isDestroyed() && this.win.webContents === wc }

  /** a screenshot of the window as it is now (null when closed); used by --demo */
  async capture() { return this.win && !this.win.isDestroyed() && this.ready ? this.win.webContents.capturePage() : null }

  /** move/resize an open window (dictation follows the focused field) */
  place(r: Electron.Rectangle) { if (this.win && !this.win.isDestroyed()) this.win.setBounds(r) }

  /** close after `ms` (the page fades itself out meanwhile) */
  closeSoon(ms: number) {
    if (this.kill) clearTimeout(this.kill)
    this.kill = setTimeout(() => this.close(), ms)
    this.kill.unref?.()
  }

  close() {
    if (this.kill) clearTimeout(this.kill)
    this.kill = null
    this.queue = []
    this.ready = false
    const w = this.win
    this.win = null
    if (w && !w.isDestroyed()) w.destroy()
  }
}

/** Bottom-centre speech pills ("YOU ..." / "LOKEY ..."), like the reference demo. */
export const captionBar = new Overlay('caption', () => {
  const wa = screen.getPrimaryDisplay().workArea
  const w = Math.min(860, wa.width), h = 210 // room above/below the pill for its shadow to fade out inside the window
  return { x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + wa.height - h + 6, width: w, height: h }
})

/** Dictation: small window around the focused field (bubble above, bar at its bottom edge). */
export const dictationBar = new Overlay('dictation', () => {
  const d = screen.getPrimaryDisplay().bounds
  return { x: d.x, y: d.y, width: d.width, height: d.height }
})

/** Lasso: the whole primary display, transparent, draws the stroke. */
export const lassoCanvas = new Overlay('lasso', () => screen.getPrimaryDisplay().bounds)
