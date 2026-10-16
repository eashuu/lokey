import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { ARM_MS, askHeight, askView, keyAction, mayAllow, remainingMs, type AskState } from '@shared/ask'
import { defaultSettings } from '@shared/bridge'
import { onSomeDisplay } from './askIsland'
import { McpHub } from './mcp'
import { _testHooks, answerConfirm, answerCurrent, answerLocal, cardOpen, confirm, confirmEvents, handoff, inputGate, islandGone, setIslandRoute, type IslandRoute } from './permissions'
import { _setRunnerForTest, execute } from './tools'
import { settings } from '../settings'

// `--selfcheck` for asks inside the island: the pure card model (copy, height, arming, keys), the route and the queue in permissions.ts against a
// fake island (answer protocol parity with the window path, expiry denies, nothing approves by itself, fallbacks to the window), the sidecar input
// gate, and the takeover hand-off in execute(). No window is opened, no input is sent.
export async function askSelfCheck(): Promise<string> {
  let n = 0
  const ok = (c: boolean, m: string) => { if (!c) throw new Error('ask: ' + m); n++ }
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  // ---- the card model
  const a = askView({ title: 'Send: Message Amma "on my way"', detail: 'WhatsApp. First time sending to +91 98xxx. This cannot be undone.', cls: 'send', src: 'a web page' })
  ok(askView({ title: 'Run: do it now', detail: '', cls: 'run' }).title === 'Do it now', 'a stripped title starts with a capital')
  ok(a.chip === 'Send' && a.title === 'Message Amma "on my way"' && a.typed && a.allow === 'Allow' && a.deny === 'Deny' && a.src === 'a web page', 'typed card: chip says the kind once, title loses the repeated prefix')
  ok(askView({ title: 'Open Calculator', detail: 'x', cls: undefined }).chip === 'Lokey wants to' && askView({ title: 'Open Calculator', detail: '' }).title === 'Open Calculator', 'plain card keeps its title')
  const src = askView({ title: 't', detail: 'This address came from a web page, not from you. Open https://x.example', src: 'a web page' })
  ok(!src.detail.includes('web page') && src.detail.includes('https://x.example') && src.src === 'a web page', 'the source gets its own line and is not repeated in the detail')
  const h = askView({ title: 'This step is yours', detail: 'Login screen', kind: 'handoff' })
  ok(h.handoff && h.allow === "I'm done" && h.deny === 'Skip' && h.chip === 'Your turn', 'hand-off card: I\'m done / Skip')
  ok(askView({ title: 'x'.repeat(500), detail: 'y'.repeat(2000), src: 'z'.repeat(500) }).title.length <= 140 && askView({ title: 'x', detail: 'y'.repeat(2000) }).detail.length <= 600, 'long text is clipped')
  const small = askHeight(askView({ title: 'Open it', detail: '' })), big = askHeight(askView({ title: 'x'.repeat(100), detail: 'y'.repeat(900), src: 'a mail' }))
  ok(small < big && small >= 90 && big <= 260, 'the card grows with its text and stays bounded')
  ok(remainingMs(1000, 400) === 600 && remainingMs(1000, 2000) === 0, 'countdown never goes negative')

  // ---- keys: only Esc answers, and only with Deny; Enter alone does nothing
  const k = (key: string, o: object = {}) => keyAction({ key, ...o }, true)
  ok(k('Escape') === 'deny' && keyAction({ key: 'Escape' }, false) === null && k('Enter') === null && k(' ') === null && k('y') === null && k('Escape', { repeat: true }) === null && k('Escape', { ctrlKey: true }) === null, 'Esc denies when the card has focus; no other key answers; stray typing cannot allow')

  // ---- arming
  const s0: AskState = { cur: { id: 'a', title: 't', detail: '', tool: 'x', timeoutMs: 30000, expiresAt: 10_000 }, more: 0 }
  ok(!mayAllow(s0, 'a', 1000, 1000 + ARM_MS - 1) && mayAllow(s0, 'a', 1000, 1000 + ARM_MS) && !mayAllow(s0, 'b', 0, 5000) && !mayAllow(s0, 'a', 0, 10_000) && !mayAllow({ cur: null, more: 0 }, 'a', 0, 5000), 'Allow needs an armed, current, unexpired card')

  // ---- display topology
  const disp = [{ x: 0, y: 0, width: 1920, height: 1080 }]
  ok(onSomeDisplay({ x: 360, y: 0, width: 1200, height: 760 }, disp) && !onSomeDisplay({ x: 1920, y: 0, width: 1200, height: 760 }, disp) && !onSomeDisplay({ x: 0, y: 0, width: 10, height: 10 }, []), 'an island outside every display is not usable')

  // ---- the route, the queue and the answer protocol (fake island, fake window)
  const saved = settings.value.agent.confirmIn
  const pushes: AskState[] = []
  let usable = true, ack = true
  const route: IslandRoute = { usable: () => usable, push: s => { pushes.push(structuredClone(s)) }, shown: async () => ack }
  let windows = 0
  const fakeWin = () => { windows++; const e = new EventEmitter() as unknown as BrowserWindow; (e as unknown as { webContents: { send: () => void } }).webContents = { send: () => undefined }; (e as unknown as { isDestroyed: () => boolean }).isDestroyed = () => false; return e }
  _testHooks({ askMs: 400, opener: fakeWin })
  setIslandRoute(route)
  settings.value.agent.confirmIn = 'island'
  const evs: string[] = []
  const idOf = () => evs.filter(e => e.startsWith('req:')).at(-1)!.slice(4)
  const onReq = (r: { id: string }) => evs.push('req:' + r.id), onDone = (id: string, o: boolean) => evs.push(`done:${id}:${o}`)
  confirmEvents.on('req', onReq); confirmEvents.on('done', onDone)
  try {
    // allow: not before it is armed, then yes
    const p1 = confirm('Open Calculator', 'x', 'open_app')
    await sleep(5)
    const id1 = pushes.at(-1)?.cur?.id ?? ''
    ok(id1 !== '' && windows === 0 && cardOpen() && pushes.at(-1)!.cur!.expiresAt > Date.now(), 'the card goes to the island, not to a window, with an expiry')
    ok(!answerLocal(id1, true) && cardOpen(), 'an Allow at once is ignored')
    ok(answerLocal('nope', false) === false && cardOpen(), 'an answer for another id does nothing')
    ok(answerLocal(id1, true, Date.now() + ARM_MS + 1) && (await p1) === true, 'Allow after arming resolves true')
    ok(pushes.at(-1)!.cur === null && !cardOpen(), 'the island is given back when the card is answered')
    ok(evs.includes('req:' + id1) && evs.includes(`done:${id1}:true`), 'Lokey Link sees the same req and done events')

    // deny is immediate; the old entry point (phone, window) answers the very same card
    const p2 = confirm('Delete', 'x', 'delete_file', undefined, 'delete')
    await sleep(5)
    const id2 = pushes.at(-1)!.cur!.id
    ok(pushes.at(-1)!.cur!.cls === 'delete', 'the policy card kind travels with the request')
    ok(answerLocal(id2, false) && (await p2) === false, 'Deny counts at once')
    const p3 = confirm('Send', 'x', 'send_message')
    await sleep(5)
    ok(answerConfirm(pushes.at(-1)!.cur!.id, true) && (await p3) === true, 'answerConfirm(id, ok) (phone / window path) answers an island card too')

    // expiry denies, never approves
    const p4 = confirm('Run', 'x', 'run_command')
    ok((await p4) === false && !cardOpen(), 'a card that is not answered is denied when it expires')
    const p5 = confirm('Run', 'x', 'run_command')
    await sleep(5)
    islandGone()
    ok((await p5) === false, 'losing the island page denies the card on it')

    // queue: one at a time, with a count, and no empty frame between two cards
    pushes.length = 0
    const q = [confirm('one', 'x', 't'), confirm('two', 'x', 't'), confirm('three', 'x', 't')]
    await sleep(5)
    ok(pushes.at(-1)!.cur!.title === 'one' && pushes.at(-1)!.more === 2, 'three requests: the first shows with "+2 more"')
    ok(answerLocal(pushes.at(-1)!.cur!.id, false) && (await q[0]) === false, 'the first of the queue is answered')
    await sleep(5)
    ok(pushes.at(-1)!.cur!.title === 'two' && pushes.at(-1)!.more === 1 && !pushes.slice(0, -1).some((s, i) => i > 0 && s.cur === null), 'the next card takes over without an empty frame')
    answerLocal(pushes.at(-1)!.cur!.id, false); await sleep(5); answerLocal(pushes.at(-1)!.cur!.id, false)
    ok((await q[1]) === false && (await q[2]) === false && pushes.at(-1)!.cur === null, 'the queue empties and the island is released')

    // chords act on the card on screen only, with the same arming
    const p6 = confirm('Open', 'x', 'open_app')
    await sleep(5)
    ok(answerCurrent(true) === false && answerCurrent(false) === true && (await p6) === false, 'the global chords: Allow is held back while unarmed, Deny works')
    ok(answerCurrent(true) === false && answerCurrent(false) === false, 'with no card the chords do nothing')

    // the assistant's own input is shut off while a request waits
    ok(inputGate('input.mouse') === null && inputGate('input.keys') === null, 'no card: input passes')
    const p7 = confirm('Open', 'x', 'open_app')
    await sleep(5)
    ok(inputGate('input.mouse') !== null && inputGate('input.keys') !== null && inputGate('input.chord') !== null && inputGate('media.next') === null, 'with a card open the assistant cannot click or press keys (so it cannot answer for you)')
    answerLocal(pushes.at(-1)!.cur!.id, false); await p7

    // hand-off card
    const p8 = handoff('Your turn', 'Login screen', 'type_text')
    await sleep(5)
    const c8 = pushes.at(-1)!.cur!
    ok(c8.kind === 'handoff' && c8.timeoutMs === 400, 'a hand-off card is marked as one')
    answerLocal(c8.id, true, Date.now() + ARM_MS + 1)
    ok((await p8) === true, '"I\'m done" answers true')

    // fallbacks to the old window
    windows = 0
    usable = false
    const p9 = confirm('Open', 'x', 'open_app')
    await sleep(5)
    ok(windows === 1 && pushes.at(-1)!.cur === null, 'island not usable: the window shows the card')
    ok(answerConfirm(idOf(), true) && (await p9) === true, 'the window path answers with the same (id, ok)')
    usable = true; windows = 0
    settings.value.agent.confirmIn = 'window'
    const p10 = confirm('Open', 'x', 'open_app')
    await sleep(5)
    ok(windows === 1, 'confirmIn = window keeps the window')
    answerConfirm(idOf(), false); await p10
    settings.value.agent.confirmIn = 'island'; windows = 0
    const p11 = confirm('Second screen', 'x', 'second_screen', 'AAAA')
    await sleep(5)
    ok(windows === 1, 'a card with a picture keeps the window')
    answerConfirm(idOf(), false); await p11
    windows = 0; ack = false
    const p12 = confirm('Open', 'x', 'open_app')
    await sleep(20)
    ok(windows === 1, 'the island page never confirms: the window takes over')
    answerConfirm(idOf(), false); await p12
    ack = true
  } finally {
    confirmEvents.off('req', onReq); confirmEvents.off('done', onDone)
    setIslandRoute(null); _testHooks({ askMs: null, opener: null })
    settings.value.agent.confirmIn = saved
  }

  // ---- settings defaults
  ok(defaultSettings.agent.confirmIn === 'island' && defaultSettings.agent.askSound === false && !!defaultSettings.agent.allowKey && defaultSettings.agent.allowKey !== defaultSettings.agent.denyKey, 'defaults: island, no sound, two different chords')

  // ---- takeover hand-off inside execute()
  {
    let title = 'Sign in to your account', handoffs = 0, ran = 0
    const sidecar = { call: async (m: string) => (m === 'foreground.get' ? { exe: 'chrome.exe', title } : m === 'text.focusRect' ? { password: false } : null) } as never
    _setRunnerForTest((async () => { ran++; return { result: { ok: true } } }) as never)
    const mk = (answer: boolean | null, after?: string) => ({ sidecar, scheduler: {} as never, abilities: [], hub: new McpHub(), confirmMode: 'full' as const, ask: async () => true, ...(answer === null ? {} : { handoff: async () => { handoffs++; if (after) title = after; return answer } }) })
    try {
      let r = await execute('type_text', { text: 'x' }, mk(null))
      ok((r.result as { takeover?: boolean }).takeover === true && handoffs === 0, 'no hand-off available: a login screen is refused as before')
      r = await execute('type_text', { text: 'x' }, mk(false))
      ok((r.result as { takeover?: boolean }).takeover === true && handoffs === 1 && ran === 0, 'Skip: refused')
      r = await execute('type_text', { text: 'x' }, mk(true))
      ok((r.result as { takeover?: boolean }).takeover === true && handoffs === 2 && ran === 0, '"I\'m done" while still on the login screen: refused again, nothing typed')
      r = await execute('type_text', { text: 'x' }, mk(true, 'Inbox - Mail'))
      ok((r.result as { ok?: boolean }).ok === true && ran === 1, 'after the person logged in the action goes on')
      title = 'Sign in to your account'
      r = await execute('type_text', { text: 'x' }, { ...mk(true), scheduled: true })
      ok((r.result as { takeover?: boolean }).takeover === true, 'an unattended run never waits for a person')
    } finally { _setRunnerForTest(null) }
  }
  return `ask ok (${n} checks)`
}
