import { ipcMain, type BrowserWindow } from 'electron'
import { LIFETIME_MS, Overlay, overlayLog, READY_TIMEOUT_MS } from './overlays'

// `--selfcheck`: the caption bar's lifetimes. Fake windows and a fake clock, no screen: a notice clears by itself, nothing stays up without a
// reason, a page that never answers is destroyed and retried once, and every kind of message ends with the window closed.
export function overlaySelfCheck(): string {
  let n = 0
  const problems: string[] = []
  const ok = (c: boolean, m: string) => { n++; if (!c) problems.push(m) }
  let now = 0
  const timers: { id: number; at: number; fn: () => void }[] = []
  let seq = 0
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const t = timers[0]
      if (!t || t.at > end) break
      timers.shift(); now = t.at; t.fn()
    }
    now = end
  }
  const wins: { destroyed: boolean; visible: boolean; sent: unknown[]; wc: object; win: BrowserWindow }[] = []
  const hooks = {
    set: (fn: () => void, ms: number) => { const id = ++seq; timers.push({ id, at: now + ms, fn }); return id },
    clear: (h: unknown) => { const i = timers.findIndex(t => t.id === h); if (i >= 0) timers.splice(i, 1) },
    make: () => {
      const rec = { destroyed: false, visible: false, sent: [] as unknown[], wc: {} as object, win: null as unknown as BrowserWindow }
      rec.wc = { send: (_c: string, m: unknown) => rec.sent.push(m) }
      rec.win = { webContents: rec.wc, isDestroyed: () => rec.destroyed, isVisible: () => rec.visible, showInactive: () => { rec.visible = true }, setIgnoreMouseEvents: () => undefined, setAlwaysOnTop: () => undefined, on: () => undefined, destroy: () => { rec.destroyed = true } } as unknown as BrowserWindow
      wins.push(rec); return rec.win
    },
  }
  const logs: string[] = []
  const prevLog = overlayLog.fn
  overlayLog.fn = m => logs.push(m)
  try {
    const mk = () => new Overlay('caption', () => ({ x: 0, y: 0, width: 10, height: 10 }), 'floating', true, hooks)
    const ready = () => { const w = wins[wins.length - 1]; ipcMain.emit('lokey:ov:ready', { sender: w.wc }, 'caption') }
    const open = () => wins.length > 0 && !wins[wins.length - 1].destroyed

    // a notice clears by itself (6 s; an error 10 s)
    {
      wins.length = 0; const o = mk(); o.send({ kind: 'notice', text: 'x', tone: 'info' }); ready()
      ok(open() && wins[0].sent.length === 1 && wins[0].visible, 'a notice opens the bar and is delivered once the page is ready')
      advance(LIFETIME_MS.notice - 100); ok(open(), 'a notice is still up just before its time')
      advance(200); ok(!open(), 'a notice goes away by itself after 6 s')
      o.send({ kind: 'notice', text: 'x', tone: 'error' }); ready(); advance(LIFETIME_MS.notice + 200); ok(open(), 'an error stays longer than a notice')
      advance(LIFETIME_MS.error); ok(!open(), 'an error goes away by itself after 10 s')
    }
    // what was said and answered: a missed clear is caught by the watchdog 15 s after the last message, and streaming keeps it alive
    {
      wins.length = 0; const o = mk(); o.send({ kind: 'said', text: 'open' }); ready(); advance(10_000); o.send({ kind: 'said', text: 'open chrome' }); advance(10_000)
      ok(open(), 'each new message restarts the 15 s watchdog'); advance(6000); ok(!open(), 'a said/reply caption nobody clears is destroyed 15 s after the last message')
    }
    // a hold (the "Lokey is controlling" line) stays while its owner repeats it, and is gone when the repeats stop
    {
      wins.length = 0; const o = mk(); o.send({ kind: 'hold', text: 'controlling' }); ready()
      for (let i = 0; i < 10; i++) { advance(5000); o.send({ kind: 'hold', text: 'controlling' }) }
      ok(open(), 'a hold that is repeated stays far longer than 15 s'); advance(LIFETIME_MS.hold + 100); ok(!open(), 'a hold nobody repeats is destroyed after 60 s')
    }
    // clear: faded and closed
    {
      wins.length = 0; const o = mk(); o.send({ kind: 'reply', text: 'done' }); ready(); o.send({ kind: 'clear' }); ok(open(), 'clear leaves the window to fade')
      o.closeSoon(700); advance(800); ok(!open(), 'clear followed by closeSoon closes the window')
    }
    {
      wins.length = 0; const o = mk(); o.send({ kind: 'reply', text: 'done' }); ready(); o.send({ kind: 'clear' }); advance(LIFETIME_MS.clear + 100)
      ok(!open(), 'a clear that is never followed by a close still closes the window within 4 s')
    }
    // a page that never reports ready: destroyed after 3 s, opened once more with the same message, then given up
    {
      wins.length = 0; logs.length = 0; const o = mk(); o.send({ kind: 'said', text: 'hello' })
      advance(READY_TIMEOUT_MS + 50); ok(wins.length === 2 && wins[0].destroyed && !wins[1].destroyed, 'a page that never answers is destroyed and a second one is opened')
      ok(logs.some(l => /caption overlay not ready/.test(l)), 'main.log gets "caption overlay not ready"')
      ready(); ok(wins[1].sent.length === 1 && wins[1].visible, 'the retry delivers the message that was waiting')
      advance(LIFETIME_MS.said + 100); ok(!open(), 'and it closes by itself like any other')
    }
    {
      wins.length = 0; logs.length = 0; const o = mk(); o.send({ kind: 'notice', text: 'hello', tone: 'info' })
      advance(READY_TIMEOUT_MS + 50); advance(READY_TIMEOUT_MS + 50)
      ok(wins.length === 2 && wins.every(w => w.destroyed) && logs.length === 2, 'after the second silent page it gives up (no endless window loop) and logs both')
    }
    // every kind of path ends with the window closed
    const paths: [string, object[]][] = [
      ['live voice', [{ kind: 'said', text: 'a' }, { kind: 'reply', text: 'b' }, { kind: 'clear' }]], ['typed', [{ kind: 'said', text: 'a' }, { kind: 'reply', text: 'b' }]],
      ['degraded', [{ kind: 'said', text: 'a' }, { kind: 'reply', text: 'b' }]], ['error', [{ kind: 'notice', text: 'e', tone: 'error' }]], ['cancel', [{ kind: 'said', text: 'a' }, { kind: 'clear' }]],
      ['stop all', [{ kind: 'hold', text: 'c' }, { kind: 'notice', text: 'Stopped everything.', tone: 'info' }]], ['parked job notice', [{ kind: 'notice', text: 'Waiting: Gemini Flash hit its daily limit.', tone: 'info' }]],
    ]
    for (const [name, msgs] of paths) {
      wins.length = 0; const o = mk(); msgs.forEach((m, i) => { o.send(m); if (i === 0) ready() }); advance(75_000)
      ok(!open(), name + ': the caption bar is closed in the end')
    }
  } finally { overlayLog.fn = prevLog }
  if (problems.length) throw new Error('overlays: ' + problems.join(' | '))
  return `overlays ok (${n} checks)`
}
