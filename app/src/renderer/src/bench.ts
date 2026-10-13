import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { useIsland } from '@/island/store'

// `lokey --bench <dir>`: the renderer drives the island programmatically (no synthetic input), records frame
// times for every transition, and main adds process CPU/memory + screenshots. Output: report.json + PNGs.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const pct = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0)

interface Phase { name: string; frames: number; p50: number; p95: number; max: number; over20ms: number; over33ms: number }

function record(name: string, ms: number): Promise<Phase> {
  return new Promise(resolve => {
    const deltas: number[] = []
    let last = performance.now()
    const start = last
    const step = (t: number) => {
      deltas.push(t - last)
      last = t
      if (t - start < ms) requestAnimationFrame(step)
      else resolve({ name, frames: deltas.length, p50: pct(deltas, 0.5), p95: pct(deltas, 0.95), max: Math.max(...deltas), over20ms: deltas.filter(d => d > 20).length, over33ms: deltas.filter(d => d > 33.4).length })
    }
    requestAnimationFrame(step)
  })
}

export async function runBench() {
  const b = bridge.bench!
  const phases: Phase[] = []
  const tabsOrder = useData.getState().settings.island.tabs
  await sleep(1800)
  await b.capture('00-closed')

  await sleep(6000) // warm-up: let startup work (icons, weather, thumbs) finish before measuring idle
  const m0 = await b.metrics()
  const idleStart = performance.now()
  await sleep(15000) // idle window: process CPU is read before/after
  const m1 = await b.metrics()
  const idleMs = performance.now() - idleStart
  await sleep(2000)
  const m2 = await b.metrics()
  await sleep(15000)
  const m3 = await b.metrics() // second idle window, well after start-up work has settled

  const gpuTrace: string[] = []
  const trace = async (label: string) => { const m = (await b.metrics()) as { type: string; privateMb: number }[]; gpuTrace.push(`${label}:${m.find(x => x.type === 'GPU')?.privateMb}`) }
  await trace('start')
  for (let round = 0; round < 3; round++) {
    const is = () => useIsland.getState()
    is().wake('hover')
    phases.push(await record(`wake#${round}`, 800))
    if (round === 0) { await sleep(300); await b.capture('05-awake') }
    is().openMenu('music', 'hover')
    phases.push(await record(`music#${round}`, 700))
    if (round === 0) { await sleep(300); await b.capture('08-music') }
    is().setView('controls')
    phases.push(await record(`controls#${round}`, 700))
    await trace(`controls${round}`)
    if (round === 0) { await sleep(500); await b.capture('10-open-controls') }
    for (const t of tabsOrder.slice(1)) {
      is().setView(t)
      phases.push(await record(`tab:${t}#${round}`, 600))
      await trace(`${t}${round}`)
      if (round === 0) { await sleep(500); await b.capture(`20-tab-${t}`) }
    }
    for (const f of ['wifi', 'bluetooth', 'audio'] as const) {
      is().setView(f)
      phases.push(await record(`flyout:${f}#${round}`, 600))
      if (round === 0) { await sleep(900); await b.capture(`40-${f}`) }
    }
    is().setView('controls')
    await sleep(300)
    is().closeMenu()
    phases.push(await record(`close#${round}`, 800))
    if (round === 0) {
      is().hold('listening')
      phases.push(await record(`held#${round}`, 700))
      await b.capture('30-held')
      is().hold('thinking')
      await sleep(600)
      await b.capture('30b-held-thinking')
      is().hold('done')
      await sleep(600)
      await b.capture('30c-held-done')
      is().release()
      is().wake('hover')
      is().setCaption({ kind: 'said', text: 'Hey John, lets go fishing together at nine this morning.' })
      phases.push(await record(`caption#${round}`, 1400))
      await b.capture('31-caption-said')
      is().setCaption({ kind: 'reply', text: 'Done, I sent it to John.' })
      await sleep(1400)
      await b.capture('32-caption-reply')
      is().setCaption(null)
    }
    if (round === 0) await b.capture('90-closed-again')
    is().sleep()
    await sleep(300)
  }

  const all = phases
  const worst = all.reduce((m, p) => Math.max(m, p.p95), 0)
  await b.finish({
    kind: bridge.kind,
    dpr: devicePixelRatio,
    viewport: [innerWidth, innerHeight],
    gpuTrace,
    idle: { ms: idleMs, before: m0, after: m1 },
    idleLate: { ms: 15000, before: m2, after: m3 },
    phases,
    summary: {
      worstP95: worst,
      medianP95: pct(all.map(p => p.p95), 0.5),
      totalFrames: all.reduce((s, p) => s + p.frames, 0),
      over20ms: all.reduce((s, p) => s + p.over20ms, 0),
      over33ms: all.reduce((s, p) => s + p.over33ms, 0),
    },
  })
}
