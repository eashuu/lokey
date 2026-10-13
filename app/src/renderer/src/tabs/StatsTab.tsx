import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { StatsTick } from '@shared/protocol'
import { useData, useStatsStream } from '@/lib/data'
import { duration, rate } from '@/lib/format'
import { FullRing as Ring } from './stats/Ring'
import { SpeedCard } from './stats/SpeedCard'

const GB = 2 ** 30
const gb = (n: number, d = 1) => (n / GB).toFixed(d)
const short = (s: string) => s.replace(/\((R|TM)\)|\bCPU\b|\bProcessor\b|@.*$/gi, '').replace(/\s+/g, ' ').trim()
const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const
const abs = (left: number, top: number, width: number, height: number, extra?: CSSProperties): CSSProperties => ({ position: 'absolute', left, top, width, height, ...extra })

function Chip({ children }: { children: ReactNode }) {
  return <span style={{ height: 22, lineHeight: '22px', padding: '0 8px', borderRadius: 7, background: 'rgba(255,255,255,.07)', color: '#C8CFDB', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{children}</span>
}

function Dial({ x, label, value, color, sub, chips }: { x: number; label: string; value: number | null; color: string; sub: string; chips: ReactNode[] }) {
  return (
    <div style={abs(x, 0, 184, 196, { borderRadius: 20, background: 'var(--fill-1)' })}>
      <div style={{ position: 'absolute', left: 46, top: 14 }}>
        <Ring value={value ?? 0} size={92} stroke={8} color={color}>
          <span style={{ fontSize: 17, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value === null ? '—' : `${Math.round(value)}%`}</span>
        </Ring>
      </div>
      <div style={abs(0, 114, 184, 18, { lineHeight: '18px', textAlign: 'center', fontSize: 14, fontWeight: 500 })}>{label}</div>
      <div style={abs(8, 134, 168, 14, { lineHeight: '14px', textAlign: 'center', fontSize: 11, color: 'var(--muted)', ...ellipsis })}>{sub || '—'}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 162, display: 'flex', gap: 6, justifyContent: 'center' }}>{chips}</div>
    </div>
  )
}

function Fact({ x, label, children }: { x: number; label: string; children: ReactNode }) {
  return (
    <div style={abs(x, 206, 184, 58, { borderRadius: 16, background: 'var(--fill-1)' })}>
      <div style={abs(12, 8, 160, 14, { lineHeight: '14px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', ...ellipsis })}>{label}</div>
      <div style={abs(12, 26, 160, 20, { lineHeight: '20px', fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums', ...ellipsis })}>{children}</div>
    </div>
  )
}

export function StatsTab() {
  useStatsStream(true, 1000)
  const s = useData(d => d.stats)
  return (
    <div style={{ position: 'relative', width: 844, height: 264 }}>
      <Dial x={0} label="CPU" color="var(--accent)" value={s ? s.cpu.pct : null} sub={s ? short(s.cpu.name) : ''}
        chips={s ? [<Chip key="a">{s.cpu.ghz.toFixed(1)} GHz</Chip>, <Chip key="b">{s.cpu.processes} proc</Chip>] : []} />
      <Dial x={194} label="GPU" color="var(--chest)" value={s?.gpu ? s.gpu.pct : null} sub={s ? (s.gpu ? short(s.gpu.name) : 'No GPU') : ''}
        chips={s?.gpu ? [<Chip key="a">{gb(s.gpu.vramUsed)} / {gb(s.gpu.vramTotal)} GB</Chip>] : []} />
      <Dial x={388} label="RAM" color="var(--done)" value={s ? (s.ram.used / s.ram.total) * 100 : null} sub={s ? `${gb(s.ram.used)} / ${gb(s.ram.total)} GB` : ''}
        chips={s ? [<Chip key="a">{gb(s.ram.total - s.ram.used)} GB free</Chip>] : []} />
      <Fact x={0} label={`Disk ${s?.disk.letter ?? ''}`}>{s ? `${gb(s.disk.used, 0)} / ${gb(s.disk.total, 0)} GB` : '—'}</Fact>
      <Fact x={194} label="Network">{s ? `↓ ${rate(s.net.down)}  ↑ ${rate(s.net.up)}` : '—'}</Fact>
      <Fact x={388} label="Up for">{s ? duration(s.uptimeSec) : '—'}</Fact>
      <TopApps top={s?.top ?? null} />
      <SpeedCard />
    </div>
  )
}

function TopApps({ top }: { top: StatsTick['top'] | null }) {
  const [by, setBy] = useState<'ram' | 'cpu'>('ram')
  const rows = useMemo(() => {
    if (!top) return []
    const v = (t: StatsTick['top'][number]) => (by === 'ram' ? t.ramBytes : t.cpuPct)
    return [...top].sort((a, b) => v(b) - v(a)).slice(0, 4).map(t => ({ ...t, v: v(t) }))
  }, [top, by])
  const max = Math.max(1, ...rows.map(r => r.v))
  return (
    <div style={abs(582, 0, 262, 136, { borderRadius: 18, background: 'var(--fill-1)' })}>
      <div style={abs(14, 10, 140, 16, { lineHeight: '16px', fontSize: 12, color: 'var(--muted)' })}>Top apps · {by === 'ram' ? 'RAM' : 'CPU'}</div>
      <button onClick={() => setBy(by === 'ram' ? 'cpu' : 'ram')} aria-label="Switch sort" style={{ position: 'absolute', right: 14, top: 10, height: 16, lineHeight: '16px', fontSize: 12, color: 'var(--accent)' }}>{by === 'ram' ? 'CPU' : 'RAM'} ⇄</button>
      {top === null ? <div style={abs(0, 64, 262, 16, { textAlign: 'center', fontSize: 12, color: 'var(--muted)' })}>—</div> : rows.map((r, i) => {
        const l = 34 + 24 * i
        return (
          <div key={r.name}>
            <div style={abs(14, l, 22, 22, { borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 11, background: 'rgba(255,255,255,.118)' })}>{r.name[0]?.toUpperCase()}</div>
            <div style={abs(44, l - 2, 148, 16, { lineHeight: '16px', fontSize: 12, ...ellipsis })}>{r.name}</div>
            <div style={abs(184, l - 2, 64, 16, { lineHeight: '16px', textAlign: 'right', fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' })}>{by === 'ram' ? (r.ramBytes >= GB ? `${gb(r.ramBytes)} GB` : `${Math.round(r.ramBytes / 2 ** 20)} MB`) : `${r.cpuPct.toFixed(0)}%`}</div>
            <div style={abs(44, l + 16, 204, 4, { borderRadius: 2, background: 'rgba(255,255,255,.086)', overflow: 'hidden' })}>
              <div style={{ height: '100%', width: `${Math.max(4, (r.v / max) * 100)}%`, background: '#8ED92F', borderRadius: 2, transition: 'width 600ms cubic-bezier(.33,1,.68,1)' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
