import { BrowserWindow, app, ipcMain, session } from 'electron'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'

// The microphone and the speaker live in a hidden page (#agent): getUserMedia + Web Audio need a renderer. Created
// on first use, destroyed after IDLE_MS without use so it costs nothing in normal life. Audio crosses IPC as raw PCM16.
const IDLE_MS = 6 * 3_600_000

export interface AgentAudio {
  on(e: 'mic', f: (pcm16k: Buffer) => void): this
  on(e: 'level', f: (kind: 'mic' | 'out', v: number) => void): this
  on(e: 'drained', f: () => void): this
  on(e: 'fail', f: (m: string) => void): this
}

export class AgentAudio extends EventEmitter {
  private win: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private idle: ReturnType<typeof setTimeout> | null = null
  private micOn = false

  constructor() {
    super()
    ipcMain.on('lokey:agent:mic', (e, b: ArrayBuffer) => { if (this.own(e)) this.emit('mic', Buffer.from(b)) })
    ipcMain.on('lokey:agent:level', (e, kind: 'mic' | 'out', v: number) => {
      if (!this.own(e)) return
      if (kind === 'out' && v < 0) this.emit('drained')
      else this.emit('level', kind, v)
    })
    ipcMain.on('lokey:agent:fail', (e, m: string) => { if (this.own(e)) this.emit('fail', m) })
  }

  private own(e: Electron.IpcMainEvent) { return !!this.win && !this.win.isDestroyed() && e.sender === this.win.webContents }

  private touch() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => { if (!this.micOn) this.destroy() }, IDLE_MS)
    this.idle.unref?.()
  }

  private permitted = false
  private permit() {
    if (this.permitted) return
    this.permitted = true
    // only our own hidden page may open the microphone
    const allow = (wcId: number | undefined) => !!this.win && !this.win.isDestroyed() && this.win.webContents.id === wcId
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' && allow(wc?.id)))
    session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media' && allow(wc?.id))
  }

  async ensure(): Promise<void> {
    this.permit()
    this.touch()
    if (this.win && !this.win.isDestroyed() && this.ready) return this.ready
    const win = (this.win = new BrowserWindow({
      show: false, width: 200, height: 100, frame: false, focusable: false, skipTaskbar: true,
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', devTools: !app.isPackaged },
    }))
    win.on('closed', () => { if (this.win === win) { this.win = null; this.ready = null; this.micOn = false } })
    this.ready = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('audio page did not start')), 8000)
      const on = (e: Electron.IpcMainEvent) => { if (e.sender === win.webContents) { clearTimeout(t); ipcMain.off('lokey:agent:ready', on); resolve() } }
      ipcMain.on('lokey:agent:ready', on)
    })
    const dev = process.env.ELECTRON_RENDERER_URL
    if (dev) void win.loadURL(`${dev}#agent`)
    else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'agent' })
    return this.ready
  }

  private cmd(c: unknown) { if (this.win && !this.win.isDestroyed()) this.win.webContents.send('lokey:agent:cmd', c) }

  /** `hard` releases the device at once; otherwise the page keeps it warm for a few seconds for the next press */
  private micSeq = 0
  async mic(on: boolean, hard = false) {
    const seq = ++this.micSeq
    if (on) { await this.ensure(); if (seq !== this.micSeq) return } // a mic(false) came while the page was starting: the late "on" is dropped
    this.micOn = on
    this.cmd({ cmd: 'mic', on, hard })
    this.touch()
  }

  /** create the hidden page ahead of the first press so it costs no start-up time then */
  warm() { return this.ensure().catch(() => undefined) }

  async play(pcm24k: Buffer) {
    await this.ensure()
    this.cmd({ cmd: 'play', data: pcm24k })
    this.touch()
  }

  /** speak a sentence with the system voice (the page's speechSynthesis); `drained` fires when it ends, like for Live audio */
  async say(text: string, lang = '') {
    await this.ensure()
    this.cmd({ cmd: 'say', text, lang })
    this.touch()
  }

  flush() { this.cmd({ cmd: 'flush' }) }

  destroy() {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    const w = this.win
    this.win = null
    this.ready = null
    this.micOn = false
    if (w && !w.isDestroyed()) w.destroy()
  }
}
