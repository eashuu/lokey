import { app, BrowserWindow, dialog, ipcMain, screen, shell, type Tray } from 'electron'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppEvent, Stage } from '@shared/bridge'
import type { EventName, MethodName, Methods } from '@shared/protocol'
import { Sidecar } from './sidecar'
import { dataDir, settings } from './settings'
import { createTray, openSettings } from './windows'

// ---- args -----------------------------------------------------------------------------------------
const argv = process.argv.slice(1)
const useMock = argv.includes('--mock')
const benchIdx = argv.indexOf('--bench')
const benchDir = benchIdx >= 0 ? (argv[benchIdx + 1] && !argv[benchIdx + 1].startsWith('--') ? argv[benchIdx + 1] : join(dataDir, 'bench')) : null

function log(msg: string) {
  try {
    mkdirSync(dataDir, { recursive: true })
    appendFileSync(join(dataDir, 'main.log'), `${new Date().toISOString()} ${msg}\n`)
  } catch { /* logging must never throw */ }
}
process.on('uncaughtException', e => log(`uncaught ${e.stack ?? e}`))
process.on('unhandledRejection', e => log(`unhandled ${e}`))

// ---- single instance (a second launch opens Settings in the first) --------------------------------
if (!benchDir && !app.requestSingleInstanceLock()) { app.quit() }
app.on('second-instance', () => openSettings())

// Compositor-friendly defaults for a transparent always-on-top overlay.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization')

let overlay: BrowserWindow | null = null
let tray: Tray | null = null
let stage: Stage = { width: 1200, height: 720, scale: 1, workTop: 0 }
const sidecar = new Sidecar()
sidecar.setMaxListeners(64)
const eventCounts: Record<string, number> = {}
sidecar.on('log', log)

function send(e: AppEvent) { overlay?.webContents.send('lokey:app', e) }

// ---- overlay window ---------------------------------------------------------------------------------
// One small fixed-size window pinned to the top-centre of the primary display. It never resizes (resizing a
// transparent window is the main source of jank); everything that moves is drawn inside it.
function createOverlay() {
  const d = screen.getPrimaryDisplay()
  const s = Math.min(1.5, Math.max(0.75, settings.value.appearance.scale))
  const width = Math.min(d.bounds.width, Math.round(1100 * s))
  const height = Math.min(d.bounds.height, Math.round(660 * s))
  stage = { width, height, scale: d.scaleFactor, workTop: 0 }

  overlay = new BrowserWindow({
    x: d.bounds.x + Math.round((d.bounds.width - width) / 2),
    y: d.bounds.y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      additionalArguments: useMock ? ['--lokey-mock'] : [],
    },
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setIgnoreMouseEvents(true, { forward: true })
  overlay.setMenu(null)
  overlay.on('blur', () => send({ type: 'blur' }))
  overlay.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  overlay.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { send({ type: 'close-island' }); e.preventDefault() }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void overlay.loadURL(devUrl)
  else void overlay.loadFile(join(__dirname, '../renderer/index.html'))
  overlay.once('ready-to-show', () => overlay?.showInactive())
}

// ---- IPC ----------------------------------------------------------------------------------------------
function registerIpc() {
  ipcMain.handle('lokey:call', async (_e, method: MethodName, params: Methods[MethodName][0]) => {
    await sidecar.whenReady()
    return sidecar.call(method, params)
  })
  ipcMain.on('lokey:interactive', (_e, on: boolean) => {
    if (!overlay) return
    if (on) overlay.setIgnoreMouseEvents(false)
    else overlay.setIgnoreMouseEvents(true, { forward: true })
  })
  ipcMain.on('lokey:focusable', (_e, on: boolean) => {
    if (!overlay) return
    overlay.setFocusable(on)
    if (on) overlay.focus()
  })
  ipcMain.handle('lokey:stage', () => stage)
  ipcMain.handle('lokey:settings:get', () => settings.value)
  ipcMain.handle('lokey:settings:set', (_e, patch) => settings.set(patch))
  ipcMain.on('lokey:log', (_e, m: string) => log(`renderer: ${m}`))
  ipcMain.on('lokey:quit', () => app.quit())
  ipcMain.on('lokey:external', (_e, url: string) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url) })
  ipcMain.on('lokey:openSettings', () => openSettings())
  ipcMain.handle('lokey:pickFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  settings.on('changed', s => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('lokey:settings:changed', s)
    app.setLoginItemSettings({ openAtLogin: s.startWithWindows })
  })

  // bench (renderer-driven)
  ipcMain.handle('lokey:bench:config', () => (benchDir ? { dir: benchDir } : null))
  ipcMain.handle('lokey:bench:capture', async (_e, name: string) => {
    if (!benchDir || !overlay) return
    mkdirSync(benchDir, { recursive: true })
    const img = await overlay.webContents.capturePage()
    writeFileSync(join(benchDir, `${name}.png`), img.toPNG())
  })
  ipcMain.handle('lokey:bench:metrics', () => app.getAppMetrics().map(m => ({ type: m.type, pid: m.pid, cpuTimeSec: m.cpu.cumulativeCPUUsage, cpuPct: m.cpu.percentCPUUsage })))
  ipcMain.handle('lokey:bench:finish', (_e, report) => {
    if (!benchDir) return
    mkdirSync(benchDir, { recursive: true })
    const metrics = app.getAppMetrics().map(m => ({ type: m.type, pid: m.pid, cpuPct: m.cpu.percentCPUUsage, workingSetMb: +(m.memory.workingSetSize / 1024).toFixed(1), privateMb: +((m.memory.privateBytes ?? 0) / 1024).toFixed(1) }))
    writeFileSync(join(benchDir, 'report.json'), JSON.stringify({ ...report, sidecarEvents: eventCounts, electron: process.versions.electron, metrics }, null, 2))
    setTimeout(() => app.quit(), 300)
  })
}

