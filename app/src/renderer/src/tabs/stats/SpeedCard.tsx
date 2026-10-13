import { useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { loadLastSpeed, runSpeedTest, type SpeedProgress, type SpeedResult } from '@/lib/speedtest'

const fmt = (n: number) => (n >= 100 ? Math.round(n) : n.toFixed(1)).toString()
const ago = (at: number) => {
  const m = Math.floor(Math.max(0, Date.now() - at) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`
}
const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const

function Num({ v, arrow, dim }: { v: string; arrow: string; dim: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 3 }}>
      <span style={{ fontSize: 20, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: dim ? 'var(--muted)' : 'var(--text)' }}>{v}</span>
      <span style={{ fontSize: 10, color: 'var(--muted)' }}>Mbps{arrow}</span>
    </span>
  )
}

export function SpeedCard() {
  const [last, setLast] = useState<SpeedResult | null>(loadLastSpeed)
  const [prog, setProg] = useState<SpeedProgress | null>(null)
  const [failed, setFailed] = useState(false)
  const busy = useRef(false)
  const running = prog !== null

  const run = async () => {
    if (busy.current) return
    busy.current = true
    setFailed(false)
    setProg({ phase: 'ping', mbps: 0 })
    const r = await runSpeedTest(setProg)
    busy.current = false
    setProg(null)
    if (r) setLast(r)
    else setFailed(true)
  }

  const arrow = prog?.phase === 'up' ? '↑' : '↓'
  return (
    <div style={{ position: 'relative', height: 116, borderRadius: 18, background: 'var(--fill-1)', flex: 'none' }}>
      <div style={{ position: 'absolute', left: 12, top: 10, height: 14, lineHeight: '14px', fontSize: 11, color: 'var(--muted)' }}>Internet speed</div>
      <div style={{ position: 'absolute', left: 90, right: 12, top: 10, height: 14, lineHeight: '14px', fontSize: 11, textAlign: 'right', color: failed ? 'var(--warn)' : 'var(--muted)', ...ellipsis }}>
        {failed ? 'Couldn’t reach the server' : last ? `last: ${ago(last.at)}${last.place ? ` · ${last.place}` : ''}` : 'Not tested yet'}
      </div>
      <div style={{ position: 'absolute', left: 12, right: 12, top: 32, height: 28, lineHeight: '28px', display: 'flex', gap: 18, alignItems: 'baseline' }}>
        <Num v={last ? fmt(last.down) : '—'} arrow=" ↓" dim={!last} />
        <Num v={last ? fmt(last.up) : '—'} arrow=" ↑" dim={!last} />
      </div>
      <button
        onClick={run}
        disabled={running}
        style={{ position: 'absolute', left: 12, right: 12, bottom: 12, height: 30, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 11, fontWeight: 500, opacity: running ? 0.6 : 1, cursor: running ? 'default' : 'pointer', transition: 'opacity 140ms' }}
      >
        {running ? (prog.phase === 'ping' ? 'Testing…' : `Testing… ${arrow} ${fmt(prog.mbps)}`) : <><Play size={10} fill="currentColor" />Run speed test</>}
      </button>
    </div>
  )
}
