import { useRef, useState } from 'react'
import { loadLastSpeed, runSpeedTest, type SpeedProgress, type SpeedResult } from '@/lib/speedtest'

const fmt = (n: number) => (n >= 100 ? Math.round(n) : n.toFixed(1)).toString()
const ago = (at: number) => {
  const m = Math.floor(Math.max(0, Date.now() - at) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`
}

function Num({ left, v, arrow, dim }: { left: number; v: string; arrow: string; dim: boolean }) {
  return (
    <div style={{ position: 'absolute', left, top: 32, height: 32, lineHeight: '32px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ fontSize: 26, fontWeight: 500, color: dim ? 'var(--muted)' : 'var(--text)' }}>{v}</span>
      <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>Mbps {arrow}</span>
    </div>
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
    <div style={{ position: 'absolute', left: 582, top: 146, width: 262, height: 118, borderRadius: 18, background: 'var(--fill-1)' }}>
      <div style={{ position: 'absolute', left: 14, top: 10, height: 16, lineHeight: '16px', fontSize: 12, color: 'var(--muted)' }}>Internet speed</div>
      <div style={{ position: 'absolute', left: 100, right: 14, top: 10, height: 16, lineHeight: '16px', fontSize: 11, textAlign: 'right', color: failed ? 'var(--warn)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {failed ? 'Couldn’t reach the server' : last ? `last: ${ago(last.at)}${last.place ? ` · ${last.place}` : ''}` : 'Not tested yet'}
      </div>
      <Num left={14} v={last ? fmt(last.down) : '—'} arrow="↓" dim={!last} />
      <Num left={122} v={last ? fmt(last.up) : '—'} arrow="↑" dim={!last} />
      <button
        onClick={run}
        disabled={running}
        style={{ position: 'absolute', left: 14, top: 70, width: 234, height: 34, borderRadius: 12, background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: 12, fontWeight: 500, opacity: running ? 0.6 : 1, cursor: running ? 'default' : 'pointer', transition: 'opacity 140ms' }}
      >
        {running ? (prog.phase === 'ping' ? 'Testing…' : `Testing… ${arrow} ${fmt(prog.mbps)}`) : '▶  Run speed test'}
      </button>
    </div>
  )
}
