// `electron` for the WebView. The core runs in the same page as the UI, so ipcMain and ipcRenderer are two ends of an in-process bus:
// the preload script (src/preload/index.ts) works unchanged on top of it. Windows, shortcuts, tray and the like are inert stand-ins;
// what the phone can really do (open a link, notify, clipboard) goes to the native plugin when it exists and to the web API otherwise.
import { EventEmitter } from './events'
import { nativeCall, hasNative } from '../native'
import { rmSync } from './fs'

const clone = <T,>(v: T): T => { try { return structuredClone(v) } catch { return v } } // like Electron's IPC: no shared references across the boundary
type Fn = (...a: any[]) => any

// ---- the bus ---------------------------------------------------------------------------------------------------------------------
const handlers = new Map<string, Fn>()
const onMain = new Map<string, Set<Fn>>()      // ipcMain.on  <- ipcRenderer.send
const onPage = new Map<string, Set<Fn>>()      // ipcRenderer.on <- webContents.send

const webContents = {
  id: 1,
  send(channel: string, ...args: unknown[]) { const a = clone(args); queueMicrotask(() => { for (const f of [...(onPage.get(channel) ?? [])]) { try { f({ sender: webContents }, ...a) } catch (e) { console.error('[lokey] ipc listener', channel, e) } } }) },
  isDestroyed: () => false, getURL: () => 'app://lokey/index.html#main', focus() {}, on() { return webContents }, once() { return webContents }, off() { return webContents },
  setWindowOpenHandler() {}, executeJavaScript: async () => undefined, capturePage: async () => ({ toPNG: () => new Uint8Array(0), isEmpty: () => true }),
}
const sender = webContents
const add = (m: Map<string, Set<Fn>>, ch: string, f: Fn) => { let s = m.get(ch); if (!s) m.set(ch, (s = new Set())); s.add(f) }
const del = (m: Map<string, Set<Fn>>, ch: string, f: Fn) => { m.get(ch)?.delete(f) }

export const ipcMain = {
  handle(ch: string, f: Fn) { handlers.set(ch, f) },
  handleOnce(ch: string, f: Fn) { handlers.set(ch, (...a: unknown[]) => { handlers.delete(ch); return f(...a) }) },
  removeHandler(ch: string) { handlers.delete(ch) },
  on(ch: string, f: Fn) { add(onMain, ch, f); return ipcMain },
  once(ch: string, f: Fn) { const w: Fn = (...a) => { del(onMain, ch, w); f(...a) }; add(onMain, ch, w); return ipcMain },
  off(ch: string, f: Fn) { del(onMain, ch, f); return ipcMain },
  removeListener(ch: string, f: Fn) { del(onMain, ch, f); return ipcMain },
  removeAllListeners(ch?: string) { if (ch) onMain.delete(ch); else onMain.clear(); return ipcMain },
}
export const ipcRenderer = {
  async invoke(ch: string, ...args: unknown[]) {
    const h = handlers.get(ch)
    if (!h) throw new Error(`No handler registered for '${ch}'`)
    return clone(await h({ sender }, ...clone(args)))
  },
  send(ch: string, ...args: unknown[]) { const a = clone(args); queueMicrotask(() => { for (const f of [...(onMain.get(ch) ?? [])]) { try { void f({ sender }, ...a) } catch (e) { console.error('[lokey] ipc handler', ch, e) } } }) },
  on(ch: string, f: Fn) { add(onPage, ch, f); return ipcRenderer },
  once(ch: string, f: Fn) { const w: Fn = (...a) => { del(onPage, ch, w); f(...a) }; add(onPage, ch, w); return ipcRenderer },
  off(ch: string, f: Fn) { del(onPage, ch, f); return ipcRenderer },
  removeListener(ch: string, f: Fn) { del(onPage, ch, f); return ipcRenderer },
  removeAllListeners(ch?: string) { if (ch) onPage.delete(ch); else onPage.clear(); return ipcRenderer },
}
/** how many page-side listeners a channel has (the confirm sheet in pages.ts steps aside when the UI listens too) */
export const pageListeners = (ch: string) => onPage.get(ch)?.size ?? 0
export const contextBridge = { exposeInMainWorld(name: string, api: unknown) { (globalThis as unknown as Record<string, unknown>)[name] = api } }

// ---- windows: there is only the page. A "window" that core code opens by hash (#agent, #confirm, #caption...) is mounted in-page by whoever
// registered that hash (see ../pages.ts): the main-process code that creates and talks to those windows therefore works unchanged. ----------
const pages = new Map<string, () => void>()
export const registerPage = (hash: string, mount: () => void) => { pages.set(hash, mount) }
const mountPage = (hash?: string) => { const m = hash ? pages.get(hash.split('?')[0]) : undefined; if (m) queueMicrotask(m) }

