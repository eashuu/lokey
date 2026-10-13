import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

// `lokey --mock --shots <dir>`: README art. Drives the island through its zustand store (no OS input, no focus) with
// the renderer on the built-in mock bridge (fake media, clipboard, apps), so no personal data can end up in an image.
// Writes stills (dark and light) and timed frame sequences with an ffconcat list for the GIFs.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function runShots(win: BrowserWindow, dir: string, done: () => void) {
  const wc = win.webContents
  const js = <T = unknown>(code: string) => wc.executeJavaScript(code) as Promise<T>
  mkdirSync(dir, { recursive: true })
  const png = async () => (await wc.capturePage()).toPNG()
  const still = async (name: string) => writeFileSync(join(dir, `${name}.png`), await png())
  const open = (view: string) => js(`window.__island.getState().openMenu(${JSON.stringify(view)}, 'hover')`)
  const closeMenu = () => js('window.__island.getState().closeMenu()')
  const theme = (t: 'dark' | 'light') => js(`window.__demoBridge.settings.set({ appearance: { theme: ${JSON.stringify(t)} } })`)
  const tab = async (name: string, view: string, wait = 1100) => { await open(view); await sleep(wait); await still(name) }

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
