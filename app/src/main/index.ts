import { app, BrowserWindow, dialog, ipcMain, screen, shell, type Tray } from 'electron'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppEvent, Stage } from '@shared/bridge'
import type { EventName, MethodName, Methods } from '@shared/protocol'
import { Sidecar } from './sidecar'
import { dataDir, settings } from './settings'
import { createTray, openMain, openSettings } from './windows'
import { initEffects, revealWallpaper, setGlow, setGlowSuppressed } from './effects'
import { runUiTest } from './uitest'
import { runLab } from './lab'
import { runDemo } from './agent/demo'
import { Scheduler } from './agent/scheduler'
import { readMemory, toolsSelfCheck, writeMemory } from './agent/tools'
import { Agent } from './agent/agent'
import { Dictation } from './agent/dictation'
import { Lasso } from './agent/lasso'
import type { VoiceEvent } from '@shared/voice'

// ---- args -----------------------------------------------------------------------------------------
const argv = process.argv.slice(1)
const useMock = argv.includes('--mock')
const uiTestIdx = argv.indexOf('--uitest')
const uiTestDir = uiTestIdx >= 0 ? (argv[uiTestIdx + 1] && !argv[uiTestIdx + 1].startsWith('--') ? argv[uiTestIdx + 1] : join(dataDir, 'uitest')) : null
const selfCheck = argv.includes('--selfcheck')
const demoIdx = argv.indexOf('--demo')
const demoName = demoIdx >= 0 ? argv[demoIdx + 1] : null
const capIdx = argv.indexOf('--capture')
const captureDir = capIdx >= 0 ? argv[capIdx + 1] : null
const labIdx = argv.indexOf('--lab')
const labDir = labIdx >= 0 ? argv[labIdx + 1] : null
const labQuery = argv.indexOf('--lab-query') >= 0 ? argv[argv.indexOf('--lab-query') + 1] : ''
const labPage = argv.indexOf('--lab-page') >= 0 ? argv[argv.indexOf('--lab-page') + 1] : 'lab'
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
if (!benchDir && !uiTestDir && !labDir && !demoName && !selfCheck && !app.requestSingleInstanceLock()) { app.quit() }
app.on('second-instance', () => openSettings())

// Compositor-friendly defaults for a transparent always-on-top overlay.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization')

let overlay: BrowserWindow | null = null
let hiddenForFullscreen = false
let lastRaise = 0
let maxLag = 0

// Other topmost windows (taskbar flyouts, task switcher, video pop-outs) can end up above ours after focus changes;
// re-assert the stacking order whenever the foreground window changes (throttled), never by polling.
function raise() {
  if (!overlay || overlay.isDestroyed() || hiddenForFullscreen) return
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.moveTop()
}

// Optional main-thread stall monitor (`--diag`, always on during --bench): logs gaps over 150 ms.
function startLagMonitor() {
  const startedAt = Date.now()
  let last = Date.now()
  setInterval(() => {
    const now = Date.now()
    const lag = now - last - 100
    last = now
    if (now - startedAt < 8000) return // start-up (window creation, sidecar spawn) is expected to be busy
    if (lag > maxLag) maxLag = lag
    if (lag > 150) log(`main loop stalled ${lag} ms`)
  }, 100).unref()
}
let tray: Tray | null = null
let stage: Stage = { width: 1200, height: 720, scale: 1, workTop: 0 }
const sidecar = new Sidecar()
sidecar.setMaxListeners(64)
initEffects(sidecar)
const agent = new Agent(sidecar, (e: VoiceEvent) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('lokey:voice', e) })
const dictation = new Dictation(sidecar, agent.audio, (t, tone) => agent.notice(t, tone))
const lasso = new Lasso(agent)
agent.on('tasks', t => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('lokey:voice:tasks', t) })
const eventCounts: Record<string, number> = {}
sidecar.on('log', log)

function send(e: AppEvent) { overlay?.webContents.send('lokey:app', e) }

