import { BrowserWindow, app, ipcMain, nativeImage, screen } from 'electron'
import { join } from 'node:path'
import type { GlowState } from '@shared/bridge'
import type { Sidecar } from './sidecar'
import { settings } from './settings'

// Whole-screen effects drawn by transient, click-through, never-focused windows ('floating' level: below the island's
// 'screen-saver'). Nothing stays allocated while idle.
let sidecar: Sidecar | null = null
export function initEffects(s: Sidecar) { sidecar = s }

export function effectWindow(hash: string, bounds: Electron.Rectangle) {
  const win = new BrowserWindow({
    ...bounds,
    transparent: true, frame: false, focusable: false, skipTaskbar: true, hasShadow: false, show: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false, devTools: !app.isPackaged },
  })
  win.setAlwaysOnTop(true, 'floating')
  win.setIgnoreMouseEvents(true) // no `forward`: that installs a system-wide mouse hook
  win.setMenu(null)
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void win.loadURL(`${dev}#${hash}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  return win
}

// ---- wallpaper circle reveal -------------------------------------------------------------------------------------
export async function revealWallpaper(path: string, x: number, y: number): Promise<void> {
  const apply = () => (sidecar ? sidecar.call('wallpaper.set', { path }).then(() => undefined, () => undefined) : Promise.resolve())
  const a = settings.value.appearance
  if (a.reduceMotion || !(a.animSpeed > 0) || !sidecar) return apply()

  const d = screen.getPrimaryDisplay()
  const { x: bx, y: by, width: w, height: h } = d.bounds
  const ms = 1000 / Math.min(2, a.animSpeed)
  let applied: Promise<void> | null = null
  const applyOnce = () => (applied ??= apply())

  let win: BrowserWindow | null = null
  const closed = new Promise<void>(resolve => {
    let over = false
    const timers: NodeJS.Timeout[] = []
    const onMsg = (ch: string, fn: () => void) => {
      const h2 = (e: Electron.IpcMainEvent) => { if (win && !win.isDestroyed() && e.sender === win.webContents) fn() }
      ipcMain.on(ch, h2)
      return () => ipcMain.off(ch, h2)
    }
    const offs: (() => void)[] = []
    const finish = () => {
      if (over) return
      over = true
      timers.forEach(clearTimeout)
      offs.forEach(f => f())
      void applyOnce()
      if (win && !win.isDestroyed()) win.destroy()
      resolve()
    }
    timers.push(setTimeout(finish, 3000)) // hard cap: never leave a full-screen window open
    try {
      win = effectWindow('reveal', d.bounds)
      const img = nativeImage.createFromPath(path)
      if (img.isEmpty()) return finish()
      const px = Math.min(2560, Math.round(w * d.scaleFactor))
      const src = `data:image/jpeg;base64,${(img.getSize().width > px ? img.resize({ width: px, quality: 'good' }) : img).toJPEG(88).toString('base64')}`
      win.on('closed', finish)
      win.webContents.on('render-process-gone', finish)
      offs.push(onMsg('lokey:reveal:ready', () => {
        win?.showInactive()
        timers.push(setTimeout(() => void applyOnce(), ms * 0.85)) // when the circle has (almost) covered the screen
      }))
      offs.push(onMsg('lokey:reveal:done', finish))
      win.webContents.once('did-finish-load', () => win?.webContents.send('lokey:reveal:start', { src, x: x - bx, y: y - by, w, h, ms }))
    } catch { finish() }
  })
  await closed
  await applyOnce()
}

// ---- screen-edge glow ------------------------------------------------------------------------------------------------
let glowWin: BrowserWindow | null = null
let glowState: GlowState = 'off'
let suppressed = false
let glowKill: NodeJS.Timeout | null = null

function destroyGlow() {
  if (glowKill) clearTimeout(glowKill)
  glowKill = null
  if (glowWin && !glowWin.isDestroyed()) glowWin.destroy()
  glowWin = null
}

export function setGlow(state: GlowState) {
  if (state !== 'off' && state !== 'thinking' && state !== 'speaking' && state !== 'research') return
  glowState = state
  if (glowKill) { clearTimeout(glowKill); glowKill = null }
  if (state === 'off') {
    if (!glowWin || glowWin.isDestroyed()) return
    glowWin.webContents.send('lokey:glow:state', 'off')
    glowKill = setTimeout(destroyGlow, 650) // 450 ms fade-out in the page
    return
  }
  if (suppressed) return
  if (!glowWin || glowWin.isDestroyed()) {
    const w = (glowWin = effectWindow('glow', screen.getPrimaryDisplay().bounds))
    w.once('ready-to-show', () => { if (!suppressed && glowState !== 'off') w.showInactive() })
    w.on('closed', () => { if (glowWin === w) glowWin = null })
    w.webContents.once('did-finish-load', () => { if (!w.isDestroyed()) w.webContents.send('lokey:glow:state', glowState) })
  } else {
    glowWin.webContents.send('lokey:glow:state', state)
  }
}

/** a screenshot of the edge glow window as it is now (null when it is not showing); used by --demo */
export async function glowCapture() { return glowWin && !glowWin.isDestroyed() && glowWin.isVisible() ? glowWin.webContents.capturePage() : null }

/** While a real fullscreen app is active the glow is torn down (and restored when it ends). */
export function setGlowSuppressed(on: boolean) {
  suppressed = on
  if (on) destroyGlow()
  else if (glowState !== 'off') setGlow(glowState)
}
