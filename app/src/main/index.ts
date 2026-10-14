import { app, BrowserWindow, dialog, ipcMain, screen, shell, type Tray } from 'electron'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppEvent, Stage } from '@shared/bridge'
import type { EventName, MethodName, Methods } from '@shared/protocol'
import { Sidecar } from './sidecar'
import { holdEscape, releaseEscape } from './escape'
import { dataDir, settings, settingsSelfCheck } from './settings'
import { closeLyrics, createTray, openLyrics, openMain, openSettings, pinLyrics, toggleLyrics } from './windows'
import { initEffects, revealWallpaper, setGlow, setGlowSuppressed } from './effects'
import { runUiTest } from './uitest'
import { runLab } from './lab'
import { runShots } from './shots'
import { runDemo } from './agent/demo'
import { Scheduler } from './agent/scheduler'
import { toolsSelfCheck } from './agent/tools'
import { McpHub } from './agent/mcp'
import { Conversation } from './agent/conversation'
import { EDGES, nearestEdge, placementSelfCheck, windowFor, type Edge, type Placement } from '@shared/placement'
import { lyricsAnimSelfCheck } from '@shared/lyricsAnim'
import { safetySelfCheck } from './brain/safety'
import { computerSelfCheck } from './brain/computer'
import { cliSelfCheck } from './brain/cli'
import { TaskManager } from './brain/tasks'
import { brainSelfCheck } from './brain/selfcheck'
import { promptSelfCheck } from './brain/prompt'
import { Wake } from './agent/wake'
import { memorySelfCheck } from './brain/memory/selfcheck'
import { styleSelfCheck } from './brain/style'
import { weeklySelfCheck } from './brain/weekly'
import { evalSelfCheck, runEval } from './brain/eval'
import { trustUndoNudgeSelfCheck } from './agent/trustSelfcheck'
import { logForeground } from './agent/activity'
import { registrySelfCheck } from './brain/registry'
import { settingsToolsSelfCheck } from './brain/settingsTools'
import { lyricsSelfCheck } from '@shared/lyrics'
import { disposeConfirm } from './agent/permissions'
import { Agent } from './agent/agent'
import { linkSelfCheck } from './link/linkSelfcheck'
import { registerLink } from './link/ipc'
import { registerCoreIpc } from './ipcCore'
import { Dictation } from './agent/dictation'
import { Lasso } from './agent/lasso'
import type { VoiceEvent } from '@shared/voice'

// ---- args -----------------------------------------------------------------------------------------
const argv = process.argv.slice(1)
const useMock = argv.includes('--mock')
const uiTestIdx = argv.indexOf('--uitest')
const uiTestDir = uiTestIdx >= 0 ? (argv[uiTestIdx + 1] && !argv[uiTestIdx + 1].startsWith('--') ? argv[uiTestIdx + 1] : join(dataDir, 'uitest')) : null
const shotsIdx = argv.indexOf('--shots')
const shotsDir = shotsIdx >= 0 ? argv[shotsIdx + 1] : null
const selfCheck = argv.includes('--selfcheck')
const demoIdx = argv.indexOf('--demo')
const demoName = demoIdx >= 0 ? argv[demoIdx + 1] : null
const recIdx = argv.indexOf('--record')
const recordDir = recIdx >= 0 ? argv[recIdx + 1] : null
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
if (!benchDir && !uiTestDir && !labDir && !demoName && !selfCheck && !shotsDir && !app.requestSingleInstanceLock()) { app.quit() }
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
let moving: false | 'hold' | 'pick' = false
let cursorTimer: ReturnType<typeof setInterval> | null = null
let placement: Placement = { edge: 'top', along: 600, w: 1200, h: 760 }
const sidecar = new Sidecar()
sidecar.setMaxListeners(64)
initEffects(sidecar)
const agent = new Agent(sidecar, (e: VoiceEvent) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('lokey:voice', e) })
const dictation = new Dictation(sidecar, agent.audio, (t, tone) => agent.notice(t, tone), (play, emote, flash) => agent.emit2({ type: 'mascot', play, emote, flash }))
const lasso = new Lasso(agent, () => dictation.active)
const wake = new Wake(sidecar, agent)
let refreshTray: () => void = () => undefined
agent.on('agents', l => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('lokey:agents', l) })
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
  const isl = settings.value.island
  const first = windowFor({ x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height }, { w: Math.round(1200 * s), h: Math.round(760 * s) }, EDGES.includes(isl.edge) ? isl.edge : 'top', isl.offset)
  placement = first.placement
  const { x, y, w: width, h: height } = first.bounds
  stage = { width, height, scale: d.scaleFactor, workTop: 0 }

  overlay = new BrowserWindow({
    x,
    y,
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
      additionalArguments: [...(useMock ? ['--lokey-mock', `--lokey-edge=${placement.edge}`, `--lokey-along=${Math.round(placement.along)}`] : []), ...(shotsDir ? ['--lokey-demo-data'] : [])],
    },
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  // shaped to the island by the renderer (lokey:region); start with the sleep sliver so nothing else is ever hit
  applyPlacement() // flush on the chosen edge before the first paint
  overlay.setMenu(null)
  overlay.on('blur', () => send({ type: 'blur' }))
  overlay.webContents.on('render-process-gone', () => { log('overlay renderer crashed, reloading'); if (overlay && !overlay.isDestroyed()) overlay.webContents.reload() })
  overlay.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { send({ type: 'close-island' }); e.preventDefault() }
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void overlay.loadURL(devUrl)
  else void overlay.loadFile(join(__dirname, '../renderer/index.html'))
  overlay.once('ready-to-show', () => overlay?.showInactive())
}

