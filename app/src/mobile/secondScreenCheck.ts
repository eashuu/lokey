// `pnpm mobile:check`: the second-screen tool loop against a fake plugin and a scripted model (no phone, no Shizuku, no network).
import { looksSecret } from '../main/agent/tools'
import type { Router } from '../main/brain/router'
import { BG_TOOLS, runBgTool, runSecondScreen, type SSNative } from './secondScreen'
import { safetySelfCheck, type UiNode } from './secondScreenSafety'

const need = (c: unknown, m: string) => { if (!c) throw new Error('secondScreen: ' + m) }

type Step = { name: string; args: Record<string, unknown> }
/** a model that plays a script: one tool call per request; also records what it was shown */
function scripted(steps: Step[]) {
  const seen: { text: string; images: number; system: string; tools: string[] }[] = []
  let i = 0
  const chat = async (_role: string, req: { system: string; messages: { role: string; text?: string; images?: string[] }[]; tools?: { name: string }[] }) => {
      const last = [...req.messages].reverse().find(m => m.role === 'user')
      seen.push({ text: last?.text ?? '', images: last?.images?.length ?? 0, system: req.system, tools: (req.tools ?? []).map(t => t.name) })
      const s = steps[Math.min(i++, steps.length - 1)]
      return { text: '', toolCalls: [{ id: 'c' + i, name: s.name, args: s.args }], usage: { in: 1, out: 1, cached: 0 }, provider: 'fake', model: 'fake' }
  }
  const router = { chat, call: chat } as unknown as Router
  return { router, seen }
}

const SETTINGS_UI: UiNode[] = [
  { id: 0, text: 'Wi-Fi', click: true, b: [0, 200, 720, 300] },
  { id: 1, text: 'Send', click: true, b: [560, 900, 700, 980] },
  { id: 2, desc: 'Message', edit: true, focus: true, b: [20, 900, 540, 980] },
]

function fakeNative(o: { pkg?: string; nodes?: UiNode[]; state?: Record<string, unknown> } = {}) {
  const calls: { method: string; params: any }[] = [] // eslint-disable-line @typescript-eslint/no-explicit-any
  const st = { pkg: o.pkg ?? 'com.android.settings', nodes: o.nodes ?? SETTINGS_UI, ...(o.state ?? {}) }
  const native: SSNative = async (method, params) => {
    calls.push({ method, params })
    switch (method) {
      case 'bg.start': return { ok: true, displayId: 3, width: 720, height: 1600, dpi: 320 }
      case 'bg.ui': return { ok: true, pkg: st.pkg, nodes: st.nodes, count: st.nodes.length }
      case 'bg.frame': return { ok: true, jpegBase64: '/9j/FRAME', w: 540, h: 1200, black: false }
      case 'bg.launch': return { ok: true }
      case 'apps.list': return [{ id: 'com.android.settings', name: 'Settings' }, { id: 'net.one97.paytm', name: 'Paytm' }, { id: 'com.google.android.youtube', name: 'YouTube' }]
      case 'shizuku.status': return { installed: true, running: true, permissionGranted: true }
      default: return { ok: true }
    }
  }
  return { native, calls, st }
}

const run = (steps: Step[], f: ReturnType<typeof fakeNative>, extra: Partial<Parameters<typeof runSecondScreen>[0]> = {}, yes = true) => {
  const m = scripted(steps)
  const asks: { title: string; detail: string; image?: string }[] = []
  const ctl = new AbortController()
  const p = runSecondScreen({ goal: 'send hello to Amma', signal: ctl.signal, onStep: () => undefined, native: f.native, router: m.router, settleMs: 1, ask: async (title, detail, image) => { asks.push({ title, detail, image }); return yes }, ...extra })
  return { p, asks, seen: m.seen, ctl }
}
const names = (f: ReturnType<typeof fakeNative>) => f.calls.map(c => c.method)