class FakeWindow extends EventEmitter {
  webContents = webContents
  id = 1
  static getAllWindows() { return [pageWindow] }
  static fromWebContents() { return pageWindow }
  isDestroyed() { return false }
  isVisible() { return true }
  loadURL(url: string) { mountPage(url.split('#')[1]); return Promise.resolve() }
  loadFile(_f: string, o?: { hash?: string }) { mountPage(o?.hash); return Promise.resolve() }
  show() {} showInactive() {} hide() {} focus() {} close() {} destroy() {} moveTop() {} setMenu() {} setShape() {} setBounds() {} setAlwaysOnTop() {} setFocusable() {} setIgnoreMouseEvents() {}
  getNativeWindowHandle() { return new Uint8Array(8) }
}
const pageWindow = new FakeWindow()
export const BrowserWindow = FakeWindow

// ---- the app ---------------------------------------------------------------------------------------------------------------------
class App extends EventEmitter {
  isPackaged = true
  commandLine = { appendSwitch() {} }
  isReady() { return true }
  whenReady() { return Promise.resolve() }
  getPath(n: string) { return ({ home: '/data/home', downloads: '/data/Download', userData: '/data/Lokey', temp: '/tmp', documents: '/data/Documents', desktop: '/data/home' } as Record<string, string>)[n] ?? '/data' }
  getAppPath() { return '/app' }
  getVersion() { return '0.0.0' }
  getName() { return 'Lokey' }
  requestSingleInstanceLock() { return true }
  setLoginItemSettings() {}
  quit() { void nativeCall('sys.quit', {}).catch(() => undefined) }
  exit() { this.quit() }
  getAppMetrics() { return [] }
}
export const app = new App()

export const shell = {
  async openExternal(url: string) { try { await nativeCall('intent.open', { url }) } catch { window.open(url, '_blank', 'noopener') } },
  async openPath(p: string) { try { await nativeCall('apps.openPath', { path: p }); return '' } catch { return 'not available on Android' } },
  showItemInFolder() {},
  async trashItem(p: string) { rmSync(p, { recursive: true, force: true }) }, // no recycle bin: files the assistant "trashes" are removed from Lokey's own storage
}

let lastClip = ''
export const clipboard = {
  readText() { void nativeCall<{ text?: string }>('clipboard.read', {}).then(r => { if (typeof r?.text === 'string') lastClip = r.text }, () => navigator.clipboard?.readText().then(t => { lastClip = t }, () => undefined)); return lastClip }, // sync API: the answer lags one call behind
  writeText(t: string) { lastClip = t; void nativeCall('clipboard.set', { text: t }).catch(() => navigator.clipboard?.writeText(t)).catch(() => undefined) },
  readImage() { return nativeImage.createEmpty() },
  clear() { lastClip = '' },
}

export class Notification {
  constructor(private o: { title: string; body?: string }) {}
  static isSupported() { return hasNative() || (typeof window !== 'undefined' && 'Notification' in window) }
  show() {
    void nativeCall('notify.show', { title: this.o.title, text: this.o.body ?? '' }).catch(() => {
      try { if (Notification_.permission === 'granted') new Notification_(this.o.title, { body: this.o.body }) } catch { /* nothing to show it with */ }
    })
  }
  on() { return this }
}
const Notification_ = typeof window !== 'undefined' && 'Notification' in window ? window.Notification : (undefined as never)

class PowerMonitor extends EventEmitter {}
export const powerMonitor = new PowerMonitor()
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') powerMonitor.emit('resume') })

export const screen = Object.assign(new EventEmitter(), {
  getPrimaryDisplay: () => { const w = innerWidth, h = innerHeight; return { id: 1, bounds: { x: 0, y: 0, width: w, height: h }, workArea: { x: 0, y: 0, width: w, height: h }, scaleFactor: devicePixelRatio || 1 } },
  getCursorScreenPoint: () => ({ x: 0, y: 0 }),
})

export const globalShortcut = { register: () => false, unregister() {}, unregisterAll() {}, isRegistered: () => false }
export class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} destroy() {} }
export const Menu = { buildFromTemplate: (t: unknown) => t, setApplicationMenu() {} }
export const nativeImage = { createFromDataURL: () => nativeImage.createEmpty(), createFromPath: () => nativeImage.createEmpty(), createEmpty: () => ({ isEmpty: () => true, toPNG: () => new Uint8Array(0), toJPEG: () => new Uint8Array(0), getSize: () => ({ width: 0, height: 0 }), resize() { return this } }) }
export const safeStorage = { isEncryptionAvailable: () => false, encryptString: (s: string) => new TextEncoder().encode(s), decryptString: (b: Uint8Array) => new TextDecoder().decode(b) } // never used for secrets: see overrides/keystore.ts
export const desktopCapturer = { getSources: async () => [] as unknown[] }
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }), showMessageBox: async () => ({ response: 0 }) }
export const session = { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } }
export type NativeImage = ReturnType<typeof nativeImage.createEmpty>

export default { app, ipcMain, ipcRenderer, contextBridge, BrowserWindow, shell, clipboard, Notification, powerMonitor, screen, globalShortcut, Tray, Menu, nativeImage, safeStorage, desktopCapturer, dialog, session }
