import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { BrowserWindow, app, ipcMain, screen } from 'electron'
import type { ActionRecord, ConfirmRequest } from '@shared/voice'
import { ARM_MS, type AskState } from '@shared/ask'
import { dataDir, settings } from '../settings'

// The assistant's safety layer. Every tool call is classified (safe / ask / deny) by tools.ts; "ask" shows a small
// card with Allow / Deny that only the user can click, and everything the assistant does or is refused is written to
// actions.jsonl so Desk can show what happened.
const logFile = join(dataDir, 'actions.jsonl')
const MAX_LINES = 500
const ASK_TIMEOUT_MS = 30_000
let askMsForTest: number | null = null
let opener: () => BrowserWindow = () => open()
/** self-check only: a short timeout and a stand-in for the confirm window (so no real window is ever opened) */
export function _testHooks(h: { askMs?: number | null; opener?: (() => BrowserWindow) | null }) { if ('askMs' in h) askMsForTest = h.askMs ?? null; if ('opener' in h) opener = h.opener ?? (() => open()) }

export function logAction(r: Omit<ActionRecord, 'at'>) {
  try {
    mkdirSync(dataDir, { recursive: true })
    appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...r }) + '\n')
  } catch { /* the log is a convenience, never a reason to fail */ }
}

export function readActions(limit = 100): ActionRecord[] {
  try {
    const lines = readFileSync(logFile, 'utf8').split('\n').filter(Boolean)
    if (lines.length > MAX_LINES * 2) writeFileSync(logFile, lines.slice(-MAX_LINES).join('\n') + '\n')
    return lines.slice(-limit).map(l => JSON.parse(l) as ActionRecord).reverse()
  } catch { return [] }
}

export function clearActions() { try { writeFileSync(logFile, '') } catch { /* nothing to clear */ } }

// ---- the confirm card ---------------------------------------------------------------------------------------------
// Two places can show a request: inside the island (the default; main/agent/askIsland.ts is the route) or the separate
// confirm window (the fallback: setting agent.confirmIn = 'window', the island hidden or disabled, the screens changed, or the
// island page not answering within a moment). Whichever shows it, the request has the same id, the same timer and the same
// answer (id, ok) through answerConfirm; nothing is ever approved by a timeout, a closed window or a lost page.
let win: BrowserWindow | null = null
let ready = false
let current: { req: ConfirmRequest; done: (ok: boolean) => void; shownAt: number } | null = null
let chain: Promise<unknown> = Promise.resolve()
let wired = false
let queued = 0
/** Lokey Link hook: emits 'req' (ConfirmRequest) and 'done' (id, ok); the phone answers through answerConfirm. */
export const confirmEvents = new EventEmitter()
export const pendingConfirm = () => current?.req ?? null
/** true while any card is waiting for an answer; the assistant's own mouse and keyboard stay off meanwhile (sidecar gate in index.ts) */
export const cardOpen = () => current !== null
/** the sidecar refuses the assistant's mouse and keyboard (input.*) while a request waits, so it can never click Allow or press the chord itself */
export const inputGate = (method: string): string | null => (method.startsWith('input.') && current ? 'a request is waiting for your answer' : null)
/** self-check only: pretend a card is showing, without opening a window */
export function _setCurrentForTest(req: ConfirmRequest, done: (ok: boolean) => void) { current = { req, done, shownAt: Date.now() - ARM_MS - 1 } }
export function answerConfirm(id: string, ok: boolean): boolean { if (current && current.req.id === id) { current.done(ok === true); return true } return false }
/** An answer from the island or its chord: Deny always counts, Allow only once the card has been up for a moment (a click aimed at something else cannot land on it). */
export function answerLocal(id: string, ok: boolean, now = Date.now()): boolean {
  if (!current || current.req.id !== id) return false
  if (ok === true && now - current.shownAt < ARM_MS) return false
  current.done(ok === true)
  return true
}
/** the card on screen, whatever shows it (for the chords, which do not know the id) */
export function answerCurrent(ok: boolean): boolean { return current ? answerLocal(current.req.id, ok) : false }

/** The island side (askIsland.ts). push() draws or clears; shown() resolves true once the page confirms it is drawing that request. */
export interface IslandRoute { usable(): boolean; push(s: AskState): void; shown(id: string, ms: number): Promise<boolean> }
let route: IslandRoute | null = null
export function setIslandRoute(r: IslandRoute | null) { route = r }
let onIsland = false
const askState = (): AskState => ({ cur: current ? { ...current.req, expiresAt: current.shownAt + current.req.timeoutMs } : null, more: queued })

