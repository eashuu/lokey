import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent, Bridge, Settings } from '@shared/bridge'

function subscribe<T>(channel: string, cb: (...a: T[]) => void) {
  const h = (_: unknown, ...a: unknown[]) => cb(...(a as T[]))
  ipcRenderer.on(channel, h)
  return () => { ipcRenderer.off(channel, h) }
}

const listeners = new Map<string, Set<(d: unknown) => void>>()
ipcRenderer.on('lokey:event', (_e, name: string, data: unknown) => { listeners.get(name)?.forEach(cb => cb(data)) })

const bridge: Bridge = {
  kind: 'electron',
  call: (method, params) => ipcRenderer.invoke('lokey:call', method, params),
  on: (event, cb) => {
    let set = listeners.get(event)
    if (!set) listeners.set(event, (set = new Set()))
    set.add(cb as (d: unknown) => void)
    return () => { set!.delete(cb as (d: unknown) => void) }
  },
  setRegion: rects => ipcRenderer.send('lokey:region', rects),
  setFocusable: on => ipcRenderer.send('lokey:focusable', on),
  stage: () => ipcRenderer.invoke('lokey:stage'),
  settings: {
    get: () => ipcRenderer.invoke('lokey:settings:get'),
    set: patch => ipcRenderer.invoke('lokey:settings:set', patch),
    onChange: cb => subscribe<Settings>('lokey:settings:changed', cb),
  },
  onApp: cb => subscribe<AppEvent>('lokey:app', cb),
  app: {
    openSettings: () => ipcRenderer.send('lokey:openSettings'),
    quit: () => ipcRenderer.send('lokey:quit'),
    log: m => ipcRenderer.send('lokey:log', m),
    openExternal: url => ipcRenderer.send('lokey:external', url),
    pickFolder: () => ipcRenderer.invoke('lokey:pickFolder'),
    openMain: page => ipcRenderer.send('lokey:openMain', page),
  },
  effects: {
    revealWallpaper: (path, x, y) => ipcRenderer.invoke('lokey:effects:reveal', path, x, y),
    glow: state => ipcRenderer.send('lokey:effects:glow', state),
  },
  bench: {
    config: () => ipcRenderer.invoke('lokey:bench:config'),
    capture: name => ipcRenderer.invoke('lokey:bench:capture', name),
    metrics: () => ipcRenderer.invoke('lokey:bench:metrics'),
    finish: report => ipcRenderer.invoke('lokey:bench:finish', report),
  },
}

contextBridge.exposeInMainWorld('lokey', bridge)
contextBridge.exposeInMainWorld('lokeyFlags', { mock: process.argv.includes('--lokey-mock') })
// whole-screen effect pages (#reveal / #glow): last message is buffered so a late subscriber still gets it
contextBridge.exposeInMainWorld('lokeyFx', ((last: Record<string, unknown>) => { for (const c of ['reveal:start', 'glow:state']) ipcRenderer.on(`lokey:${c}`, (_e, d) => { last[c] = d }); const sub = (c: string) => (cb: (d: any) => void) => { ipcRenderer.on(`lokey:${c}`, (_e, d) => cb(d)); if (c in last) cb(last[c]) }; return { ready: () => ipcRenderer.send('lokey:reveal:ready'), done: () => ipcRenderer.send('lokey:reveal:done'), onStart: sub('reveal:start'), onGlow: sub('glow:state') } })({}))
