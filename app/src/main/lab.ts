import { BrowserWindow, app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// `--lab <dir> [--lab-query "names=idle,wave&size=300"]`: renders the mascot QA sheet in a hidden window (no input,
// no focus), saves lab.png and the page's console output, then quits.
export async function runLab(dir: string, query: string) {
  mkdirSync(dir, { recursive: true })
  const log: string[] = []
  const win = new BrowserWindow({
    width: 1260, height: 900, show: false, frame: false, focusable: false, paintWhenInitiallyHidden: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  })
  win.webContents.on('console-message', (_e, level, message) => log.push(`[${level}] ${message}`))
  const hash = '#lab' + (query ? '?' + query : '')
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) await win.loadURL(`${dev}${hash}`)
  else await win.loadFile(join(__dirname, '../renderer/index.html'), { hash })
  let done: string | null = null
  for (let i = 0; i < 100 && done === null; i++) {
    done = await win.webContents.executeJavaScript('window.__labDone ?? null').catch(() => null)
    if (done === null) await new Promise(r => setTimeout(r, 100))
  }
  await new Promise(r => setTimeout(r, 300))
  const size = await win.webContents.executeJavaScript('({ w: document.querySelector("canvas")?.width ?? 0, h: document.querySelector("canvas")?.height ?? 0 })').catch(() => ({ w: 0, h: 0 }))
  win.setContentSize(Math.max(200, size.w), Math.max(200, size.h))
  await new Promise(r => setTimeout(r, 400))
  const img = await win.webContents.capturePage()
  writeFileSync(join(dir, 'lab.png'), img.toPNG())
  writeFileSync(join(dir, 'lab.log'), JSON.stringify({ done, log }, null, 2))
  app.quit()
}
