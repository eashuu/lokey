// Node-side check of the Android core: bundled by scripts/mobile-selfcheck.mjs with the same shims and overrides as the WebView build, then run
// under Node (`pnpm mobile:check`). It proves the shims behave, the platform-neutral selfchecks of the core pass on the shimmed fs/events/crypto,
// and the real mobile boot works end to end on the in-process IPC (settings, memory, secrets, voice, native-less sidecar, Link client).
import './shims/globals'
import { Buffer as ShimBuffer } from './shims/buffer'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { ipcMain, ipcRenderer } from 'electron'
import { Scheduler } from '../main/agent/scheduler'
import { toolsSelfCheck } from '../main/agent/tools'
import { McpHub } from '../main/agent/mcp'
import { Conversation } from '../main/agent/conversation'
import { lyricsSelfCheck } from '@shared/lyrics'
import { placementSelfCheck } from '@shared/placement'
import { lyricsAnimSelfCheck } from '@shared/lyricsAnim'
import { safetySelfCheck } from '../main/brain/safety'
import { computerSelfCheck } from '../main/brain/computer'
import { cliSelfCheck } from '../main/brain/cli'
import { TaskManager } from '../main/brain/tasks'
import { promptSelfCheck } from '../main/brain/prompt'
import { registrySelfCheck } from '../main/brain/registry'
import { settingsToolsSelfCheck } from '../main/brain/settingsTools'
import { memorySelfCheck } from '../main/brain/memory/selfcheck'
import { settingsSelfCheck } from '../main/settings'
import { trustUndoNudgeSelfCheck } from '../main/agent/trustSelfcheck'
import { styleSelfCheck } from '../main/brain/style'
import { weeklySelfCheck } from '../main/brain/weekly'
import { evalSelfCheck } from '../main/brain/eval'
import { secondScreenSelfCheck } from './secondScreenCheck'

const need = (c: unknown, m: string) => { if (!c) throw new Error(m) }

