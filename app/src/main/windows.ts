import { BrowserWindow, Menu, Tray, app, nativeImage, screen } from 'electron'
import { join } from 'node:path'
import { settings } from './settings'

let mainWin: BrowserWindow | null = null

function load(win: BrowserWindow, hash: string) {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void win.loadURL(`${dev}#${hash}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

/** Settings live inside the one main window (its Settings page); there is no separate settings window any more. */
export function openSettings(section?: string) { openMain('settings', section) }

export function createTray(handlers: { toggleIsland: () => void; quit: () => void; conversation?: () => void; moveIsland?: () => void; stopAll?: () => void; wake?: { enabled: () => boolean; toggle: () => void } }) {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'tray.png'))
  const tray = new Tray(icon)
  const build = () => Menu.buildFromTemplate([
    { label: 'Toggle island', click: handlers.toggleIsland },
    { label: 'Open lokey', click: () => openMain() },
    ...(handlers.conversation ? [{ label: 'Start / stop conversation', click: handlers.conversation }] : []),
    ...(handlers.wake ? [{ label: 'Wake-up listening (claps, "hey lokey")', type: 'checkbox' as const, checked: handlers.wake.enabled(), click: handlers.wake.toggle }] : []),
    ...(handlers.stopAll ? [{ label: 'Stop all agents', click: handlers.stopAll }] : []),
    { label: 'Lyrics window', click: () => toggleLyrics() },
    ...(handlers.moveIsland ? [{ label: 'Move island…', click: handlers.moveIsland }] : []),
    { label: 'Settings', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Quit', click: handlers.quit },
  ])
  const refresh = () => { tray.setContextMenu(build()); tray.setToolTip(handlers.wake?.enabled() ? 'lokey · listening for wake-up' : 'lokey') }
  refresh()
  tray.on('click', handlers.toggleIsland)
  return { tray, refresh }
}

/** The one app window (Home / Bond / Soul / Desk / Settings). Created on demand, destroyed on close; an open window is navigated by message. */
export function openMain(page?: string, section?: string) {
  const q = new URLSearchParams({ page: page ?? 'soul', ...(section ? { section } : {}) })
  const hash = `main?${q.toString()}`
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show(); mainWin.focus()
    if (page) mainWin.webContents.send('lokey:nav', { page, section })
    return
  }
  mainWin = new BrowserWindow({
    width: 940,
    height: 640,
    minWidth: 760,
    minHeight: 540,
    title: 'lokey',
    backgroundMaterial: 'mica',
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#e6e8ee', height: 44 },
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, devTools: !app.isPackaged },
  })
  mainWin.setMenu(null)
  load(mainWin, hash)
  mainWin.on('closed', () => { mainWin = null })
}

// ---- the lyrics window --------------------------------------------------------------------------------------
// A normal window that stays until it is closed: remembers its place and size, can float above other windows.
let lyricsWin: BrowserWindow | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function openLyrics() {
  if (lyricsWin && !lyricsWin.isDestroyed()) {
    if (lyricsWin.isMinimized()) lyricsWin.restore()
    lyricsWin.show(); lyricsWin.focus()
    return
  }
  const s = settings.value.lyricsWin
  const wa = screen.getPrimaryDisplay().workArea
  const w = Math.max(320, Math.min(wa.width, s.w)), h = Math.max(360, Math.min(wa.height, s.h))
  const x = Math.max(wa.x, Math.min(wa.x + wa.width - w, s.x ?? wa.x + wa.width - w - 28))
  const y = Math.max(wa.y, Math.min(wa.y + wa.height - h, s.y ?? wa.y + Math.round((wa.height - h) / 2)))
  const win = (lyricsWin = new BrowserWindow({
    x, y, width: w, height: h, minWidth: 320, minHeight: 360, frame: false, backgroundColor: '#0b0b10', show: false, title: 'lokey lyrics',
    alwaysOnTop: s.pinned, icon: join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, devTools: !app.isPackaged },
  }))
  win.setMenu(null)
  if (s.pinned) win.setAlwaysOnTop(true, 'floating')
  load(win, 'lyrics')
  win.once('ready-to-show', () => win.show())
  const remember = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isMinimized() || win.isMaximized()) return
      const b = win.getBounds()
      settings.set({ lyricsWin: { x: b.x, y: b.y, w: b.width, h: b.height } })
    }, 500)
  }
  win.on('resize', remember); win.on('move', remember)
  win.on('closed', () => { if (saveTimer) clearTimeout(saveTimer); if (lyricsWin === win) lyricsWin = null })
}

export function toggleLyrics() { if (lyricsWin && !lyricsWin.isDestroyed()) lyricsWin.close(); else openLyrics() }
export function closeLyrics() { if (lyricsWin && !lyricsWin.isDestroyed()) lyricsWin.close() }
export function pinLyrics(on: boolean) {
  if (lyricsWin && !lyricsWin.isDestroyed()) lyricsWin.setAlwaysOnTop(on, 'floating')
  settings.set({ lyricsWin: { pinned: on } })
}