// ---- sidecar wiring --------------------------------------------------------------------------------------
const FWD: EventName[] = [
  'display.changed', 'fullscreen.changed', 'foreground.changed', 'wallpaper.changed', 'hotkey.pressed', 'hotkey.down', 'hotkey.up',
  'media.changed', 'audio.changed', 'audio.bands', 'stats.tick', 'system.changed', 'clipboard.changed', 'desktops.changed', 'apps.changed',
]
const HOTKEY_ISLAND = 1

async function registerHotkeys() {
  if (!sidecar.ready) return
  await sidecar.call('hotkey.unregisterAll', {}).catch(() => undefined)
  if (settings.value.island.enabled) {
    const r = await sidecar.call('hotkey.register', { id: HOTKEY_ISLAND, combo: settings.value.island.hotkey }).catch(() => ({ ok: false, reason: 'call failed' }))
    if (!r.ok) log(`island hotkey failed: ${r.reason}`)
  }
}

function wireSidecar() {
  for (const name of FWD) sidecar.onEvent(name, data => { eventCounts[name] = (eventCounts[name] ?? 0) + 1; overlay?.webContents.send('lokey:event', name, data) })
  sidecar.onEvent('hotkey.pressed', ({ id }) => { if (id === HOTKEY_ISLAND) send({ type: 'toggle-island' }) })
  sidecar.onEvent('fullscreen.changed', ({ full }) => {
    if (!overlay) return
    if (full) overlay.hide()
    else overlay.showInactive()
    send({ type: 'fullscreen', full })
  })
  sidecar.on('ready', () => { void registerHotkeys() })
  settings.on('changed', () => { void registerHotkeys() })
}

// ---- lifecycle ---------------------------------------------------------------------------------------------
app.whenReady().then(async () => {
  settings.load()
  registerIpc()
  wireSidecar()
  createOverlay()
  if (!benchDir) tray = createTray({ toggleIsland: () => send({ type: 'toggle-island' }), quit: () => app.quit() })
  if (argv.includes('--settings')) openSettings()
  const ok = await sidecar.start()
  if (!ok) log('running without sidecar (mock data only)')
})

app.on('window-all-closed', () => { /* the overlay lives for the whole session */ })
app.on('before-quit', () => { tray?.destroy(); void sidecar.stop() })