function shimsCheck(): string {
  // Buffer
  const b = ShimBuffer.from('héllo wörld ✓')
  need(b.toString('utf8') === 'héllo wörld ✓' && ShimBuffer.from(b.toString('base64'), 'base64').toString() === 'héllo wörld ✓', 'buffer utf8/base64 round trip')
  need(ShimBuffer.from('ab', 'utf8').toString('hex') === '6162' && ShimBuffer.from('6162', 'hex').toString() === 'ab', 'buffer hex')
  need(ShimBuffer.from([251, 255]).toString('base64url') === '-_8' && ShimBuffer.concat([ShimBuffer.from('a'), ShimBuffer.from('bc')]).toString() === 'abc', 'buffer base64url + concat')
  const w = ShimBuffer.alloc(8); w.writeUInt32LE(0xdeadbeef, 0); w.writeUInt16LE(7, 4)
  need(w.readUInt32LE(0) === 0xdeadbeef && w.readUInt16LE(4) === 7 && ShimBuffer.byteLength('✓') === 3, 'buffer le ints')
  // crypto
  need(createHash('sha256').update('abc').digest('hex') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256 vector')
  need(createHash('sha1').update('abc').digest('hex') === 'a9993e364706816aba3e25717850c26c9cd0d89d', 'sha1 vector')
  need(createHash('sha256').update('a'.repeat(1000)).digest('hex') === '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3', 'sha256 multi-block')
  need(randomBytes(32).length === 32 && timingSafeEqual(ShimBuffer.from('a'), ShimBuffer.from('a')) && !timingSafeEqual(ShimBuffer.from('a'), ShimBuffer.from('b')), 'random + timingSafeEqual')
  // path
  need(path.join('/data', 'Lokey', '../x.json') === '/data/x.json' && path.basename('/a/b.txt', '.txt') === 'b' && path.extname('x.tar.gz') === '.gz' && path.resolve('a/b') === '/a/b' && path.dirname('/a/b/c') === '/a/b', 'path')
  // fs
  const d = fs.mkdtempSync('/tmp/chk-')
  fs.writeFileSync(path.join(d, 'a.json'), '{"x":1}')
  fs.appendFileSync(path.join(d, 'a.json'), '\n')
  need(fs.readFileSync(path.join(d, 'a.json'), 'utf8') === '{"x":1}\n' && fs.existsSync(d) && !fs.existsSync(d + '/nope'), 'fs write/read/append/exists')
  fs.renameSync(path.join(d, 'a.json'), path.join(d, 'sub', 'b.json'))
  need(fs.readdirSync(d).join() === 'sub' && fs.statSync(path.join(d, 'sub')).isDirectory() && fs.statSync(path.join(d, 'sub', 'b.json')).size === 8, 'fs rename into a new folder, readdir, stat')
  fs.cpSync(d, d + '-copy', { recursive: true })
  need(fs.readFileSync(d + '-copy/sub/b.json', 'utf8').startsWith('{"x"'), 'fs cpSync recursive')
  need(fs.readdirSync(d, { withFileTypes: true })[0].isDirectory(), 'fs dirents')
  fs.rmSync(d, { recursive: true, force: true })
  need(!fs.existsSync(d) && !fs.existsSync(d + '/sub/b.json'), 'fs rmSync recursive')
  let threw = ''
  try { fs.readFileSync('/tmp/nothing-here') } catch (e) { threw = (e as { code?: string }).code ?? '' }
  need(threw === 'ENOENT', 'fs ENOENT code')
  // events
  const em = new EventEmitter(); let n = 0
  em.once('x', () => n++); em.on('x', () => n += 10); em.emit('x'); em.emit('x')
  need(n === 21 && em.listenerCount('x') === 1, 'EventEmitter once/on')
  return 'ok (buffer, sha256/sha1 vectors, path, fs, events)'
}

async function ipcCheck(): Promise<string> {
  ipcMain.handle('t:echo', (e, a: { n: number }) => ({ n: a.n + 1, from: typeof e.sender.id }))
  const r = await ipcRenderer.invoke('t:echo', { n: 1 })
  need(r.n === 2, 'invoke round trip')
  let got = ''
  ipcMain.on('t:ping', (_e, v: string) => { got = v })
  ipcRenderer.send('t:ping', 'hi')
  await Promise.resolve(); await Promise.resolve()
  need(got === 'hi', 'send -> ipcMain.on')
  let back = 0
  ipcRenderer.on('t:evt', (_e, v: number) => { back = v })
  const { BrowserWindow } = await import('electron')
  BrowserWindow.getAllWindows()[0].webContents.send('t:evt', 5)
  await Promise.resolve(); await Promise.resolve()
  need(back === 5, 'webContents.send -> ipcRenderer.on')
  let miss = ''
  try { await ipcRenderer.invoke('t:none') } catch (e) { miss = String(e) }
  need(/No handler/.test(miss), 'unknown channel rejects')
  return 'ok'
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** a few DOM bits the boot touches, only when running under Node */
const domHandlers = new Map<string, (() => void)[]>()
const doc = { visibilityState: 'visible', baseURI: 'http://localhost/', body: { append() {} }, addEventListener(t: string, f: () => void) { domHandlers.set(t, [...(domHandlers.get(t) ?? []), f]) } }
function setVisibility(v: 'visible' | 'hidden') { doc.visibilityState = v; for (const f of domHandlers.get('visibilitychange') ?? []) f() }
function fakeDom() {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = globalThis; g.location = { search: '' }; g.addEventListener = () => undefined; g.dispatchEvent = () => true
  g.innerWidth = 412; g.innerHeight = 915; g.devicePixelRatio = 2.6
  const el = () => ({ style: {}, width: 0, height: 0, setAttribute() {}, append() {}, remove() {}, set textContent(_v: string) {}, set onclick(_f: unknown) {}, getContext: () => ({ createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, set fillStyle(_v: unknown) {} }), toDataURL: () => 'data:image/jpeg;base64,' })
  g.document = Object.assign(doc, { createElement: el })
}

/** the plugin as PLUGIN.md describes it: call({method, params}) always resolves { result }, failures are { ok:false, reason }, events are { name, data } */
function fakePlugin() {
  const calls: { method: string; params: any }[] = []
  const secrets = new Map<string, string>()
  const listeners: ((e: { name: string; data: unknown }) => void)[] = []
  let launch: unknown = { action: 'ask', text: 'what is the time' }
  const perms: Record<string, boolean> = { mic: true, notifications: false, overlay: true, accessibility: false, 'notification-listener': true, 'battery-optimisation-exempt': false }
  const table: Record<string, (p: any) => unknown> = {
    'perm.status': p => (p.name ? { name: p.name, granted: !!perms[p.name], kind: 'runtime' } : { permissions: { ...perms } }),
    'perm.request': p => ({ ok: true, granted: !!perms[p.name] }),
    'secret.get': p => ({ value: secrets.get(p.name) ?? null }),
    'secret.set': p => { secrets.set(p.name, p.value); return { ok: true } },
    'secret.clear': p => { secrets.delete(p.name); return { ok: true } },
    'system.get': () => ({ network: { kind: 'cellular', name: 'Jio', signal: 0.6 }, bluetooth: { available: true, on: false }, battery: { present: true, pct: 61, charging: false, minutesLeft: null }, keyboard: 'EN', keepAwake: false, brightness: 0.5, darkMode: true, nightLight: null }),
    'wifi.scan': () => ({ ok: false, reason: 'permission needed: location (perm.request location)' }),
    'app.launchAction': () => { const l = launch; launch = null; return { launch: l } }, // one-shot, like the native side
    'diag.beat': () => ({ ok: true }), 'link.credentials': () => ({ ok: true }), 'service.voice': () => ({ ok: true }), 'island.update': () => ({ ok: true }), 'app.sendToBack': () => ({ ok: true }),
    'screenshot': () => ({ ok: true, mime: 'image/jpeg', base64: '/9j/AAAA', w: 540, h: 1200, screenW: 1080, screenH: 2400 }),
    'reminder.set': p => ({ ok: true, id: p.id, at: p.at, mode: 'exact' }),
    'reminder.cancel': () => ({ ok: true }),
    'notify.confirm': () => ({ ok: true }), 'notify.cancel': () => ({ ok: true }), 'notify.show': () => ({ ok: true }), 'island.set': () => ({ ok: true }), 'widget.update': () => ({ ok: true }),
    'clipboard.set': () => ({ ok: true }), 'intent.open': () => ({ ok: true }), 'wake.status': () => ({ listening: false, speech: false, claps: false, recogniser: null, error: null, available: true }), 'wake.set': () => ({ listening: true, speech: false, claps: true, recogniser: null, error: null, available: true }),
  }
  return {
    calls, secrets, perms, setLaunch: (l: unknown) => { launch = l },
    emit: (name: string, data: unknown) => { for (const f of listeners) f({ name, data }) },
    call: async (o: { method: string; params?: unknown }) => {
      calls.push({ method: o.method, params: o.params })
      const f = table[o.method]
      return { result: f ? f(o.params ?? {}) : { ok: false, reason: `unknown method: ${o.method}` } }
    },
    addListener: async (_ev: 'event', cb: (e: { name: string; data: unknown }) => void) => { listeners.push(cb); return { remove: async () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1) } } },
  }
}

