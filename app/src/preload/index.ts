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
  setInteractive: on => ipcRenderer.send('lokey:interactive', on),
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
