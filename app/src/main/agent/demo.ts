import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Agent } from './agent'
import { screen } from 'electron'
import { glowCapture } from '../effects'
import { captionBar, dictationBar, lassoCanvas } from './overlays'
import { Lasso } from './lasso'

// `--demo <name> [--capture <dir>]`: replays one of the reference scenarios with scripted text (no microphone, no
// network, no apps launched) so the whole visual chain can be seen and screenshotted: island held/awake shapes, the
// mascot, the caption bar and the edge glow. Overlays are click-through and never take focus.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function stream(agent: Agent, text: string, label: 'said' | 'reply', per = 150) {
  const words = text.split(' ')
  for (let i = 1; i <= words.length; i++) {
    agent.caption(label, words.slice(0, i).join(' '))
    agent.emit2(label === 'said' ? { type: 'said', text: words.slice(0, i).join(' '), final: i === words.length } : { type: 'reply', text: words.slice(0, i).join(' '), final: false })
    await sleep(per)
  }
}

/**
 * README GIFs: while the scenario runs, grabs every visible layer (island, caption bar, dictation, lasso, edge glow)
 * as fast as the machine allows, with a shared clock. `meta.json` records where each layer sits on screen (device
 * pixels) so scripts/readme-art.sh can composite them over a backdrop.
 */
function startRecorder(dir: string, overlay: BrowserWindow | null) {
  mkdirSync(dir, { recursive: true })
  const d = screen.getPrimaryDisplay()
  const k = d.scaleFactor
  const wa = d.workArea
  const ob = overlay?.getBounds()
  const layers: Record<string, { x: number; y: number }> = {
    island: { x: Math.round((ob?.x ?? 0) * k), y: Math.round((ob?.y ?? 0) * k) },
    caption: { x: Math.round((wa.x + Math.round((wa.width - Math.min(860, wa.width)) / 2)) * k), y: Math.round((wa.y + wa.height - 210 + 6) * k) },
    dictation: { x: 0, y: 0 }, lasso: { x: 0, y: 0 }, glow: { x: 0, y: 0 },
  }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ width: Math.round(d.bounds.width * k), height: Math.round(d.bounds.height * k), layers }))
  for (const name of Object.keys(layers)) mkdirSync(join(dir, name), { recursive: true })
  const stamps: number[] = []
  const t0 = Date.now()
  let stop = false
  const loop = (async () => {
    for (let i = 0; !stop; i++) {
      const id = String(i).padStart(4, '0')
      stamps.push(Date.now() - t0)
      const grabs: [string, Promise<Electron.NativeImage | null>][] = [
        ['island', overlay ? overlay.webContents.capturePage().catch(() => null) : Promise.resolve(null)],
        ['caption', captionBar.capture().catch(() => null)], ['dictation', dictationBar.capture().catch(() => null)],
        ['lasso', lassoCanvas.capture().catch(() => null)], ['glow', glowCapture().catch(() => null)],
      ]
      for (const [name, p] of grabs) { const img = await p; if (img && !img.isEmpty()) writeFileSync(join(dir, name, `${id}.png`), img.toPNG()) }
    }
  })()
  return async () => {
    stop = true
    await loop
    writeFileSync(join(dir, 'stamps.json'), JSON.stringify(stamps))
  }
}

