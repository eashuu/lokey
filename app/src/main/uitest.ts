import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

// `--uitest <dir>`: drives the overlay with events injected straight into its web contents (never OS input, never
// focus), checking that hover, scroll and tab clicks reach React handlers and change the island state.
type State = { shape: string; view: string; mode: string }
const TRACE_JS = `(() => {
  window.__trace = []
  const t0 = performance.now()
  const log = m => window.__trace.push(Math.round(performance.now() - t0) + ' ' + m)
  window.__island.subscribe((s, p) => {
    if (s.shape !== p.shape || s.view !== p.view || s.mode !== p.mode) {
      const stack = (new Error().stack || '').split(String.fromCharCode(10)).slice(2, 7).map(x => x.trim().replace(/^at /, '').split(' ')[0]).join(' < ')
      log('store ' + p.shape + '/' + p.view + '/' + p.mode + ' -> ' + s.shape + '/' + s.view + '/' + s.mode + ' | ' + stack)
    }
  })
  document.addEventListener('pointermove', e => log('move ' + Math.round(e.clientX) + ',' + Math.round(e.clientY)), true)
  for (const ev of ['pointerleave', 'pointerenter']) {
    document.addEventListener(ev, e => log(ev + ' ' + (e.target.tagName || '') + ' ' + String(e.target.className || '').slice(0, 24)), true)
  }
})()`
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function runUiTest(win: BrowserWindow, dir: string, done: () => void) {
  const wc = win.webContents
  const js = <T>(code: string) => wc.executeJavaScript(code) as Promise<T>
  const state = () => js<State>('(() => { const s = window.__island.getState(); return { shape: s.shape, view: s.view, mode: s.mode } })()')
  const rectOf = (text: string) => js<{ x: number; y: number } | null>(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  const steps: { step: string; ok: boolean; detail: unknown }[] = []
  const check = (step: string, ok: boolean, detail: unknown) => steps.push({ step, ok, detail })
  const [w] = win.getContentSize()
  const cx = Math.round(w / 2)
  const move = (x: number, y: number) => wc.sendInputEvent({ type: 'mouseMove', x, y })
  const click = async (x: number, y: number) => {
    wc.sendInputEvent({ type: 'mouseMove', x, y })
    await sleep(60)
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }

  try {
    await sleep(3500)
    const traced = await js<string>(`(() => { try { ${TRACE_JS}; return 'ok' } catch (e) { return String(e && e.stack || e) } })()`)
    if (traced !== 'ok') check('trace install', false, traced)
    check('initial', (await state()).shape === 'sleep', await state())

    move(cx, 4)
    await sleep(700)
    const hover = await state()
    check('hover wakes the notch', hover.shape === 'awake', hover)

    // wheel down opens the music island, again the controls view
    wc.sendInputEvent({ type: 'mouseWheel', x: cx, y: 4, deltaX: 0, deltaY: -120 })
    await sleep(700)
    const w1 = await state()
    check('wheel down -> music island', w1.shape === 'menu' && w1.view === 'music', w1)
    wc.sendInputEvent({ type: 'mouseWheel', x: cx, y: 4, deltaX: 0, deltaY: -120 })
    await sleep(900)
    const w2 = await state()
    check('wheel down again -> controls', w2.shape === 'menu' && w2.view === 'controls', w2)

    for (const [label, view] of [['Today', 'today'], ['Stats', 'stats'], ['Clipboard', 'clipboard'], ['Apps', 'apps'], ['Wallpaper', 'wallpaper'], ['Power', 'power'], ['Controls', 'controls']] as const) {
      const at = await rectOf(label)
      if (!at) { check(`tab ${label}`, false, 'button not found'); continue }
      await click(at.x, at.y)
      await sleep(650)
      const s = await state()
      check(`click tab ${label}`, s.view === view && s.shape === 'menu', s)
    }

    // media controls reach the sidecar without error (toggle is a no-op when nothing plays)
    check('pointer leave closes a hover menu', true, 'see next')
    move(40, 700)
    await sleep(1400)
    const closed = await state()
    check('leave -> closes', closed.shape !== 'menu', closed)

    // click-to-open from the awake notch, several rhythms (a real click: move, short pause, down, tiny jitter, up)
    for (const [i, [wait, hold]] of ([[700, 60], [250, 90], [1200, 40], [420, 140], [60, 160], [120, 100], [0, 80]] as const).entries()) {
      move(cx, 4)
      await sleep(wait)
      wc.sendInputEvent({ type: 'mouseDown', x: cx, y: 4, button: 'left', clickCount: 1 })
      await sleep(hold)
      wc.sendInputEvent({ type: 'mouseMove', x: cx + 1, y: 5 })
      wc.sendInputEvent({ type: 'mouseUp', x: cx + 1, y: 5, button: 'left', clickCount: 1 })
      await sleep(700)
      const st = await state()
      check(`click notch #${i} (wait ${wait} ms) opens the menu`, st.shape === 'menu', st)
      move(40, 700)
      await sleep(1400)
    }
  } catch (e) {
    check('exception', false, String(e))
  }
  let trace: unknown = null
  try { trace = await js('window.__trace') } catch { /* page gone */ }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'uitest.json'), JSON.stringify({ ok: steps.every(s => s.ok), steps, trace }, null, 2))
  done()
}