/** a stand-in for the PC's Lokey Link API (main/link/server.ts), enough for the client's whole flow */
async function fakePc() {
  const http = (process as unknown as { getBuiltinModule(n: string): typeof import('http') }).getBuiltinModule('http')
  const seen: string[] = []
  const facts = [{ text: 'Owns a red Honda Activa', kind: 'fact', pinned: false, updated: 1 }]
  const got: { text: string }[] = []
  let sse: import('http').ServerResponse | null = null
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const j = (code: number, o: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
      const b = body ? JSON.parse(body) : {}
      seen.push(`${req.method} ${req.url}`)
      if (req.url === '/pair') return b.code === '123456' ? j(200, { id: 'dev1', token: 'T'.repeat(43) }) : j(403, { error: 'wrong or expired code' })
      if (req.headers.authorization !== `Bearer ${'T'.repeat(43)}`) return j(401, { error: 'unauthorized' })
      if (req.url === '/status') return j(200, { pc: 'online', agent: 'idle', jobs: [], nowPlaying: null })
      if (req.url === '/say') return j(200, { ok: true, text: b.text })
      if (req.url === '/approve') return j(200, { ok: true })
      if (req.url === '/sync/facts' && req.method === 'GET') return j(200, { facts })
      if (req.url === '/sync/facts') { for (const f of b.facts) got.push(f); return j(200, { ok: true, added: b.facts.length }) }
      if (req.url === '/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('retry: 3000\n\n'); sse = res; return }
      j(404, {})
    })
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  return { port: (srv.address() as { port: number }).port, seen, got, push: (ev: string, d: unknown) => sse?.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`), close: () => { sse?.end(); srv.closeAllConnections(); srv.close() } }
}

async function bootCheck(): Promise<string> {
  fakeDom()
  const plugin = fakePlugin()
  ;(globalThis as { __lokeyNative?: unknown }).__lokeyNative = plugin // the "plugin" exists from the start, like in the app
  const bootVoice: string[] = []
  ipcRenderer.on('lokey:voice', (_e, ev: { type: string }) => bootVoice.push(ev.type))
  const { bootCore } = await import('./boot')
  const { agent, bridge, sidecar } = await bootCore()
  need(bridge.kind === 'android', 'bridge kind')
  await sleep(30)
  need(plugin.calls.some(c => c.method === 'app.launchAction'), 'app.launchAction asked once at boot')
  need(bootVoice.includes('notice'), `the launch action (ask with text) was handled as a typed request (got ${bootVoice.join()})`)
  // settings round trip through the real IPC handlers
  const s0 = await bridge.settings.get()
  let changed = 0
  bridge.settings.onChange(() => changed++)
  const s1 = await bridge.settings.set({ appearance: { theme: 'light' } })
  await sleep(5)
  need(s0.appearance.theme !== 'light' || s1.appearance.theme === 'light', 'settings.set')
  need(s1.appearance.theme === 'light' && changed === 1, 'settings changed event reaches the page')
  need(JSON.parse(fs.readFileSync('/data/Lokey/settings.json', 'utf8')).appearance.theme === 'light', 'settings persisted to the virtual disk')
  // sidecar without the plugin: sample data
  const media = await bridge.call('media.get', {})
  need(media.hasSession === true, 'sidecar falls back to sample data')
  // secrets (override: keystore)
  need(!(await bridge.brain.hasSecret('openrouter')) && (await bridge.brain.setSecret('openrouter', 'sk-or-test-1234567890')) && (await bridge.brain.hasSecret('openrouter')), 'secret set/has')
  need((await bridge.voice.setKey('AIza' + 'x'.repeat(30))) && (await bridge.voice.info()).hasKey, 'gemini key set')
  await bridge.brain.clearSecret('openrouter'); need(!(await bridge.brain.hasSecret('openrouter')), 'secret clear')
  // memory
  need(await bridge.memory.add('I live in Coimbatore and work as a designer'), 'memory.add')
  need((await bridge.memory.list()).length === 1 && (await bridge.memory.search('where do I live'))[0]?.text.includes('Coimbatore'), 'memory list/search')
  need((await bridge.voice.memory())[0].includes('Coimbatore'), 'voice.memory')
  // voice: a typed turn with no real model reachable ends in an error notice, not a crash, and events reach the UI
  const events: string[] = []
  bridge.voice.onEvent(e => events.push(e.type))
  await bridge.voice.clearKey()
  bridge.voice.say('hello')
  await sleep(20)
  need(events.includes('notice'), `typed turn without a key reports a notice (got ${events.join()})`)
  // trust / undo / loops / actions lists exist
  need(Array.isArray(await bridge.voice.trustRules()) && Array.isArray(await bridge.voice.undoList()) && Array.isArray(await bridge.voice.loops()) && Array.isArray(await bridge.voice.actions()), 'trust/undo/loops/actions lists')
  need((await bridge.agents.list()).length === 0 && (await bridge.voice.mcpStatus()).length === 0, 'agents + mcp status')
  need((await bridge.place.get()).edge === 'top' && (await bridge.stage()).width === 412, 'place + stage')

  // Link client against a stand-in PC
  const pc = await fakePc()
  const lk = bridge.link
  need(!(await lk.state()).enabled, 'link unpaired at start')
  let bad = ''
  await lk.pair!({ address: `127.0.0.1:${pc.port}`, code: '000000' }).catch(e => { bad = String(e) })
  need(/wrong or expired/.test(bad), 'wrong code refused (rejects with a message)')
  const evs: string[] = []
  lk.onEvent!(e => evs.push(e.type))
  need((await lk.pair!({ address: `127.0.0.1:${pc.port}`, code: '123456' })).ok, 'paired')
  const st = await lk.state()
  need(st.enabled && st.devices.length === 1 && st.url === `http://127.0.0.1:${pc.port}`, 'link state shows the PC as the device')
  need((await lk.pcStatus!())?.pc === 'online', 'pc status')
  await sleep(150)
  need(evs.includes('connected'), `SSE connected (${evs.join()})`)
  pc.push('confirm', { id: 'c1', title: 'Open file', detail: 'x', tool: 'open_file', timeoutMs: 30000 })
  await sleep(50)
  need(evs.includes('confirm') && (await lk.approve!('c1', true)), 'confirm event + approve')
  // memory sync both ways: pairing already ran one (PC fact pulled, phone fact pushed, the PC fact is not echoed back); a second one finds nothing new
  need(pc.got.some(f => f.text.includes('Coimbatore')) && !pc.got.some(f => f.text.includes('Activa')), `phone fact pushed, PC fact not echoed (${JSON.stringify(pc.got)})`)
  need((await bridge.memory.list()).some(f => f.text.includes('Activa')), 'PC fact pulled into local memory')
  const sync = await lk.sync!()
  need(sync.pulled === 0 && sync.pushed === 0, `a second sync is a no-op (${JSON.stringify(sync)})`)
  // the tools: ask_pc / pc_status through the real tool runner
  const { runTool } = await import('../main/agent/tools')
  const ctx = { sidecar: undefined, scheduler: agent.scheduler, abilities: [], hub: agent.hub, tasks: agent.tasks, confirmMode: 'full', ask: async () => true, scheduled: false } as never
  const r1 = await runTool('ask_pc', { request: 'open my project' }, ctx)
  need(r1.result.ok === true && pc.seen.includes('POST /say'), `ask_pc sends /say (${JSON.stringify(r1.result)})`)
  const r2 = await runTool('pc_status', {}, ctx)
  need(r2.result.online === true, 'pc_status online')
  // the native link answered / the PC dropped a card while the page slept: on resume nothing is answered twice
  const core = (window as unknown as { __lokeyCore: { linkClient: { resync(): void } } }).__lokeyCore
  const approvals = () => pc.seen.filter(x => x === 'POST /approve').length
  need(approvals() === 1 && !(await lk.approve!('c1', false)) && approvals() === 1, 'an answered card is never answered again')
  pc.push('confirm', { id: 'c2', title: 'Delete file', detail: 'x', tool: 'delete_file', timeoutMs: 30000 })
  await sleep(50)
  const done: string[] = []
  lk.onEvent!(e => { if (e.type === 'confirm-done') done.push((e.data as { id: string }).id) })
  core.linkClient.resync() // the fake PC re-sends nothing pending: c2 was answered by the native layer
  await sleep(2800)
  need(done.includes('c2') && !(await lk.approve!('c2', true)) && approvals() === 1, `a card answered elsewhere is dropped on resume, not answered again (${done.join()})`)
  need(await lk.revoke('dev1'), 'unpair')
  need(!(await lk.state()).enabled, 'unpaired')
  // ---- the plugin contract (PLUGIN.md) ----
  const sys = await bridge.call('system.get', {})
  need(sys.network.kind === 'cellular', 'system.get passes network.kind cellular through')
  need(Array.isArray(await bridge.call('wifi.scan', {})), 'a list method answered { ok:false } stays a list')
  const loose = bridge.call as unknown as (m: string, p: unknown) => Promise<Record<string, unknown>>
  const ps = await loose('perm.status', {})
  need(ps.microphone === true && ps.notification_listener === true && ps.battery === false && ps.overlay === true && ps.notifications === false, `perm.status speaks the UI names (${JSON.stringify(ps)})`)
  need((await loose('perm.status', { name: 'microphone' })).granted === true && plugin.calls.some(c => c.method === 'perm.status' && c.params.name === 'mic'), 'perm.status {name} maps microphone -> mic')
  await loose('perm.request', { name: 'battery' })
  need(plugin.calls.some(c => c.method === 'perm.request' && c.params.name === 'battery-optimisation-exempt'), 'perm.request maps battery')
  need(plugin.calls.some(c => c.method === 'secret.get' && c.params.name === 'gemini') && plugin.calls.some(c => c.method === 'secret.set' && c.params.name === 'openrouter' && c.params.value.startsWith('sk-or')) && plugin.calls.some(c => c.method === 'secret.clear' && c.params.name === 'openrouter') && !plugin.secrets.has('openrouter'), 'secrets go to the plugin as { name, value }')
  need((await bridge.call('wallpaper.get', {})).path !== undefined, 'a method the plugin does not know ("unknown method") falls back to sample data')
  // computer use: the screenshot -> pixels
  const { captureScreen, toPixels } = await import('../main/brain/screen')
  const shot = await captureScreen()
  need(shot?.jpeg === '/9j/AAAA' && shot.width === 540, 'screenshot -> Shot')
  need(JSON.stringify(toPixels(500, 500)) === '{"x":540,"y":1200}', 'the 0..1000 grid maps onto the screen size the plugin reported')
  // tools: no shell on Android
  const { TOOLS } = await import('../main/agent/tools')
  need(!TOOLS.some(t => ['run_command', 'list_processes', 'kill_process', 'close_app', 'delegate_coding'].includes(t.name)) && TOOLS.some(t => t.name === 'computer_task') && TOOLS.some(t => t.name === 'ask_pc'), 'tool list: no shell/processes, computer use and ask_pc present')
  // Android path rules
  const { systemPath, secretPath } = await import('../main/brain/safety')
  need(systemPath('/system/bin/sh') && systemPath('/data/data/com.other.app/files/x.db') && systemPath('/data') && systemPath('/storage/emulated/0/Android/data/com.x/y') && !systemPath('/data/home/notes/a.txt') && !systemPath('/storage/emulated/0/Download/a.pdf'), 'android system paths refused, own folders fine')
  need(secretPath('/data/home/.ssh/id_rsa') && secretPath('/data/Lokey/voice.key') && secretPath('/data/data/app.lokey.link/shared_prefs/lokey_secrets.xml') && !secretPath('/data/home/notes.txt'), 'android secret files refused')
  // reminders: a scheduled task gets an OS alarm only while the page is hidden, and is cancelled with the task
  const t0 = plugin.calls.length
  const task = agent.scheduler.add({ title: 'Call Amma', runAt: new Date(Date.now() + 3_600_000).toISOString(), steps: [], say: 'Call Amma now' })
  need(!plugin.calls.slice(t0).some(c => c.method === 'reminder.set'), 'no alarm while the app is in the foreground')
  setVisibility('hidden')
  const rs = plugin.calls.slice(t0).find(c => c.method === 'reminder.set')
  need(rs?.params.id === 'task-' + task.id && Math.abs(rs.params.at - Date.parse(task.runAt)) < 1 && rs.params.title === 'Call Amma' && rs.params.text === 'Call Amma now', `alarm set when the page goes to the background (${JSON.stringify(rs)})`)
  agent.scheduler.cancel(task.id)
  need(plugin.calls.some(c => c.method === 'reminder.cancel' && c.params.id === 'task-' + task.id), 'alarm cancelled with the task')
  const t2 = agent.scheduler.add({ title: 'Stretch', runAt: new Date(Date.now() + 7_200_000).toISOString(), steps: [], say: 'Stretch' })
  plugin.emit('reminder.fired', { id: 'task-' + t2.id, title: 'Stretch', text: 'Stretch' })
  await sleep(20)
  need(t2.status === 'done', 'reminder.fired (the app was opened from the notification) runs the task')
  // confirm cards: in the background they become a notification with buttons, and the button answers the real request
  const { confirm } = await import('../main/agent/permissions')
  const asked = confirm('Send SMS', 'to Amma', 'send_sms')
  await sleep(20)
  const nc = plugin.calls.find(c => c.method === 'notify.confirm')
  need(nc && nc.params.title === 'Send SMS', 'confirm card -> notify.confirm while hidden')
  plugin.emit('confirm.action', { id: nc!.params.id, allow: true })
  need((await asked) === true && plugin.calls.some(c => c.method === 'notify.cancel' && c.params.id === nc!.params.id), 'notification button answers the card (and the notification is cleared)')
  setVisibility('visible')
  need(sidecar.native, 'plugin in use')
  // remote MCP over HTTP (JSON and SSE replies) through the same hub the agent uses
  const { McpHub } = await import('../main/agent/mcp')
  const sent: { url: string; auth: string | null; body: any }[] = []
  ;(McpHub as unknown as { fetchImpl: typeof fetch }).fetchImpl = (async (url: string, init: { headers: Record<string, string>; body?: string; method: string }) => {
    const b = init.body ? JSON.parse(init.body) : null
    sent.push({ url, auth: init.headers.Authorization ?? null, body: b })
    const h = (ct: string) => ({ get: (k: string) => (/content-type/i.test(k) ? ct : /session/i.test(k) ? 'S1' : null) })
    const json = (r: unknown) => ({ ok: true, status: 200, headers: h('application/json'), text: async () => JSON.stringify({ jsonrpc: '2.0', id: b.id, result: r }) })
    if (!b) return { ok: true, status: 200, headers: h(''), text: async () => '' }
    if (b.method === 'initialize') return json({ protocolVersion: '2025-03-26', capabilities: {} })
    if (b.method === 'notifications/initialized') return { ok: true, status: 202, headers: h(''), text: async () => '' }
    if (b.method === 'tools/list') return json({ tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] })
    return { ok: true, status: 200, headers: h('text/event-stream'), text: async () => `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: b.id, result: { content: [{ type: 'text', text: 'echo: ' + b.params.arguments.text }] } })}\n\n` }
  }) as never
  const hub = new McpHub()
  await hub.sync([{ id: 'r', name: 'Remote', command: 'https://mcp.test/mcp', args: ['Authorization: Bearer abc'], enabled: true, trusted: true }, { id: 's', name: 'Local', command: 'npx', args: ['x'], enabled: true, trusted: false }])
  const mst = hub.status()
  need(mst.find(x => x.id === 'r')?.ok === true && mst.find(x => x.id === 's')?.ok === false && /https address/.test(mst.find(x => x.id === 's')?.error ?? ''), `remote server up, stdio refused politely (${JSON.stringify(mst)})`)
  need(sent.filter(x => x.url === 'https://mcp.test/mcp').every(x => x.auth === 'Bearer abc') && hub.decls().some(d => d.name === 'mcp_remote__echo'), 'headers sent, tool declared')
  need((await hub.call('mcp_remote__echo', { text: 'hi' })) === 'echo: hi' && hub.trusted('mcp_remote__echo'), 'tools/call through an SSE reply')
  hub.stop()
  // ---- native background layer (PLUGIN.md v0.7.3) ----
  const creds = plugin.calls.filter(c => c.method === 'link.credentials').map(c => c.params)
  need(creds.length === 3 && creds[0].base === '' && creds[0].token === '' && creds[1].base === `http://127.0.0.1:${pc.port}` && creds[1].token === 'T'.repeat(43) && creds[2].base === '', `link.credentials: empty at boot, the PC on pair, empty on unpair (${JSON.stringify(creds)})`)
  need(plugin.calls.some(c => c.method === 'diag.beat'), 'diag.beat sent (the 20 s interval starts at boot)')
  await bridge.settings.set({ wake: { enabled: true, phrases: true, list: [{ text: 'hey buddy', action: 'greet' }] } })
  await sleep(20)
  const ws1 = plugin.calls.filter(c => c.method === 'wake.set').pop()
  need(ws1 && JSON.stringify(ws1.params.list) === '[{"text":"hey buddy","action":"greet"}]' && ws1.params.phrases.join() === 'hey buddy', `wake.set carries the phrase list with its actions (${JSON.stringify(ws1?.params)})`)
  const wsCount = plugin.calls.filter(c => c.method === 'wake.set').length
  await bridge.settings.set({ wake: { list: [{ text: 'hey buddy', action: 'welcome' }] } })
  await sleep(20)
  need(plugin.calls.filter(c => c.method === 'wake.set').length === wsCount + 1 && plugin.calls.filter(c => c.method === 'wake.set').pop()!.params.list[0].action === 'welcome', 'an action-only change is re-sent')
  // woken while the user was elsewhere: the page reads the launch action on resume, greets like the Windows wake, then sends the app back
  const wakes: unknown[][] = []
  const A = agent as unknown as { wake: (...a: unknown[]) => Promise<void>; begin: () => Promise<void>; end: () => Promise<void>; convo: boolean }
  A.wake = async (...a) => { wakes.push(a); A.convo = true; agent.setState('listening') }
  const backs = () => plugin.calls.filter(c => c.method === 'app.sendToBack').length
  plugin.setLaunch({ action: 'wake', kind: 'phrase', phrase: 'hey buddy', wakeAction: 'greet' })
  plugin.emit('app.resume', {})
  await sleep(30)
  need(wakes.length === 1 && wakes[0][0] === 'greet' && wakes[0][1] === 'hey buddy', `wake launch -> agent.wake(greet, phrase) (${JSON.stringify(wakes)})`)
  need(backs() === 0, 'the app stays in front while the conversation lasts')
  A.convo = false; agent.setState('idle')
  need(backs() === 1, 'conversation over -> app.sendToBack')
  plugin.setLaunch({ action: 'wake', kind: 'clap' })
  plugin.emit('app.resume', {})
  await sleep(30)
  need(wakes[1][0] === 'listen' && wakes[1][1] === 'a clap', 'clap wake -> listen')
  A.convo = false; agent.setState('idle')
  plugin.setLaunch({ action: 'greet', wake: 'phrase', phrase: 'hey buddy' })
  plugin.emit('app.resume', {})
  await sleep(30)
  need(wakes[2][0] === 'greet' || wakes[2][0] === 'welcome', 'the {wake, phrase, action} form is understood too')
  A.convo = false; agent.setState('idle')
  // a hold on the island (either spelling, may both arrive): one turn, and the app goes back afterwards
  let begins = 0, ends = 0
  A.begin = async () => { begins++; agent.setState('listening') }
  A.end = async () => { ends++; agent.setState('idle') }
  const b0 = backs()
  plugin.emit('island.hold', { state: 'start', down: true }); plugin.emit('island.talk', { down: true })
  await sleep(10)
  plugin.emit('island.hold', { state: 'end', down: false }); plugin.emit('island.talk', { down: false })
  await sleep(10)
  need(begins === 1 && ends === 1 && backs() === b0 + 1, `island hold = one turn, then back (${begins}/${ends}/${backs() - b0})`)
  need(plugin.calls.some(c => c.method === 'island.update' && c.params.primary === 'voice' && c.params.faces[0].title === 'Listening'), 'island.update shows the voice face')
  pc.close()
  agent.dispose()
  return 'ok (settings, sidecar fallback, secrets, memory, voice events, trust lists, link pair/status/SSE/approve/sync, ask_pc/pc_status)'
}

