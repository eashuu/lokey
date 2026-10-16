import { BrowserWindow, ipcMain, screen } from 'electron'
import { effectWindow } from '../effects'

// Transient click-through windows for the voice features (caption bar, dictation bubble, lasso canvas). Each is created
// when first needed, gets messages only after its page said it is ready, and is destroyed shortly after it clears.

/** where the overlays write a line to main.log (set by the main process) */
export const overlayLog: { fn: (m: string) => void } = { fn: () => undefined }
/** a page that does not report ready within this long is destroyed and opened once more */
export const READY_TIMEOUT_MS = 3000
/** the longest a caption stays after its last message when nobody clears it, by kind (a 'hold' message, like the "Lokey is controlling" line, is repeated by its owner while it is true) */
export const LIFETIME_MS = { said: 15_000, reply: 15_000, notice: 6000, error: 10_000, hold: 60_000, clear: 4000 } as const
export interface OverlayTestHooks { make?: (name: string, b: Electron.Rectangle) => BrowserWindow; set?: (fn: () => void, ms: number) => unknown; clear?: (h: unknown) => void }

export class Overlay {
  private win: BrowserWindow | null = null
  private ready = false
  private queue: unknown[] = []
  private kill: unknown = null
  private readyTimer: unknown = null
  private tries = 0
  private clickable = false

  /** `managed`: every message has a lifetime (the caption bar); the window closes by itself when nobody clears it */
  constructor(private name: 'caption' | 'dictation' | 'lasso', private bounds: () => Electron.Rectangle, private focusableLevel: 'floating' | 'screen-saver' = 'floating', private managed = false, private t: OverlayTestHooks = {}) {
    ipcMain.on('lokey:ov:ready', (e, ch: string) => {
      if (ch !== this.name || !this.win || this.win.isDestroyed() || e.sender !== this.win.webContents) return
      this.ready = true; this.tries = 0
      this.stopReadyTimer()
      for (const m of this.queue.splice(0)) this.win.webContents.send(`lokey:ov:${this.name}`, m)
      if (!this.win.isVisible()) this.win.showInactive()
    })
  }

  private set(fn: () => void, ms: number) { const h = this.t.set ? this.t.set(fn, ms) : setTimeout(fn, ms); (h as { unref?: () => void })?.unref?.(); return h }
  private unset(h: unknown) { if (h == null) return; if (this.t.clear) this.t.clear(h); else clearTimeout(h as ReturnType<typeof setTimeout>) }
  private stopReadyTimer() { this.unset(this.readyTimer); this.readyTimer = null }

  /** the page never said it was ready (a render error, a bad route, a preload failure): destroy it and try once more, then give up with a line in main.log */
  private notReady() {
    this.readyTimer = null
    if (this.ready) return
    const pending = this.queue.splice(0)
    overlayLog.fn(`${this.name} overlay not ready after ${READY_TIMEOUT_MS} ms${this.tries ? ' (second try)' : ''}`)
    this.close()
    if (this.tries++ < 1) for (const m of pending) this.send(m)
    else this.tries = 0
  }

  send(msg: unknown) {
    if (this.kill) { this.unset(this.kill); this.kill = null }
    if (!this.win || this.win.isDestroyed()) {
      const w = (this.win = this.t.make ? this.t.make(this.name, this.bounds()) : effectWindow(this.name, this.bounds()))
      if (this.focusableLevel === 'screen-saver') w.setAlwaysOnTop(true, 'screen-saver')
      w.setIgnoreMouseEvents(!this.clickable)
      this.ready = false
      w.on('closed', () => { if (this.win === w) { this.win = null; this.ready = false } })
      this.stopReadyTimer()
      this.readyTimer = this.set(() => this.notReady(), READY_TIMEOUT_MS)
    }
    if (this.managed) {
      const m = msg as { kind?: string; tone?: string }
      const life = m.kind === 'hold' ? LIFETIME_MS.hold : m.kind === 'clear' ? LIFETIME_MS.clear : m.kind === 'notice' ? (m.tone === 'error' ? LIFETIME_MS.error : LIFETIME_MS.notice) : LIFETIME_MS.said
      this.kill = this.set(() => this.close(), life)
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
    this.unset(this.kill)
    this.kill = this.set(() => this.close(), ms)
  }

  /** is a window open (tests, and the caption bar's "is anything on screen")? */
  get isOpen() { return !!this.win && !this.win.isDestroyed() }

  close() {
    this.unset(this.kill)
    this.kill = null
    this.stopReadyTimer()
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
}, 'floating', true)

/** Dictation: small window around the focused field (bubble above, bar at its bottom edge). */
export const dictationBar = new Overlay('dictation', () => {
  const d = screen.getPrimaryDisplay().bounds
  return { x: d.x, y: d.y, width: d.width, height: d.height }
})

/** Lasso: the whole primary display, transparent, draws the stroke. */
export const lassoCanvas = new Overlay('lasso', () => screen.getPrimaryDisplay().bounds)
