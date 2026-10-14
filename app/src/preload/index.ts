import { contextBridge, ipcRenderer } from 'electron'
import type { AppEvent, Bridge, MainPage, Settings } from '@shared/bridge'
import type { AgentTask, ScheduledTask, VoiceEvent } from '@shared/voice'

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
    openSettings: section => ipcRenderer.send('lokey:openSettings', section),
    quit: () => ipcRenderer.send('lokey:quit'),
    log: m => ipcRenderer.send('lokey:log', m),
    openExternal: url => ipcRenderer.send('lokey:external', url),
    pickFolder: () => ipcRenderer.invoke('lokey:pickFolder'),
    openMain: (page, section) => ipcRenderer.send('lokey:openMain', page, section),
    onNav: cb => subscribe<{ page: MainPage; section?: string }>('lokey:nav', cb),
  },
  effects: {
    revealWallpaper: (path, x, y) => ipcRenderer.invoke('lokey:effects:reveal', path, x, y),
    glow: state => ipcRenderer.send('lokey:effects:glow', state),
  },
  voice: {
    info: () => ipcRenderer.invoke('lokey:voice:info'),
    onEvent: cb => subscribe<VoiceEvent>('lokey:voice', cb),
    setKey: key => ipcRenderer.invoke('lokey:voice:setKey', key),
    clearKey: () => ipcRenderer.invoke('lokey:voice:clearKey'),
    say: text => ipcRenderer.send('lokey:voice:say', text),
    hold: on => ipcRenderer.send('lokey:voice:hold', on),
    cancelTask: id => ipcRenderer.invoke('lokey:voice:cancelTask', id),
    runTaskNow: id => ipcRenderer.invoke('lokey:voice:runTaskNow', id),
    onTasks: cb => subscribe<ScheduledTask[]>('lokey:voice:tasks', cb),
    memory: () => ipcRenderer.invoke('lokey:voice:memory'),
    forget: fact => ipcRenderer.invoke('lokey:voice:forget', fact),
    toggleConversation: () => ipcRenderer.send('lokey:voice:convo'),
    clearConversation: () => ipcRenderer.invoke('lokey:voice:clearConversation'),
    actions: () => ipcRenderer.invoke('lokey:voice:actions'),
    clearActions: () => ipcRenderer.invoke('lokey:voice:clearActions'),
    trustRules: () => ipcRenderer.invoke('lokey:trust:rules'),
    trustRevoke: sig => ipcRenderer.invoke('lokey:trust:revoke', sig),
    undoList: () => ipcRenderer.invoke('lokey:undo:list'),
    undoRun: id => ipcRenderer.invoke('lokey:undo:run', id),
    loops: () => ipcRenderer.invoke('lokey:loops:list'),
    loopSet: (id, action) => ipcRenderer.invoke('lokey:loops:set', id, action),
    mcpStatus: () => ipcRenderer.invoke('lokey:voice:mcpStatus'),
  },
  wake: { status: () => ipcRenderer.invoke('lokey:wake:status') },
  link: { state: () => ipcRenderer.invoke('lokey:link:state'), setEnabled: on => ipcRenderer.invoke('lokey:link:enabled', on), newCode: () => ipcRenderer.invoke('lokey:link:code'), revoke: id => ipcRenderer.invoke('lokey:link:revoke', id) },
  memory: {
    list: () => ipcRenderer.invoke('lokey:memory:list'),
    search: q => ipcRenderer.invoke('lokey:memory:search', q),
    graph: () => ipcRenderer.invoke('lokey:memory:graph'),
    lessons: () => ipcRenderer.invoke('lokey:memory:lessons'),
    journal: () => ipcRenderer.invoke('lokey:memory:journal'),
    stats: () => ipcRenderer.invoke('lokey:memory:stats'),
    add: t => ipcRenderer.invoke('lokey:memory:add', t),
    edit: (id, t) => ipcRenderer.invoke('lokey:memory:edit', id, t),
    remove: id => ipcRenderer.invoke('lokey:memory:remove', id),
    pin: (id, on) => ipcRenderer.invoke('lokey:memory:pin', id, on),
    exportJson: () => ipcRenderer.invoke('lokey:memory:export'),
    clear: () => ipcRenderer.invoke('lokey:memory:clear'),
    onChange: cb => subscribe<void>('lokey:memory:changed', () => cb()),
  },
  agents: {
    list: () => ipcRenderer.invoke('lokey:agents:list'),
    stop: id => ipcRenderer.send('lokey:agents:stop', id),
    onChange: cb => subscribe<AgentTask[]>('lokey:agents', cb),
  },
  brain: {
    usage: () => ipcRenderer.invoke('lokey:brain:usage'),
    test: id => ipcRenderer.invoke('lokey:brain:test', id),
    hasSecret: ref => ipcRenderer.invoke('lokey:brain:hasSecret', ref),
    setSecret: (ref, value) => ipcRenderer.invoke('lokey:brain:setSecret', ref, value),
    clearSecret: ref => ipcRenderer.invoke('lokey:brain:clearSecret', ref),
    cli: () => ipcRenderer.invoke('lokey:brain:cli'),
    prompts: a => ipcRenderer.send('lokey:brain:prompts', a),
  },
  place: {
    get: () => ipcRenderer.invoke('lokey:place:get'),
    onChange: cb => subscribe('lokey:place', cb),
    onCursor: cb => subscribe('lokey:place:cursor', cb),
    start: mode => ipcRenderer.send('lokey:place:start', mode),
    commit: (edge, offset) => ipcRenderer.send('lokey:place:commit', edge, offset),
    cancel: () => ipcRenderer.send('lokey:place:cancel'),
  },
  lyrics: {
    get: track => ipcRenderer.invoke('lokey:lyrics:get', track),
    setOffset: (key, ms) => ipcRenderer.invoke('lokey:lyrics:offset', key, ms),
    openWindow: () => ipcRenderer.send('lokey:lyrics:open'),
    win: { close: () => ipcRenderer.send('lokey:lyrics:close'), setPinned: on => ipcRenderer.send('lokey:lyrics:pin', on) },
  },
  hotkeyStatus: () => ipcRenderer.invoke('lokey:hotkeys:status'),
  bench: {
    config: () => ipcRenderer.invoke('lokey:bench:config'),
    capture: name => ipcRenderer.invoke('lokey:bench:capture', name),
    metrics: () => ipcRenderer.invoke('lokey:bench:metrics'),
    finish: report => ipcRenderer.invoke('lokey:bench:finish', report),
  },
}

