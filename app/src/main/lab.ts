import { BrowserWindow, app, screen } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// `--lab <dir> [--lab-page <page>] [--lab-query "k=v&..."]`: renders one of the renderer's QA pages in a hidden window
// (no input, no focus), saves lab.png (or a frame sequence for the reel page) and the page's console output, then quits.
// Pages: lab (mascot pose sheet, glow checks), reel (mascot animation frames), mock (README backdrops), settings, main, ...
export async function runLab(dir: string, query: string, page = 'lab') {
  mkdirSync(dir, { recursive: true })
  const log: string[] = []
  const big = screen.getPrimaryDisplay().bounds
  const win = new BrowserWindow({
    width: page === 'lab' || page === 'reel' ? 1260 : page === 'mock' ? big.width : 1000, height: page === 'lab' || page === 'reel' ? 900 : page === 'mock' ? big.height : 760,
    useContentSize: true, show: false, frame: false, focusable: false, paintWhenInitiallyHidden: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  })
  win.webContents.on('console-message', (_e, level, message) => log.push(`[${level}] ${message}`))
  const hash = '#' + page + (query ? '?' + query : '')
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) await win.loadURL(`${dev}${hash}`)
  else await win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  const waits = ['lab', 'reel', 'mock'].includes(page)
  let done: string | null = waits ? null : '[]'
  if (!waits) await new Promise(r => setTimeout(r, 2500))
  for (let i = 0; i < 150 && done === null; i++) {
    done = await win.webContents.executeJavaScript('window.__labDone ?? null').catch(() => null)
    if (done === null) await new Promise(r => setTimeout(r, 100))
  }
  await new Promise(r => setTimeout(r, 300))
  if (process.env.LOKEY_LAB_EVAL) log.push('eval: ' + JSON.stringify(await win.webContents.executeJavaScript(process.env.LOKEY_LAB_EVAL).catch(e => String(e))))

  const save = (name: string, dataUrl: string) => writeFileSync(join(dir, name), Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'))
  if (page === 'reel') {
    const total: number = await win.webContents.executeJavaScript('window.__reel?.total ?? 0')
    mkdirSync(join(dir, 'frames'), { recursive: true })
    for (let i = 0; i < total; i++) save(`frames/${String(i).padStart(4, '0')}.png`, await win.webContents.executeJavaScript(`window.__reel.frame(${i})`))
    log.push(`frames: ${total}`)
  } else {
    const png: string | null = await win.webContents.executeJavaScript('window.__labPng ?? null').catch(() => null)
    if (png) save('lab.png', png)
    else {
      const size = await win.webContents.executeJavaScript('({ w: document.querySelector("canvas")?.width ?? 0, h: document.querySelector("canvas")?.height ?? 0 })').catch(() => ({ w: 0, h: 0 }))
      if (page === 'lab') win.setContentSize(Math.max(200, size.w), Math.max(200, size.h))
      await new Promise(r => setTimeout(r, 400))
      writeFileSync(join(dir, 'lab.png'), (await win.webContents.capturePage()).toPNG())
    }
  }
  writeFileSync(join(dir, 'lab.log'), JSON.stringify({ done, log }, null, 2))
  app.quit()
}
