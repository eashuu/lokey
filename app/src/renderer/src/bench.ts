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
  const island = useIsland.getState()
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

  for (let round = 0; round < 3; round++) {
    island.openIsland('hover', 'controls')
    phases.push(await record(`open#${round}`, 900))
    if (round === 0) { await sleep(500); await b.capture('10-open-controls') }
    for (const t of tabsOrder.slice(1)) {
      useIsland.getState().setTab(t)
      phases.push(await record(`tab:${t}#${round}`, 700))
      if (round === 0) { await sleep(500); await b.capture(`20-tab-${t}`) }
    }
    useIsland.getState().setTab('controls')
    await sleep(300)
    island.closeIsland()
    phases.push(await record(`close#${round}`, 800))
    if (round === 0) await b.capture('90-closed-again')
  }

  const all = phases
  const worst = all.reduce((m, p) => Math.max(m, p.p95), 0)
  await b.finish({
    kind: bridge.kind,
    dpr: devicePixelRatio,
    viewport: [innerWidth, innerHeight],
    idle: { ms: idleMs, before: m0, after: m1 },
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
