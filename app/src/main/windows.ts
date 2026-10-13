import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'node:path'

let settingsWin: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null

function load(win: BrowserWindow, hash: string) {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void win.loadURL(`${dev}#${hash}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

/** Normal, focusable Mica window for settings. Created on demand, destroyed on close (no idle cost). */
export function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return }
  settingsWin = new BrowserWindow({
    width: 880,
    height: 640,
    minWidth: 720,
    minHeight: 520,
    title: 'lokey settings',
    backgroundMaterial: 'mica',
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#cccccc', height: 40 },
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, devTools: !app.isPackaged },
  })
  settingsWin.setMenu(null)
  load(settingsWin, 'settings')
  settingsWin.on('closed', () => { settingsWin = null })
}

export function createTray(handlers: { toggleIsland: () => void; quit: () => void }) {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'tray.png'))
  const tray = new Tray(icon)
  tray.setToolTip('lokey')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Toggle island', click: handlers.toggleIsland },
    { label: 'Open lokey', click: () => openMain() },
    { label: 'Settings', click: openSettings },
    { type: 'separator' },
    { label: 'Quit', click: handlers.quit },
  ]))
  tray.on('click', handlers.toggleIsland)
  return tray
}

/** The main app window (Home / Bond / Soul / Desk / Settings). Single instance; created on demand, destroyed on close. */
export function openMain(page?: string) {
  const hash = `main?page=${encodeURIComponent(page ?? 'soul')}`
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show(); mainWin.focus()
    if (page) void mainWin.webContents.executeJavaScript(`location.hash=${JSON.stringify('#' + hash)}`)
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