function wire() {
  if (wired) return
  wired = true
  ipcMain.on('lokey:confirm:ready', e => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return
    ready = true
    if (current) win.webContents.send('lokey:confirm:req', current.req)
    if (!win.isVisible()) win.showInactive()
  })
  ipcMain.on('lokey:confirm:answer', (e, id: string, ok: boolean) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return // only our own card may answer
    if (current && current.req.id === id) current.done(ok === true)
  })
}

function open(): BrowserWindow {
  if (win && !win.isDestroyed()) return win
  const wa = screen.getPrimaryDisplay().workArea
  const w = 440, h = 190
  win = new BrowserWindow({
    x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + wa.height - h - 120, width: w, height: h,
    frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, focusable: false, hasShadow: false, show: false, alwaysOnTop: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, devTools: !app.isPackaged },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setMenu(null)
  ready = false
  const self = win
  self.on('closed', () => { if (win === self) { win = null; ready = false } })
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) void self.loadURL(`${dev}#confirm`)
  else void self.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'confirm' })
  return self
}

export interface AskExtra { src?: string; kind?: 'ask' | 'handoff'; timeoutMs?: number }

/** Shows the card and resolves with the user's answer (false on Deny, on timeout or when the window goes away). */
export function confirm(title: string, detail: string, tool: string, image?: string, cls?: string, extra: AskExtra = {}): Promise<boolean> {
  wire()
  const run = () => new Promise<boolean>(resolve => {
    queued = Math.max(0, queued - 1)
    const timeoutMs = askMsForTest ?? Math.max(5_000, Math.min(600_000, extra.timeoutMs ?? ASK_TIMEOUT_MS))
    const req: ConfirmRequest = { id: Math.random().toString(36).slice(2, 10), title, detail: detail.slice(0, 600), tool, timeoutMs, ...(image ? { image } : {}), ...(cls ? { cls } : {}), ...(extra.src ? { src: extra.src.slice(0, 120) } : {}), ...(extra.kind === 'handoff' ? { kind: 'handoff' as const } : {}) }
    let finished = false
    const finish = (ok: boolean) => {
      if (finished) return
      finished = true
      clearTimeout(t)
      current = null
      const w = win
      win = null
      ready = false
      if (w && !w.isDestroyed()) setTimeout(() => { if (!w.isDestroyed()) w.destroy() }, 120)
      if (onIsland && queued === 0) route?.push({ cur: null, more: 0 })
      if (queued === 0) onIsland = false
      confirmEvents.emit('done', req.id, ok)
      resolve(ok)
    }
    const t = setTimeout(() => finish(false), timeoutMs + 500)
    t.unref?.()
    current = { req, done: finish, shownAt: Date.now() }
    confirmEvents.emit('req', req)
    const toWindow = () => {
      if (!current || current.req.id !== req.id) return
      const w = opener()
      w.once('closed', () => finish(false))
      current.req = { ...req, timeoutMs: Math.max(1_000, timeoutMs - (Date.now() - current.shownAt)) }
      if (ready) w.webContents.send('lokey:confirm:req', current.req)
    }
    let usable = false // a card with a picture (second screen) keeps the window
    try { usable = settings.value.agent.confirmIn !== 'window' && !image && !!route && route.usable() } catch { usable = false }
    if (usable && route) {
      onIsland = true
      route.push(askState())
      void route.shown(req.id, 1500).then(ok => { if (!ok && !finished) { onIsland = false; route?.push({ cur: null, more: queued }); toWindow() } }, () => { if (!finished) { onIsland = false; toWindow() } })
    } else {
      if (onIsland) { onIsland = false; route?.push({ cur: null, more: 0 }) }
      toWindow()
    }
  })
  queued++
  if (current && onIsland) route?.push(askState())
  const p = chain.then(run, run)
  chain = p.catch(() => undefined)
  return p
}

/** "Your turn" card: the person must do something themselves (log in, pay). true = "I'm done", false = skip, expiry or a lost card. */
export const handoff = (title: string, detail: string, tool: string) => confirm(title, detail, tool, undefined, undefined, { kind: 'handoff', timeoutMs: 120_000 })

/** The island went away (page crashed, window destroyed): a card shown there is denied, never left hanging and never approved. */
export function islandGone() { if (onIsland && current) current.done(false) }
/** the island page asks for the state again (a reloaded page) */
export const currentAskState = (): AskState => askState()

export function disposeConfirm() { if (win && !win.isDestroyed()) win.destroy(); win = null; if (onIsland) route?.push({ cur: null, more: 0 }) }