export async function runAll(): Promise<string[]> {
  ;(globalThis as { Buffer: unknown }).Buffer = ShimBuffer // the whole run uses the WebView's Buffer, not Node's
  const out: string[] = []
  const list: [string, () => unknown][] = [
    ['shims', shimsCheck], ['ipc', ipcCheck],
    ['scheduler', Scheduler.selfCheck], ['tools', toolsSelfCheck], ['mcp', McpHub.selfCheck], ['conversation', Conversation.selfCheck], ['lyrics', lyricsSelfCheck], ['placement', placementSelfCheck],
    ['lyricsAnim', lyricsAnimSelfCheck], ['safety', safetySelfCheck], ['computer', computerSelfCheck], ['cli', cliSelfCheck], ['tasks', TaskManager.selfCheck], ['prompt', promptSelfCheck],
    ['registry', registrySelfCheck], ['settingsTools', settingsToolsSelfCheck], ['memory', memorySelfCheck], ['settings', settingsSelfCheck], ['trustUndoNudge', trustUndoNudgeSelfCheck],
    ['style', styleSelfCheck], ['weekly', weeklySelfCheck], ['eval', evalSelfCheck], ['secondScreen', secondScreenSelfCheck], ['boot', bootCheck],
  ]
  for (const [n, f] of list) { try { out.push(`${n}: ${await f()}`) } catch (e) { out.push(`${n}: FAIL ${e instanceof Error ? (e.stack ?? e.message) : e}`) } }
  return out
}
