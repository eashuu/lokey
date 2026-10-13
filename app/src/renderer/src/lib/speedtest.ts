// Cloudflare speed test over fetch. Runs only on demand; never throws (returns null on failure).
const BASE = 'https://speed.cloudflare.com'
const KEY = 'lokey.speed.v1'

export interface SpeedResult { down: number; up: number; ping: number; at: number; place: string }   // Mbps / ms / epoch ms
export interface SpeedProgress { phase: 'ping' | 'down' | 'up'; mbps: number }

export function loadLastSpeed(): SpeedResult | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null }
}
function save(r: SpeedResult) { try { localStorage.setItem(KEY, JSON.stringify(r)) } catch { /* ignore */ } }

const mbps = (bytes: number, ms: number) => (bytes * 8) / (ms / 1000) / 1e6

export async function runSpeedTest(onProgress: (p: SpeedProgress) => void): Promise<SpeedResult | null> {
  try {
    // ping: first round trip is warm-up (and tells us the colo), take the best of the rest
    let place = ''
    const rtts: number[] = []
    onProgress({ phase: 'ping', mbps: 0 })
    for (let i = 0; i < 5; i++) {
      const t = performance.now()
      const r = await fetch(`${BASE}/__down?bytes=0&r=${Math.random()}`, { cache: 'no-store' })
      await r.arrayBuffer()
      if (i === 0) place = r.headers.get('cf-meta-colo') ?? ''
      else rtts.push(performance.now() - t)
    }

    // download: stream up to 8 s
    const ac = new AbortController()
    const stop = setTimeout(() => ac.abort(), 8000)
    let got = 0, t0 = 0, now = 0
    try {
      const r = await fetch(`${BASE}/__down?bytes=100000000`, { signal: ac.signal, cache: 'no-store' })
      const reader = r.body!.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        now = performance.now()
        if (!t0) { t0 = now; continue }   // timing starts at the first byte
        got += value.length
        if (now - t0 > 250) onProgress({ phase: 'down', mbps: mbps(got, now - t0) })
      }
    } catch (e) { if (!ac.signal.aborted) throw e } finally { clearTimeout(stop) }
    if (!got || now - t0 < 100) return null
    const down = mbps(got, now - t0)

    // upload: up to 3 x 4 MB POSTs within ~6 s
    const buf = new Uint8Array(4 * 1024 * 1024)
    for (let o = 0; o < buf.length; o += 65536) crypto.getRandomValues(buf.subarray(o, o + 65536))
    let sent = 0, spent = 0
    for (let i = 0; i < 3 && spent < 6000; i++) {
      const t = performance.now()
      const r = await fetch(`${BASE}/__up`, { method: 'POST', body: buf, cache: 'no-store' })
      await r.arrayBuffer()
      spent += performance.now() - t
      sent += buf.length
      onProgress({ phase: 'up', mbps: mbps(sent, spent) })
    }
    const res: SpeedResult = { down, up: mbps(sent, spent), ping: Math.min(...rtts), at: Date.now(), place }
    save(res)
    return res
  } catch {
    return null
  }
}