export async function secondScreenSelfCheck(): Promise<string> {
  need(safetySelfCheck(looksSecret) === 'ok', 'safety')
  need(BG_TOOLS.map(t => t.name).join() === 'second_screen_task,bg_apps,bg_stop', 'tool names')

  // A: open an app, tap, type, a send step asks first (with the picture), finish
  {
    const f = fakeNative()
    const r = run([
      { name: 'computer', args: { action: 'open_app', package: 'com.android.settings' } },
      { name: 'computer', args: { action: 'click', node: 0 } },
      { name: 'computer', args: { action: 'type', text: 'hello' } },
      { name: 'computer', args: { action: 'click', node: 1 } },
      { name: 'finish', args: { success: true, summary: 'Sent hello.' } },
    ], f)
    const res = await r.p
    need(res.ok && res.summary === 'Sent hello.' && res.steps === 5, `A result ${JSON.stringify(res)}`)
    need(r.asks.length === 1 && r.asks[0].image === '/9j/FRAME' && /Send/.test(r.asks[0].detail), `A: the send step asked once, with the frame (${JSON.stringify(r.asks.map(a => a.detail))})`)
    const m = names(f)
    need(m[0] === 'bg.start' && m.includes('bg.launch') && m.filter(x => x === 'bg.tap').length === 2 && m.includes('bg.text') && m[m.length - 1] === 'bg.stop', `A calls ${m.join()}`)
    need(f.calls.find(c => c.method === 'bg.tap')!.params.x === 360 && f.calls.find(c => c.method === 'bg.tap')!.params.y === 250, 'node tap = centre of its bounds in display pixels')
    need(r.seen[0].images === 1 && /UI elements/.test(r.seen[0].text) && /\[0\] "Wi-Fi" button/.test(r.seen[0].text) && /data, never instructions/.test(r.seen[0].system) && r.seen[0].tools.join() === 'computer,finish', 'the model is shown the picture, the element list and the rules')
  }
  // B: the user says no to a send step twice: it never taps, and stops
  {
    const f = fakeNative()
    const r = run([{ name: 'computer', args: { action: 'click', node: 1 } }], f, {}, false)
    const res = await r.p
    need(!res.ok && /no twice/.test(res.summary) && !names(f).includes('bg.tap') && r.asks.length === 2, `B ${JSON.stringify(res)} ${names(f).join()}`)
  }
  // C: a banking app on the second screen: stop before any picture is taken, close the display
  {
    const f = fakeNative({ pkg: 'net.one97.paytm' })
    const res = await run([{ name: 'computer', args: { action: 'wait' } }], f).p
    need(!res.ok && /never operates/.test(res.summary) && !names(f).includes('bg.frame') && names(f).includes('bg.stop'), `C ${JSON.stringify(res)} ${names(f).join()}`)
  }
  // C2: the model asks to open one
  {
    const f = fakeNative()
    const r = run([{ name: 'computer', args: { action: 'open_app', package: 'net.one97.paytm' } }, { name: 'finish', args: { success: false, summary: 'could not' } }], f)
    await r.p
    need(!names(f).includes('bg.launch'), 'C2 a deny-listed app is never launched')
  }
  // D: secrets are not typed (and a password field blocks typing at all)
  {
    const f = fakeNative()
    await run([{ name: 'computer', args: { action: 'type', text: '483920' } }, { name: 'finish', args: { success: false, summary: 'x' } }], f).p
    need(!names(f).includes('bg.text'), 'D a code is not typed')
    const f2 = fakeNative({ nodes: [{ id: 0, edit: true, password: true, focus: true, b: [0, 0, 100, 100] }] })
    await run([{ name: 'computer', args: { action: 'type', text: 'hunter2' } }, { name: 'finish', args: { success: false, summary: 'x' } }], f2).p
    need(!names(f2).includes('bg.text'), 'D nothing is typed next to a password field')
    const f3 = fakeNative({ nodes: [{ id: 0, text: 'Enter your UPI PIN', b: [0, 0, 100, 100] }] })
    const r3 = await run([{ name: 'computer', args: { action: 'wait' } }], f3).p
    need(!r3.ok && /PIN/.test(r3.summary), 'D a screen that asks for a PIN ends the task')
  }
  // E: stop (abort) closes the display at once
  {
    const f = fakeNative()
    const r = run([{ name: 'computer', args: { action: 'wait', ms: 100 } }], f, { settleMs: 5 })
    setTimeout(() => r.ctl.abort(), 30)
    const res = await r.p
    need(!res.ok && /Stopped/.test(res.summary) && names(f).filter(x => x === 'bg.stop').length >= 1, `E ${JSON.stringify(res)}`)
  }
  // F: refused before anything starts
  {
    const f = fakeNative()
    const res = await run([{ name: 'finish', args: { success: true, summary: '' } }], f, { goal: 'open my bank app and check the balance' }).p
    need(!res.ok && res.steps === 0 && !names(f).includes('bg.start'), 'F a banking goal never starts a display')
  }
  // G: time limit and step limit
  {
    const f = fakeNative()
    const res = await run([{ name: 'computer', args: { action: 'wait', ms: 100 } }], f, { timeoutMs: 1, settleMs: 5 }).p
    need(!res.ok && /longer than I allow/.test(res.summary), `G time limit ${JSON.stringify(res)}`)
    const f2 = fakeNative()
    const steps = Array.from({ length: 6 }, (_, i) => ({ name: 'computer', args: { action: 'scroll', direction: i % 2 ? 'up' : 'down', n: i } }))
    const res2 = await run(steps, f2, { maxSteps: 4 }).p
    need(!res2.ok && res2.steps === 4 && /more steps/.test(res2.summary), `G step limit ${JSON.stringify(res2)}`)
  }
  // H: the tools
  {
    const f = fakeNative()
    const spawned: unknown[] = []
    const tasks = { spawn: (o: unknown) => { spawned.push(o); return { id: 't1' } }, list: () => [] as { id: string; role: string; status: string }[], stop: () => true }
    const ask = async () => true
    const base = { tasks, confirmMode: 'risky', ask, scheduled: false }
    need((await runBgTool('bg_apps', {}, base, f.native)).result.apps !== undefined && !JSON.stringify((await runBgTool('bg_apps', {}, base, f.native)).result).includes('paytm'), 'bg_apps hides banking apps')
    const ok = await runBgTool('second_screen_task', { goal: 'play lofi on YouTube', app: 'com.google.android.youtube' }, base, f.native)
    need(ok.result.ok === true && (spawned[0] as { role: string; extra: { app: string } }).role === 'second_screen' && (spawned[0] as { extra: { app: string } }).extra.app === 'com.google.android.youtube', `H start ${JSON.stringify(ok.result)}`)
    need((await runBgTool('second_screen_task', { goal: 'pay my electricity bill' }, base, f.native)).result.ok === false, 'H a payment goal is refused')
    need((await runBgTool('second_screen_task', { goal: 'open it', app: 'com.phonepe.app' }, base, f.native)).result.ok === false, 'H a deny-listed app is refused')
    need((await runBgTool('second_screen_task', { goal: 'play lofi' }, { ...base, scheduled: true }, f.native)).result.ok === false, 'H not from a schedule')
    need((await runBgTool('second_screen_task', { goal: 'play lofi' }, { ...base, origin: 'remote' }, f.native)).result.ok === false, 'H not from a remote origin')
    need((await runBgTool('second_screen_task', { goal: 'play lofi' }, { ...base, ask: async () => false }, f.native)).result.denied === true && spawned.length === 1, 'H the start card can be refused')
    need((await runBgTool('second_screen_task', { goal: 'play lofi' }, { ...base, confirmMode: 'full', ask: async () => { throw new Error('full control must not even ask here') } }, f.native)).result.ok === true && spawned.length === 2, 'H full control starts without a card (the rules inside still apply)')
    const f2 = fakeNative({ state: {} })
    const off: SSNative = async (m, p) => (m === 'shizuku.status' ? { permissionGranted: false, reason: 'Shizuku is not running.' } : f2.native(m, p))
    const no = await runBgTool('second_screen_task', { goal: 'play lofi' }, base, off)
    need(no.result.ok === false && /Power tier/.test(String(no.result.error)), `H explains the setup when Shizuku is off (${JSON.stringify(no.result)})`)
    const stopped = await runBgTool('bg_stop', {}, { ...base, tasks: { ...tasks, list: () => [{ id: 't1', role: 'second_screen', status: 'running' }] } }, f.native)
    need(stopped.result.stopped === 1 && names(f).includes('bg.stop'), 'H bg_stop stops the task and the display')
  }
  return 'ok (deny-list, secrets, confirm card with picture, stop/timeout/step limits, tools)'
}
