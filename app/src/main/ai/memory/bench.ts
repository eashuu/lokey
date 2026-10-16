import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { BrainStore } from '../../brain/memory/store'
import { openDb } from '../db'
import { SqlBackend } from './sqlstore'
import { Vault } from './vault'

// `Lokey.exe --memcheck`: a short, headless measurement of the memory engine (no windows, no sidecar, no hotkeys, no input, nothing of the
// running app is touched; the database is a throw-away file in the temp folder). It reports what the database and encrypted memory cost in
// RAM, disk and time with a realistic load (2500 facts with 256-dim vectors, the engine's own cap), and the CPU the process uses while idle.
// It does NOT measure the whole app (renderer windows, sidecar): that needs the window and sidecar processes and is left to Task Manager.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const mb = (n: number) => +(n / 1048576).toFixed(1)

export async function runMemcheck(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'lokey-memcheck-'))
  const lines: string[] = []
  try {
    const m0 = process.memoryUsage()
    const db = openDb(join(dir, 'lokey.db'))
    if (!db) return 'node:sqlite is not available'
    const vault = new Vault(randomBytes(32))
    const backend = new SqlBackend(db, () => vault)
    const store = new BrainStore(true, Date.now, backend).load()
    const words = 'coffee morning project lokey sister Priya Chennai dark mode editor TypeScript meeting Tamil English phone laptop music jazz piano travel train report budget'.split(' ')
    const t0 = Date.now()
    for (let i = 0; i < 2500; i++) {
      const text = `${words[i % words.length]} ${words[(i * 7) % words.length]} fact number ${i} about ${words[(i * 3) % words.length]} and ${words[(i * 11) % words.length]}`
      store.add(text, { kind: 'fact', importance: (i % 10) / 10, source: i % 3 ? 'chat' : 'manual', emb: Array.from({ length: 256 }, (_, k) => Math.sin(i + k)) })
    }
    store.saveNow()
    const tSave = Date.now() - t0
    const t1 = Date.now()
    const db2 = openDb(join(dir, 'lokey.db'))!
    const reload = new BrainStore(true, Date.now, new SqlBackend(db2, () => vault)).load()
    const tLoad = Date.now() - t1
    const t2 = Date.now()
    let hits = 0
    for (let i = 0; i < 100; i++) hits += reload.search(`${words[i % words.length]} ${words[(i * 5) % words.length]}`, { k: 8 }).length
    const tSearch = (Date.now() - t2) / 100
    const m1 = process.memoryUsage()
    await sleep(500)
    const idle0 = app.getAppMetrics().map(x => ({ type: x.type, cpu: x.cpu.cumulativeCPUUsage ?? 0 }))
    await sleep(5000)
    const idle1 = app.getAppMetrics()
    const cpu = idle1.map(x => ({ type: x.type, pct: +((((x.cpu.cumulativeCPUUsage ?? 0) - (idle0.find(y => y.type === x.type)?.cpu ?? 0)) / 5) * 100).toFixed(2) }))
    lines.push(`memory engine bench (2500 facts, 256-dim vectors, content sealed with AES-256-GCM, FTS5 index in memory)`)
    lines.push(`write 2500 facts: ${tSave} ms; reload from tables (decrypt + index): ${tLoad} ms; search: ${tSearch.toFixed(2)} ms each (${hits} hits over 100 queries)`)
    lines.push(`database file: ${mb(statSync(join(dir, 'lokey.db')).size)} MB`)
    lines.push(`main process before: rss ${mb(m0.rss)} MB, heap ${mb(m0.heapUsed)} MB; after the 2500 facts loaded twice: rss ${mb(m1.rss)} MB, heap ${mb(m1.heapUsed)} MB`)
    lines.push(`idle for 5 s with no windows: ${cpu.map(c => `${c.type} ${c.pct}% of one core`).join(', ')}`)
    lines.push('(this is the memory engine in a headless main process, not the whole app: the renderer windows and the sidecar are not started)')
    db.close(); db2.close()
  } finally { try { rmSync(dir, { recursive: true, force: true }) } catch { /* a temp folder left behind */ } }
  return lines.join('\n')
}
