import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { StatsTick } from '@shared/protocol'
import { useData, useStatsStream } from '@/lib/data'
import { duration, rate } from '@/lib/format'
import { Bar, Card, Chip, Label, Ring, Sparkline } from '@/ui'
import { SpeedCard } from './stats/SpeedCard'

const C_CPU = 'var(--accent)', C_GPU = '#b69cff', C_RAM = '#9bd66f'
const AVATARS = ['#d9b556', '#b69cff', '#9bd66f', '#6fb7e8', '#f4a46a', '#ff8fa3']
const GB = 2 ** 30
const gb = (n: number, d = 1) => (n / GB).toFixed(d)
const short = (s: string) => s.replace(/\((R|TM)\)|\bCPU\b|\bProcessor\b|@.*$/gi, '').replace(/\s+/g, ' ').trim()
const avatarColor = (name: string) => AVATARS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length]

function Pill({ children }: { children: ReactNode }) {
  return <span className="num" style={{ padding: '0.125rem 0.375rem', borderRadius: 999, background: 'var(--s2)', color: 'var(--muted)', fontSize: '0.5625rem', whiteSpace: 'nowrap' }}>{children}</span>
}

function Gauge({ label, value, color, name, pills, px }: { label: string; value: number | null; color: string; name: string; pills: ReactNode[]; px: number }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem' }}>
      <Ring value={value ?? 0} size={4.5 * px} stroke={0.3125 * px} color={color}>
        <div style={{ textAlign: 'center', lineHeight: 1.1 }}>
          <div className="num" style={{ fontSize: '1.0625rem', fontWeight: 500 }}>{value === null ? '—' : Math.round(value)}<span style={{ fontSize: '0.5625rem', color: 'var(--dim)' }}>{value === null ? '' : '%'}</span></div>
          <div className="label" style={{ fontSize: '0.5rem' }}>{label}</div>
        </div>
      </Ring>
      <div style={{ fontSize: '0.625rem', color: 'var(--muted)', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || '—'}</div>
      <div style={{ display: 'flex', gap: '0.1875rem', flexWrap: 'wrap', justifyContent: 'center', minHeight: '1rem' }}>{pills}</div>
    </div>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card style={{ padding: '0.625rem', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <Label>{label}</Label>
      {children}
    </Card>
  )
}

export function StatsTab() {
  useStatsStream(true, 1000)
  const s = useData(d => d.stats)
  const scale = useData(d => d.settings.appearance.scale)
  const px = useMemo(() => parseFloat(getComputedStyle(document.documentElement).fontSize), [scale])

  // last 30 download-rate samples (one push per distinct tick)
  const hist = useRef<number[]>([])
  const seen = useRef<StatsTick | null>(null)
  if (s && s !== seen.current) { seen.current = s; hist.current = [...hist.current.slice(-29), s.net.down] }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 11.5rem', gap: '0.5rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
        <Card style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.875rem 0.375rem' }}>
          <Gauge px={px} label="CPU" color={C_CPU} value={s ? s.cpu.pct : null} name={s ? short(s.cpu.name) : ''}
            pills={s ? [<Pill key="a">{s.cpu.ghz.toFixed(1)} GHz</Pill>, <Pill key="b">{s.cpu.processes} proc</Pill>] : []} />
          <Gauge px={px} label="GPU" color={C_GPU} value={s ? (s.gpu ? s.gpu.pct : null) : null} name={s ? (s.gpu ? short(s.gpu.name) : 'No GPU') : ''}
            pills={s?.gpu ? [<Pill key="a">{gb(s.gpu.vramUsed)} / {gb(s.gpu.vramTotal)} GB</Pill>] : []} />
          <Gauge px={px} label="RAM" color={C_RAM} value={s ? (s.ram.used / s.ram.total) * 100 : null} name={s ? `${gb(s.ram.total, 0)} GB installed` : ''}
            pills={s ? [<Pill key="a">{gb(s.ram.total - s.ram.used)} GB free</Pill>] : []} />
        </Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
          <Stat label={`Disk ${s?.disk.letter ?? ''}`}>
            <div className="num" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{s ? `${gb(s.disk.used, 0)} / ${gb(s.disk.total, 0)} GB` : '—'}</div>
            <Bar value={s ? (s.disk.used / s.disk.total) * 100 : 0} height={3} />
          </Stat>
          <Stat label="Network">
            <div className="num" style={{ fontSize: '0.6875rem', lineHeight: 1.3, whiteSpace: 'nowrap' }}>
              {s ? <><span style={{ color: 'var(--accent)' }}>↓</span> {rate(s.net.down)}<br /><span style={{ color: 'var(--muted)' }}>↑ {rate(s.net.up)}</span></> : '—'}
            </div>
            <Sparkline values={hist.current} width={5.5 * px} height={1.125 * px} />
          </Stat>
          <Stat label="Up for">
            <div className="num" style={{ fontSize: '0.9375rem', fontWeight: 500 }}>{s ? duration(s.uptimeSec) : '—'}</div>
          </Stat>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
        <TopApps top={s?.top ?? null} />
        <SpeedCard />
      </div>
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
    <Card style={{ padding: '0.625rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Label>Top apps</Label>
        <div style={{ display: 'flex', gap: '0.125rem' }}>
          <Chip on={by === 'ram'} onClick={() => setBy('ram')}>RAM</Chip>
          <Chip on={by === 'cpu'} onClick={() => setBy('cpu')}>CPU</Chip>
        </div>
      </div>
      {top === null ? <div style={{ color: 'var(--dim)', fontSize: '0.6875rem', padding: '1.5rem 0', textAlign: 'center' }}>—</div> : rows.map(r => (
        <div key={r.name} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ width: '1.25rem', height: '1.25rem', borderRadius: '0.375rem', flex: 'none', display: 'grid', placeItems: 'center', fontSize: '0.625rem', fontWeight: 700, background: 'var(--s2)', color: avatarColor(r.name) }}>{r.name[0]?.toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.1875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.375rem', fontSize: '0.6875rem' }}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              <span className="num" style={{ color: 'var(--muted)', flex: 'none', fontSize: '0.625rem' }}>{by === 'ram' ? (r.ramBytes >= 2 ** 30 ? `${gb(r.ramBytes)} GB` : `${Math.round(r.ramBytes / 2 ** 20)} MB`) : `${r.cpuPct.toFixed(0)}%`}</span>
            </div>
            <Bar value={(r.v / max) * 100} color={avatarColor(r.name)} height={3} />
          </div>
        </div>
      ))}
    </Card>
  )
}
