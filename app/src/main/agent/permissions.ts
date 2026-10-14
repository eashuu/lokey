import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { BrowserWindow, app, ipcMain, screen } from 'electron'
import type { ActionRecord, ConfirmRequest } from '@shared/voice'
import { dataDir } from '../settings'

// The assistant's safety layer. Every tool call is classified (safe / ask / deny) by tools.ts; "ask" shows a small
// card with Allow / Deny that only the user can click, and everything the assistant does or is refused is written to
// actions.jsonl so Desk can show what happened.
const logFile = join(dataDir, 'actions.jsonl')
const MAX_LINES = 500
const ASK_TIMEOUT_MS = 30_000

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
let win: BrowserWindow | null = null
let ready = false
let current: { req: ConfirmRequest; done: (ok: boolean) => void } | null = null
let chain: Promise<unknown> = Promise.resolve()
let wired = false
/** Lokey Link hook: emits 'req' (ConfirmRequest) and 'done' (id, ok); the phone answers through answerConfirm. */
export const confirmEvents = new EventEmitter()
export const pendingConfirm = () => current?.req ?? null
/** self-check only: pretend a card is showing, without opening a window */
export function _setCurrentForTest(req: ConfirmRequest, done: (ok: boolean) => void) { current = { req, done } }
export function answerConfirm(id: string, ok: boolean): boolean { if (current && current.req.id === id) { current.done(ok === true); return true } return false }

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

/** Shows the card and resolves with the user's answer (false on Deny, on timeout or when the window goes away). */
export function confirm(title: string, detail: string, tool: string, image?: string): Promise<boolean> {
  wire()
  const run = () => new Promise<boolean>(resolve => {
    const req: ConfirmRequest = { id: Math.random().toString(36).slice(2, 10), title, detail: detail.slice(0, 600), tool, timeoutMs: ASK_TIMEOUT_MS, ...(image ? { image } : {}) }
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
      confirmEvents.emit('done', req.id, ok)
      resolve(ok)
    }
    const t = setTimeout(() => finish(false), ASK_TIMEOUT_MS + 500)
    t.unref?.()
    current = { req, done: finish }
    confirmEvents.emit('req', req)
    const w = open()
    w.once('closed', () => finish(false))
    if (ready) w.webContents.send('lokey:confirm:req', req)
  })
  const p = chain.then(run, run)
  chain = p.catch(() => undefined)
  return p
}

export function disposeConfirm() { if (win && !win.isDestroyed()) win.destroy(); win = null }
