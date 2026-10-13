import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Agent } from './agent'
import { captionBar } from './overlays'

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

export async function runDemo(name: string, agent: Agent, overlay: BrowserWindow | null, captureDir: string | null) {
  agent.demo = true
  let n = 0
  const snap = async (tag: string) => {
    if (!captureDir) return
    mkdirSync(captureDir, { recursive: true })
    const stamp = String(++n).padStart(2, '0') + '-' + tag
    const a = await overlay?.webContents.capturePage().catch(() => null)
    if (a) writeFileSync(join(captureDir, `${stamp}-island.png`), a.toPNG())
    const c = await captionBar.capture().catch(() => null)
    if (c) writeFileSync(join(captureDir, `${stamp}-caption.png`), c.toPNG())
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
  } else if (name === 'notice') {
    agent.notice('Add your Gemini key in Settings → Voice to talk to me.', 'error')
    await sleep(900)
    await snap('notice')
  }
  await sleep(2500)
}