// ---- where the island sits ----------------------------------------------------------------------------------
/** Puts the overlay window flush on the chosen screen edge (sliding along it so corners are reachable) and tells the island. While the
 *  user is moving it, the window covers the whole display so the island can be dragged anywhere. */
/** the settings that decide where the overlay window goes (anything else must not move or re-shape it) */
const placeSig = () => { const s = settings.value; return `${s.island.edge}|${s.island.offset}|${s.appearance.scale}` }
let lastPlaceSig = ''
function applyPlacement() {
  if (!overlay || overlay.isDestroyed()) return
  lastPlaceSig = placeSig()
  const d = screen.getPrimaryDisplay()
  const s = Math.min(1.5, Math.max(0.75, settings.value.appearance.scale))
  const size = { w: Math.round(1200 * s), h: Math.round(760 * s) }
  const disp = { x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height }
  const isl = settings.value.island
  const edge: Edge = EDGES.includes(isl.edge) ? isl.edge : 'top'
  if (moving) {
    overlay.setBounds({ x: disp.x, y: disp.y, width: disp.w, height: disp.h })
    overlay.setShape([{ x: 0, y: 0, width: disp.w, height: disp.h }])
    placement = { edge, along: 0, w: disp.w, h: disp.h }
  } else {
    const r = windowFor(disp, size, edge, isl.offset)
    overlay.setBounds({ x: r.bounds.x, y: r.bounds.y, width: r.bounds.w, height: r.bounds.h })
    placement = r.placement
    stage = { width: r.bounds.w, height: r.bounds.h, scale: d.scaleFactor, workTop: 0 }
    // until the island sends its real shape, only a sliver on the chosen edge belongs to us
    const along = Math.round(placement.along)
    overlay.setShape([edge === 'top' ? { x: along - 100, y: 0, width: 200, height: 16 } : edge === 'bottom' ? { x: along - 100, y: r.bounds.h - 16, width: 200, height: 16 } : edge === 'left' ? { x: 0, y: along - 100, width: 16, height: 200 } : { x: r.bounds.w - 16, y: along - 100, width: 16, height: 200 }])
  }
  overlay.webContents.send('lokey:place', { edge: placement.edge, along: placement.along, editing: moving })
}
function startMove(mode: 'hold' | 'pick') {
  if (moving || !overlay) return
  moving = mode
  holdEscape('move', cancelMove)
  applyPlacement()
  // while the chord is held the pointer position comes from here (no mouse capture, nothing to lose)
  if (mode === 'hold') cursorTimer = setInterval(() => {
    if (!overlay || overlay.isDestroyed()) return
    const d = screen.getPrimaryDisplay().bounds, c = screen.getCursorScreenPoint()
    overlay.webContents.send('lokey:place:cursor', { x: c.x - d.x, y: c.y - d.y })
  }, 16)
}
function endMove() {
  moving = false
  if (cursorTimer) { clearInterval(cursorTimer); cursorTimer = null }
  releaseEscape('move')
}
function cancelMove() { if (!moving) return; endMove(); applyPlacement() }
/** the move chord was released: the island goes to the edge/corner nearest the pointer */
function dropIsland() {
  if (moving !== 'hold') return
  const d = screen.getPrimaryDisplay().bounds, c = screen.getCursorScreenPoint()
  const n = nearestEdge({ x: 0, y: 0, w: d.width, h: d.height }, c.x - d.x, c.y - d.y)
  endMove()
  settings.set({ island: { edge: n.edge, offset: n.offset } })
  applyPlacement()
}