contextBridge.exposeInMainWorld('lokey', bridge)
const flag = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1]
contextBridge.exposeInMainWorld('lokeyFlags', { mock: process.argv.includes('--lokey-mock'), demo: process.argv.includes('--lokey-demo-data'), edge: flag('lokey-edge'), along: Number.isFinite(Number(flag('lokey-along'))) && flag('lokey-along') !== undefined ? Number(flag('lokey-along')) : undefined })
// whole-screen effect pages (#reveal / #glow): last message is buffered so a late subscriber still gets it
contextBridge.exposeInMainWorld('lokeyFx', ((last: Record<string, unknown>) => { for (const c of ['reveal:start', 'glow:state']) ipcRenderer.on(`lokey:${c}`, (_e, d) => { last[c] = d }); const sub = (c: string) => (cb: (d: any) => void) => { ipcRenderer.on(`lokey:${c}`, (_e, d) => cb(d)); if (c in last) cb(last[c]) }; return { ready: () => ipcRenderer.send('lokey:reveal:ready'), done: () => ipcRenderer.send('lokey:reveal:done'), onStart: sub('reveal:start'), onGlow: sub('glow:state') } })({}))

// hidden audio window (#agent) and the transient overlays (#caption, #dictation, #lasso): small, fixed channels
contextBridge.exposeInMainWorld('lokeyAgent', {
  onCmd: (cb: (c: unknown) => void) => { ipcRenderer.on('lokey:agent:cmd', (_e, c) => cb(c)) },
  mic: (b: ArrayBuffer) => ipcRenderer.send('lokey:agent:mic', b),
  level: (kind: 'mic' | 'out', v: number) => ipcRenderer.send('lokey:agent:level', kind, v),
  ready: () => ipcRenderer.send('lokey:agent:ready'),
  fail: (m: string) => ipcRenderer.send('lokey:agent:fail', m),
})
contextBridge.exposeInMainWorld('lokeyOverlay', {
  on: (channel: 'caption' | 'dictation' | 'lasso', cb: (d: any) => void) => { ipcRenderer.on(`lokey:ov:${channel}`, (_e, d) => cb(d)) },
  ready: (channel: string) => ipcRenderer.send('lokey:ov:ready', channel),
})
// the confirm card (#confirm): shows one request, reports Allow/Deny
contextBridge.exposeInMainWorld('lokeyConfirm', {
  onRequest: (cb: (r: unknown) => void) => { ipcRenderer.on('lokey:confirm:req', (_e, r) => cb(r)) },
  ready: () => ipcRenderer.send('lokey:confirm:ready'),
  answer: (id: string, ok: boolean) => ipcRenderer.send('lokey:confirm:answer', id, ok),
})
// circle to ask (#lasso): the page draws with the mouse while armed and reports the finished stroke
contextBridge.exposeInMainWorld('lokeyLasso', {
  stroke: (pts: { x: number; y: number }[]) => ipcRenderer.send('lokey:lasso:stroke', pts),
  cancel: () => ipcRenderer.send('lokey:lasso:cancel'),
})
