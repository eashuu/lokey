import { useRef, useState } from 'react'
import { Card, Label } from '@/ui'
import { ago } from '@/lib/format'
import { loadLastSpeed, runSpeedTest, type SpeedProgress, type SpeedResult } from '@/lib/speedtest'

const fmt = (n: number) => (n >= 100 ? Math.round(n) : n.toFixed(1)).toString()

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
    <Card style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <Label>Internet speed</Label>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline' }}>
        <div className="num" style={{ fontSize: '1.0625rem', fontWeight: 500, color: last ? 'var(--text)' : 'var(--dim)' }}>
          {last ? fmt(last.down) : '—'}<span style={{ fontSize: '0.625rem', color: 'var(--dim)' }}> ↓</span>
        </div>
        <div className="num" style={{ fontSize: '1.0625rem', fontWeight: 500, color: last ? 'var(--text)' : 'var(--dim)' }}>
          {last ? fmt(last.up) : '—'}<span style={{ fontSize: '0.625rem', color: 'var(--dim)' }}> ↑</span>
        </div>
        <div style={{ fontSize: '0.625rem', color: 'var(--dim)' }}>Mbps</div>
      </div>
      <div style={{ fontSize: '0.625rem', color: failed ? 'var(--warn)' : 'var(--dim)', minHeight: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {failed ? 'Couldn’t reach the test server' : last ? `last: ${ago(last.at)}${last.place ? ` · ${last.place}` : ''} · ${Math.round(last.ping)} ms` : 'Not tested yet'}
      </div>
      <button
        onClick={run}
        disabled={running}
        style={{ height: '1.875rem', borderRadius: 999, background: 'var(--accent)', color: 'var(--accent-ink)', fontSize: '0.6875rem', fontWeight: 700, opacity: running ? 0.6 : 1, cursor: running ? 'default' : 'pointer', transition: 'opacity 140ms' }}
      >
        {running ? (prog.phase === 'ping' ? 'Testing…' : `Testing… ${arrow} ${fmt(prog.mbps)}`) : 'Run speed test'}
      </button>
    </Card>
  )
}