// ---- trust boundary: every window has a role (from its page hash); the island and the main window are trusted, the rest get less ----
export type Role = 'island' | 'main' | 'lyrics' | 'other'
const roleOf = (wc: Electron.WebContents): Role => {
  if (overlay && !overlay.isDestroyed() && wc.id === overlay.webContents.id) return 'island'
  const h = wc.getURL().split('#')[1] ?? ''
  return h.startsWith('main') ? 'main' : h.startsWith('lyrics') ? 'lyrics' : 'other'
}
const trusted = (wc: Electron.WebContents) => { const r = roleOf(wc); return r === 'island' || r === 'main' }
export function roleAllows(role: Role, method: string) {
  if (role === 'island' || role === 'main') return true
  if (role === 'lyrics') return /^(media|audio|system|user|desktops|wallpaper|wifi|stats)\./.test(method)
  return /\.get$/.test(method) // audio page, confirm card, effect canvases: read-only state at most
}
export function trustSelfCheck(): string {
  const need = (c: boolean, m: string) => { if (!c) throw new Error('trust: ' + m) }
  need(!roleAllows('other', 'power.do') && !roleAllows('lyrics', 'power.do') && roleAllows('island', 'power.do') && roleAllows('lyrics', 'media.get'), 'role allow-list')
  return 'trust ok'
}
// deny-by-default for every window (including ones created later); only http(s) leaves the app, in the user's browser
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  wc.on('will-navigate', e => e.preventDefault())
})