// ---- overlay window ---------------------------------------------------------------------------------
// One small fixed-size window pinned to the top-centre of the primary display. It never resizes (resizing a
// transparent window is the main source of jank); everything that moves is drawn inside it.
function createOverlay() {
  const d = screen.getPrimaryDisplay()
  const s = Math.min(1.5, Math.max(0.75, settings.value.appearance.scale))
  const width = Math.min(d.bounds.width, Math.round(1200 * s))
  const height = Math.min(d.bounds.height, Math.round(760 * s))
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
  // shaped to the island by the renderer (lokey:region); start with the sleep sliver so nothing else is ever hit
  overlay.setShape([{ x: Math.round(width / 2 - 170), y: 0, width: 340, height: 40 }])
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
  ipcMain.on('lokey:region', (_e, rects: { x: number; y: number; w: number; h: number }[]) => {
    if (!overlay || !Array.isArray(rects) || rects.length === 0) return
    overlay.setShape(rects.slice(0, 4).map(r => ({ x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), width: Math.max(1, Math.ceil(r.w)), height: Math.max(1, Math.ceil(r.h)) })))
  })
  ipcMain.on('lokey:focusable', (_e, on: boolean) => {
    if (!overlay || uiTestDir) return // the UI test never takes focus
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
  ipcMain.on('lokey:openMain', (_e, page?: string) => openMain(page))
  ipcMain.handle('lokey:hotkeys:status', () => hotkeyStatus)
  ipcMain.handle('lokey:voice:info', () => agent.info())
  ipcMain.handle('lokey:voice:setKey', (_e, key: string) => agent.setKey(String(key ?? '')))
  ipcMain.handle('lokey:voice:clearKey', () => agent.clearKey())
  ipcMain.on('lokey:voice:say', (_e, text: string) => { void agent.say(String(text ?? '')) })
  ipcMain.on('lokey:voice:hold', (_e, on: boolean) => { if (on) void agent.begin('assistant'); else void agent.end() })
  ipcMain.handle('lokey:voice:memory', () => readMemory())
  ipcMain.handle('lokey:voice:forget', (_e, fact: string) => { const m = readMemory().filter(x => x !== fact); writeMemory(m); return m })
  ipcMain.handle('lokey:voice:cancelTask', (_e, id: string) => agent.scheduler.cancel(String(id)))
  ipcMain.handle('lokey:voice:runTaskNow', (_e, id: string) => agent.scheduler.runNow(String(id)))
  ipcMain.handle('lokey:effects:reveal', (_e, path: string, x: number, y: number) => revealWallpaper(path, x, y))
  ipcMain.on('lokey:effects:glow', (_e, state) => { setGlow(state); setTimeout(raise, 120) }) // keep the island above the glow window
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
  ipcMain.handle('lokey:bench:metrics', () => app.getAppMetrics().map(m => ({ type: m.type, pid: m.pid, cpuTimeSec: m.cpu.cumulativeCPUUsage, cpuPct: m.cpu.percentCPUUsage, privateMb: +((m.memory.privateBytes ?? 0) / 1024).toFixed(0) })))
  ipcMain.handle('lokey:bench:finish', (_e, report) => {
    if (!benchDir) return
    mkdirSync(benchDir, { recursive: true })
    const metrics = app.getAppMetrics().map(m => ({ type: m.type, pid: m.pid, cpuPct: m.cpu.percentCPUUsage, workingSetMb: +(m.memory.workingSetSize / 1024).toFixed(1), privateMb: +((m.memory.privateBytes ?? 0) / 1024).toFixed(1) }))
    writeFileSync(join(benchDir, 'report.json'), JSON.stringify({ ...report, maxMainLagMs: maxLag, sidecarEvents: eventCounts, electron: process.versions.electron, metrics }, null, 2))
    setTimeout(() => app.quit(), 300)
  })
}

// ---- sidecar wiring --------------------------------------------------------------------------------------
const FWD: EventName[] = [
  'display.changed', 'fullscreen.changed', 'foreground.changed', 'wallpaper.changed', 'hotkey.pressed', 'hotkey.down', 'hotkey.up',
  'media.changed', 'audio.changed', 'audio.bands', 'stats.tick', 'system.changed', 'clipboard.changed', 'desktops.changed', 'apps.changed',
]
const HOTKEY_ISLAND = 1
const HOLD_TALK = 2
const HOLD_DICT = 3
const HOLD_LASSO = 4
const HOTKEY_TAB_BASE = 20
const TAB_IDS = ['controls', 'today', 'stats', 'clipboard', 'apps', 'wallpaper', 'power'] as const
const hotkeyStatus: Record<string, string> = {}

async function registerHotkeys() {
  if (!sidecar.ready) return
  await sidecar.call('hotkey.unregisterAll', {}).catch(() => undefined)
  for (const k of Object.keys(hotkeyStatus)) delete hotkeyStatus[k]
  const note = (key: string, r: { ok: boolean; reason?: string }, what: string) => {
    hotkeyStatus[key] = r.ok ? '' : r.reason ?? 'could not be registered'
    if (!r.ok) log(`${what} failed: ${r.reason}`)
  }
  const fail = { ok: false, reason: 'call failed' }
  const one = (id: number, combo: string) => sidecar.call('hotkey.register', { id, combo }).catch(() => fail)
  const hold = (id: number, combo: string) => sidecar.call('hotkey.registerHold', { id, combo }).catch(() => fail)
  if (settings.value.island.enabled) {
    note('island', await one(HOTKEY_ISLAND, settings.value.island.hotkey), 'island hotkey')
    const th = settings.value.island.tabHotkeys
    for (const [i, tab] of TAB_IDS.entries()) {
      const combo = th?.[tab]?.trim()
      if (combo) note(`tab:${tab}`, await one(HOTKEY_TAB_BASE + i, combo), `${tab} hotkey`)
    }
  }
  const v = settings.value.voice
  if (v.enabled) {
    note('talk', await hold(HOLD_TALK, v.pushToTalk), 'push-to-talk chord')
    if (v.dictation) note('dictation', await hold(HOLD_DICT, v.dictationKey), 'dictation chord')
    if (v.lasso) note('lasso', await hold(HOLD_LASSO, v.lassoKey), 'lasso chord')
  }
}

function wireSidecar() {
  for (const name of FWD) sidecar.onEvent(name, data => { eventCounts[name] = (eventCounts[name] ?? 0) + 1; overlay?.webContents.send('lokey:event', name, data) })
  sidecar.onEvent('hotkey.down', ({ id }) => {
    if (id === HOLD_TALK && !dictation.active) void agent.begin('assistant')
    else if (id === HOLD_DICT && !agent.busy) void dictation.begin()
    else if (id === HOLD_LASSO) lasso.down()
  })
  sidecar.onEvent('hotkey.up', ({ id }) => {
    if (id === HOLD_TALK) void agent.end()
    else if (id === HOLD_DICT) void dictation.end()
    else if (id === HOLD_LASSO) void lasso.up()
  })
  sidecar.onEvent('hotkey.pressed', ({ id }) => {
    if (id === HOTKEY_ISLAND) send({ type: 'toggle-island' })
    else if (id >= HOTKEY_TAB_BASE && id < HOTKEY_TAB_BASE + TAB_IDS.length) send({ type: 'open-island', tab: TAB_IDS[id - HOTKEY_TAB_BASE], toggle: true })
  })
  sidecar.onEvent('fullscreen.changed', ({ full }) => {
    if (!overlay || overlay.isDestroyed()) return
    hiddenForFullscreen = full
    setGlowSuppressed(full)
    if (full) overlay.hide()
    else { overlay.showInactive(); raise() }
    send({ type: 'fullscreen', full })
  })
  sidecar.onEvent('foreground.changed', () => {
    const now = Date.now()
    if (now - lastRaise > 250) { lastRaise = now; raise() }
  })
  sidecar.on('ready', () => { void registerHotkeys() })
  settings.on('changed', () => { void registerHotkeys() })
}

// ---- lifecycle ---------------------------------------------------------------------------------------------
app.whenReady().then(async () => {
  settings.load()
  if (labDir) { registerIpc(); await runLab(labDir, labQuery, labPage); return }
  if (selfCheck) {
    const out: string[] = []
    for (const [n, f] of [['scheduler', Scheduler.selfCheck], ['tools', toolsSelfCheck]] as const) { try { out.push(`${n}: ${f()}`) } catch (e) { out.push(`${n}: FAIL ${e instanceof Error ? e.message : e}`) } }
    writeFileSync(join(dataDir, 'selfcheck.txt'), out.join(String.fromCharCode(10)))
    app.exit(out.some(l => l.includes('FAIL')) ? 1 : 0)
    return
  }
  registerIpc()
  wireSidecar()
  if (benchDir || argv.includes('--diag')) startLagMonitor()
  createOverlay()
  if (!benchDir && !uiTestDir) agent.start()
  screen.on('display-metrics-changed', () => raise())
  if (!benchDir) tray = createTray({ toggleIsland: () => send({ type: 'toggle-island' }), quit: () => app.quit() })
  if (argv.includes('--settings')) openSettings()
  if (demoName) overlay?.webContents.once('did-finish-load', () => { void runDemo(demoName, agent, overlay, captureDir).then(() => app.quit()) })
  if (uiTestDir) overlay?.webContents.once('did-finish-load', () => { void runUiTest(overlay!, uiTestDir, () => app.quit()) })
  const ok = await sidecar.start()
  if (!ok) log('running without sidecar (mock data only)')
})

app.on('window-all-closed', () => { /* the overlay lives for the whole session */ })
app.on('before-quit', () => { agent.dispose(); tray?.destroy(); void sidecar.stop() })