export async function runDemo(name: string, agent: Agent, overlay: BrowserWindow | null, captureDir: string | null, recordDir: string | null = null) {
  agent.demo = true
  let n = 0
  const stopRecording = recordDir ? startRecorder(recordDir, overlay) : null
  const snap = async (tag: string) => {
    if (!captureDir) return
    mkdirSync(captureDir, { recursive: true })
    const stamp = String(++n).padStart(2, '0') + '-' + tag
    const a = await overlay?.webContents.capturePage().catch(() => null)
    if (a) writeFileSync(join(captureDir, `${stamp}-island.png`), a.toPNG())
    const c = await captionBar.capture().catch(() => null)
    if (c) writeFileSync(join(captureDir, `${stamp}-caption.png`), c.toPNG())
    const dd = await dictationBar.capture().catch(() => null)
    if (dd) writeFileSync(join(captureDir, `${stamp}-dictation.png`), dd.toPNG())
    const ll = await lassoCanvas.capture().catch(() => null)
    if (ll) writeFileSync(join(captureDir, `${stamp}-lasso.png`), ll.toPNG())
  }
  await sleep(2500)
  if (name === 'schedule') {
    agent.setState('listening')
    agent.emit2({ type: 'mascot', emote: 'alert' })
    for (let i = 0; i < 10; i++) { agent.emit2({ type: 'level', v: 0.25 + 0.5 * Math.abs(Math.sin(i * 1.3)) }); await sleep(60) }
    await snap('listening')
    await stream(agent, 'Open Visual Studio Code, then open Netflix an hour later.', 'said')
    await snap('said')
    agent.setState('thinking')
    await sleep(900)
    await snap('thinking')
    agent.setState('speaking')
    agent.emit2({ type: 'mascot', play: 'nod', emote: 'clock' })
    for (let i = 0; i < 24; i++) { agent.emit2({ type: 'level', v: 0.3 + 0.6 * Math.abs(Math.sin(i * 0.9)) }); if (i === 2) agent.caption('reply', 'Scheduled: I will open Netflix today at 7:00 AM.'); await sleep(110) }
    await snap('reply')
    agent.setState('idle')
    agent.emit2({ type: 'mascot', play: 'celebrate' })
    await sleep(1200)
    await snap('done')
    agent.clearSoon(200)
  } else if (name === 'dictation') {
    const d = screen.getPrimaryDisplay().bounds
    const rect = { x: Math.round(d.width * 0.3), y: Math.round(d.height * 0.74), w: Math.round(d.width * 0.4), h: 48 } // the field of the mock chat backdrop
    dictationBar.send({ type: 'start', rect })
    agent.emit2({ type: 'mascot', play: 'bounce', emote: 'write' })
    const raw = "Hey John! Let's go fishin' together at 6am this mornin'... ah, nevermind, make it 9am, then after that let's go drinkin' together. Also, take care of that boah of yours!"
    const words = raw.split(' ')
    for (let i = 1; i <= words.length; i++) {
      dictationBar.send({ type: 'raw', text: words.slice(0, i).join(' ') })
      dictationBar.send({ type: 'level', v: 0.3 + 0.5 * Math.abs(Math.sin(i * 1.7)) })
      if (i === Math.floor(words.length / 2)) await snap('raw-mid')
      await sleep(130)
    }
    await snap('raw-full')
    dictationBar.send({ type: 'clean', text: "Hey John, let's go fishing together at 9:00 a.m. this morning. After that, let's go drinking together. Also, take care of that boy of yours!" })
    await sleep(350)
    await snap('cleaning')
    await sleep(900)
    await snap('clean')
    dictationBar.send({ type: 'done' })
    await sleep(500)
    await snap('done')
    dictationBar.closeSoon(800)
  } else if (name === 'lasso') {
    const d = screen.getPrimaryDisplay().bounds
    const loop = Lasso.demoLoop(Math.round(d.width * 0.204), Math.round(d.height * 0.252), 118, 60) // around the first cover of the mock list backdrop
    lassoCanvas.send({ type: 'start' })
    agent.setState('listening')
    for (let i = 0; i < loop.length; i += 4) { lassoCanvas.send({ type: 'point', pts: loop.slice(i, i + 4) }); await sleep(26) }
    await snap('drawing')
    await stream(agent, 'Can you please open the store page of this game?', 'said', 110)
    lassoCanvas.send({ type: 'end' })
    await sleep(350)
    await snap('closed')
    agent.setState('thinking')
    await sleep(700)
    agent.setState('speaking')
    agent.emit2({ type: 'mascot', play: 'point', emote: 'search' })
    agent.caption('reply', "Here's Ashfall's store page.")
    await sleep(1500)
    await snap('reply')
    agent.setState('idle')
    agent.clearSoon(300)
    lassoCanvas.closeSoon(300)
  } else if (name === 'notice') {
    agent.notice('Add your Gemini key in Settings → Voice to talk to me.', 'error')
    await sleep(900)
    await snap('notice')
  }
  await sleep(2500)
  await stopRecording?.()
}