// ---- IPC ----------------------------------------------------------------------------------------------
function registerIpc() {
  registerLink(agent, sidecar)
  registerCoreIpc(agent, (ch, ...a) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(ch, ...a) })
  ipcMain.handle('lokey:call', async (e, method: MethodName, params: Methods[MethodName][0]) => {
    if (!labDir && !roleAllows(roleOf(e.sender), String(method))) { log(`blocked ${method} from ${roleOf(e.sender)}`); throw new Error('not allowed here') }
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
  ipcMain.handle('lokey:place:get', () => ({ edge: placement.edge, along: placement.along, editing: moving }))
  ipcMain.on('lokey:place:start', (e, mode: string) => { if (mode === 'pick' && trusted(e.sender)) startMove('pick') })
  ipcMain.on('lokey:place:cancel', e => { if (overlay && e.sender === overlay.webContents) cancelMove() })
  ipcMain.on('lokey:place:commit', (e, edge: string, offset: number) => {
    if (!overlay || e.sender !== overlay.webContents || !moving) return
    const ed = EDGES.find(x => x === edge)
    if (!ed || !Number.isFinite(offset)) return cancelMove()
    endMove()
    settings.set({ island: { edge: ed, offset: Math.max(0, Math.min(1, offset)) } })
    applyPlacement() // also when it was dropped exactly where it already was
  })
  ipcMain.handle('lokey:settings:set', (e, patch) => { if (!trusted(e.sender)) throw new Error('not allowed here'); return settings.set(patch) })
  ipcMain.on('lokey:log', (_e, m: string) => log(`renderer: ${m}`))
  ipcMain.on('lokey:quit', () => app.quit())
  ipcMain.on('lokey:external', (_e, url: string) => { if (/^https?:\/\//.test(url)) void shell.openExternal(url) })
  ipcMain.on('lokey:openSettings', (_e, section?: string) => openSettings(typeof section === 'string' ? section : undefined))
  ipcMain.on('lokey:openMain', (_e, page?: string, section?: string) => openMain(page, typeof section === 'string' ? section : undefined))
  ipcMain.handle('lokey:hotkeys:status', () => hotkeyStatus)
  ipcMain.handle('lokey:wake:status', () => wake.status())
  ipcMain.on('lokey:lyrics:open', () => openLyrics())
  ipcMain.on('lokey:lyrics:close', () => closeLyrics())
  ipcMain.on('lokey:lyrics:pin', (_e, on: boolean) => pinLyrics(on === true))
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
// Record<EventName, ...> makes the compiler demand an entry for every sidecar event: a new event can't be forgotten again.
const FWD_ALL: Record<EventName, true> = {
  'display.changed': true, 'fullscreen.changed': true, 'foreground.changed': true, 'wallpaper.changed': true, 'hotkey.pressed': true, 'hotkey.down': true, 'hotkey.up': true,
  'media.changed': true, 'audio.changed': true, 'audio.bands': true, 'stats.tick': true, 'system.changed': true, 'clipboard.changed': true, 'desktops.changed': true, 'apps.changed': true,
  'wifi.changed': true, 'bt.changed': true, 'audio.devices.changed': true, 'wake.detected': true,
}
const FWD = Object.keys(FWD_ALL) as EventName[]
const HOTKEY_ISLAND = 1
const HOLD_TALK = 2
const HOLD_DICT = 3
const HOLD_LASSO = 4
const HOTKEY_CONVO = 5
const HOLD_MOVE = 6
const HOTKEY_LYRICS = 7
const HOTKEY_STOP = 8
const HOTKEY_TAB_BASE = 20
const TAB_IDS = ['controls', 'today', 'stats', 'clipboard', 'apps', 'wallpaper', 'power'] as const
const hotkeyStatus: Record<string, string> = {}

/** every setting that changes which keys are registered; anything else (theme, size...) must not touch the keyboard hook */
const hotkeySig = () => {
  const s = settings.value
  return JSON.stringify([s.island.enabled, s.island.hotkey, s.island.tabHotkeys, s.voice.enabled, s.voice.pushToTalk, s.voice.dictation, s.voice.dictationKey, s.voice.lasso, s.voice.lassoKey, s.voice.conversationKey, s.island.moveKey, s.island.lyricsKey, s.agent.stopKey])
}
let lastSig = ''
let regChain: Promise<unknown> = Promise.resolve()
/** one registration at a time (unregisterAll tears the keyboard hook down: two overlapping runs could leave no hook at all) */
function registerHotkeys() {
  lastSig = hotkeySig()
  regChain = regChain.then(registerHotkeysNow, registerHotkeysNow)
  return regChain
}

async function registerHotkeysNow() {
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
    if (settings.value.island.moveKey?.trim()) note('move', await hold(HOLD_MOVE, settings.value.island.moveKey), 'move-island chord')
    if (settings.value.agent.stopKey?.trim()) note('stop', await one(HOTKEY_STOP, settings.value.agent.stopKey), 'stop-everything shortcut')
    if (settings.value.island.lyricsKey?.trim()) note('lyrics', await one(HOTKEY_LYRICS, settings.value.island.lyricsKey), 'lyrics shortcut')
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
    if (v.conversationKey?.trim()) note('conversation', await one(HOTKEY_CONVO, v.conversationKey), 'conversation shortcut')
  }
}

/** Tabs with a search box. A global shortcut reaches the sidecar, not Electron, so Windows would refuse to give the overlay the keyboard
 *  (foreground lock) and the caret would never appear; ask the sidecar to hand the foreground to our overlay window. */
const TABS_WITH_INPUT = new Set<string>(['apps', 'clipboard'])
async function takeKeyboard() {
  if (!overlay || overlay.isDestroyed() || uiTestDir) return
  overlay.setFocusable(true)
  overlay.focus()
  const hwnd = Number(overlay.getNativeWindowHandle().readBigUInt64LE(0))
  const r = await sidecar.call('windows.forceForeground', { hwnd }).catch(() => null)
  if (!r?.ok) log(`input: could not give the keyboard to the island (${r?.reason ?? 'call failed'})`)
  overlay.webContents.focus()
}

function wireSidecar() {
  for (const name of FWD) sidecar.onEvent(name, data => { eventCounts[name] = (eventCounts[name] ?? 0) + 1; for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && roleOf(w.webContents) !== 'other') w.webContents.send('lokey:event', name, data) })
  sidecar.onEvent('hotkey.down', ({ id }) => {
    if (id === HOLD_MOVE) startMove('hold')
    else if (id === HOLD_TALK && !dictation.active) void agent.begin('assistant')
    else if (id === HOLD_DICT && !agent.busy) void dictation.begin()
    else if (id === HOLD_LASSO) lasso.down()
  })
  sidecar.onEvent('hotkey.up', ({ id, cancelled }) => {
    // `cancelled`: another key (Esc, typing) ended the chord, so what was being said or drawn is dropped instead of submitted
    if (id === HOLD_MOVE) { if (cancelled) cancelMove(); else dropIsland() }
    else if (id === HOLD_TALK) { if (cancelled) agent.cancel(); else void agent.end() }
    else if (id === HOLD_DICT) { if (cancelled) dictation.cancel(); else void dictation.end() }
    else if (id === HOLD_LASSO) void lasso.up(!!cancelled)
  })
  sidecar.onEvent('hotkey.pressed', ({ id }) => {
    if (id === HOTKEY_ISLAND) send({ type: 'toggle-island' })
    else if (id === HOTKEY_CONVO) { if (!dictation.active) agent.toggleConversation() }
    else if (id === HOTKEY_LYRICS) toggleLyrics()
    else if (id === HOTKEY_STOP) agent.stopAll()
    else if (id >= HOTKEY_TAB_BASE && id < HOTKEY_TAB_BASE + TAB_IDS.length) {
      const tab = TAB_IDS[id - HOTKEY_TAB_BASE]
      if (TABS_WITH_INPUT.has(tab)) void takeKeyboard()
      send({ type: 'open-island', tab, toggle: true })
    }
  })
  sidecar.onEvent('fullscreen.changed', ({ full }) => {
    if (!overlay || overlay.isDestroyed()) return
    hiddenForFullscreen = full
    setGlowSuppressed(full)
    if (full) overlay.hide()
    else { overlay.showInactive(); raise() }
    send({ type: 'fullscreen', full })
  })
  sidecar.onEvent('foreground.changed', f => {
    logForeground(f.exe, f.title)
    const now = Date.now()
    if (now - lastRaise > 250) { lastRaise = now; raise() }
  })
  sidecar.on('ready', () => {
    // a restarted sidecar has lost every held chord: nothing may stay "listening" waiting for a key-up that will never come
    agent.cancel(); dictation.cancel(); lasso.cancel(); cancelMove()
    void registerHotkeys()
    void wake.apply(true)
  })
  settings.on('changed', () => { if (hotkeySig() !== lastSig) void registerHotkeys(); if (!moving && placeSig() !== lastPlaceSig) applyPlacement(); void wake.apply(); refreshTray() })
}

// ---- lifecycle ---------------------------------------------------------------------------------------------
app.whenReady().then(async () => {
  settings.load()
  // dev/QA overrides, in memory only: --theme dark|light|auto, --accent #rrggbb
  const ti = argv.indexOf('--theme'), ai = argv.indexOf('--accent')
  if (ti >= 0 && ['dark', 'light', 'auto'].includes(argv[ti + 1])) settings.value.appearance.theme = argv[ti + 1] as 'dark' | 'light' | 'auto'
  if (ai >= 0 && /^#[0-9a-fA-F]{6}$/.test(argv[ai + 1] ?? '')) settings.value.appearance.accent = argv[ai + 1]
  const ei = argv.indexOf('--edge'), oi = argv.indexOf('--offset') // QA: --edge left --offset 0.3
  if (ei >= 0 && EDGES.includes(argv[ei + 1] as Edge)) settings.value.island.edge = argv[ei + 1] as Edge
  if (oi >= 0 && Number.isFinite(Number(argv[oi + 1]))) settings.value.island.offset = Math.max(0, Math.min(1, Number(argv[oi + 1])))
  const si = argv.indexOf('--soul')
  if (si >= 0 && argv[si + 1]) settings.value.loadout.soul = argv[si + 1]
  if (labDir) { registerIpc(); await runLab(labDir, labQuery, labPage); return }
  if (argv.includes('--eval')) { await runEval(join(app.getAppPath(), 'evals'), join(dataDir, 'eval.txt')); app.exit(0); return }
  if (selfCheck) {
    const out: string[] = []
    for (const [n, f] of [['scheduler', Scheduler.selfCheck], ['tools', toolsSelfCheck], ['dictation', Dictation.selfCheck], ['mcp', McpHub.selfCheck], ['conversation', Conversation.selfCheck], ['lyrics', lyricsSelfCheck], ['placement', placementSelfCheck], ['lyricsAnim', lyricsAnimSelfCheck], ['safety', safetySelfCheck], ['computer', computerSelfCheck], ['cli', cliSelfCheck], ['tasks', TaskManager.selfCheck], ['brain', brainSelfCheck], ['prompt', promptSelfCheck], ['registry', registrySelfCheck], ['settingsTools', settingsToolsSelfCheck], ['memory', memorySelfCheck], ['link', linkSelfCheck], ['settings', settingsSelfCheck], ['trustUndoNudge', trustUndoNudgeSelfCheck],['trust', trustSelfCheck], ['style', styleSelfCheck], ['weekly', weeklySelfCheck], ['eval', evalSelfCheck]] as const) { try { out.push(`${n}: ${await f()}`) } catch (e) { out.push(`${n}: FAIL ${e instanceof Error ? e.message : e}`) } }
    writeFileSync(join(dataDir, 'selfcheck.txt'), out.join(String.fromCharCode(10)))
    app.exit(out.some(l => l.includes('FAIL')) ? 1 : 0)
    return
  }
  registerIpc()
  wireSidecar()
  if (benchDir || argv.includes('--diag')) startLagMonitor()
  createOverlay()
  if (!benchDir && !uiTestDir) agent.start()
  const replace = () => { applyPlacement(); raise() }
  screen.on('display-metrics-changed', replace); screen.on('display-added', replace); screen.on('display-removed', replace)
  if (!benchDir) { const t = createTray({ toggleIsland: () => send({ type: 'toggle-island' }), quit: () => app.quit(), conversation: () => agent.toggleConversation(), moveIsland: () => startMove('pick'), stopAll: () => agent.stopAll(), wake: { enabled: () => settings.value.wake.enabled, toggle: () => { settings.set({ wake: { enabled: !settings.value.wake.enabled } }) } } }); tray = t.tray; refreshTray = t.refresh }
  if (argv.includes('--settings')) openSettings()
  if (shotsDir) overlay?.webContents.once('did-finish-load', () => { void runShots(overlay!, shotsDir, () => app.quit()) })
  if (demoName) overlay?.webContents.once('did-finish-load', () => { void runDemo(demoName, agent, overlay, captureDir, recordDir).then(() => app.quit()) })
  if (uiTestDir) overlay?.webContents.once('did-finish-load', () => { void runUiTest(overlay!, uiTestDir, () => app.quit()) })
  const ok = await sidecar.start()
  if (!ok) log('running without sidecar (mock data only)')
})

app.on('window-all-closed', () => { /* the overlay lives for the whole session */ })
app.on('before-quit', () => { agent.dispose(); disposeConfirm(); tray?.destroy(); void sidecar.stop() })
