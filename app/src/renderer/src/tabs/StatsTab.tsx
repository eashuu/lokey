import { useMemo, useState, type ReactNode } from 'react'
import type { StatsTick } from '@shared/protocol'
import { useData, useStatsStream } from '@/lib/data'
import { duration, rate } from '@/lib/format'
import { FullRing as Ring } from './stats/Ring'
import { SpeedCard } from './stats/SpeedCard'

const C_CPU = 'var(--accent)', C_GPU = '#b69cff', C_RAM = '#9bd66f'
const AVATARS = ['#8ED92F', '#b69cff', '#6fb7e8', '#f4a46a', '#ff8fa3', '#d9b556']
const GB = 2 ** 30
const gb = (n: number, d = 1) => (n / GB).toFixed(d)
const short = (s: string) => s.replace(/\((R|TM)\)|\bCPU\b|\bProcessor\b|@.*$/gi, '').replace(/\s+/g, ' ').trim()
const avatarColor = (name: string) => AVATARS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATARS.length]
const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const

function Chip({ children }: { children: ReactNode }) {
  return <span style={{ height: 20, lineHeight: '20px', padding: '0 8px', borderRadius: 7, background: 'rgba(255,255,255,.07)', color: '#C8CFDB', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{children}</span>
}

function Dial({ label, value, color, sub, chips }: { label: string; value: number | null; color: string; sub: string; chips: ReactNode[] }) {
  return (
    <div style={{ position: 'relative', width: 184, height: 200, borderRadius: 20, background: 'var(--fill-1)', flex: 'none' }}>
      <div style={{ position: 'absolute', left: 46, top: 12 }}>
        <Ring value={value ?? 0} size={92} stroke={6} color={color}>
          <span style={{ fontSize: 17, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value === null ? '—' : `${Math.round(value)}%`}</span>
        </Ring>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 112, height: 18, lineHeight: '18px', textAlign: 'center', fontSize: 14, fontWeight: 500 }}>{label}</div>
      <div style={{ position: 'absolute', left: 12, right: 12, top: 134, height: 14, lineHeight: '14px', textAlign: 'center', fontSize: 11, color: 'var(--muted)', ...ellipsis }}>{sub || '—'}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 160, display: 'flex', gap: 6, justifyContent: 'center' }}>{chips}</div>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ position: 'relative', width: 184, height: 58, borderRadius: 16, background: 'var(--fill-1)', flex: 'none' }}>
      <div style={{ position: 'absolute', left: 12, top: 8, right: 12, height: 14, lineHeight: '14px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', ...ellipsis }}>{label}</div>
      <div style={{ position: 'absolute', left: 12, top: 26, right: 12, height: 20, lineHeight: '20px', fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums', ...ellipsis }}>{children}</div>
    </div>
  )
}

export function StatsTab() {
  useStatsStream(true, 1000)
  const s = useData(d => d.stats)
  return (
    <div style={{ display: 'flex', gap: 10, height: 268 }}>
      <div style={{ width: 572, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <Dial label="CPU" color={C_CPU} value={s ? s.cpu.pct : null} sub={s ? short(s.cpu.name) : ''}
            chips={s ? [<Chip key="a">{s.cpu.ghz.toFixed(1)} GHz</Chip>, <Chip key="b">{s.cpu.processes} proc</Chip>] : []} />
          <Dial label="GPU" color={C_GPU} value={s?.gpu ? s.gpu.pct : null} sub={s ? (s.gpu ? short(s.gpu.name) : 'No GPU') : ''}
            chips={s?.gpu ? [<Chip key="a">{gb(s.gpu.vramUsed)} / {gb(s.gpu.vramTotal)} GB</Chip>] : []} />
          <Dial label="RAM" color={C_RAM} value={s ? (s.ram.used / s.ram.total) * 100 : null} sub={s ? `${gb(s.ram.used)} / ${gb(s.ram.total)} GB` : ''}
            chips={s ? [<Chip key="a">{gb(s.ram.total - s.ram.used)} GB free</Chip>] : []} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Fact label={`Disk ${s?.disk.letter ?? ''}`}>{s ? `${gb(s.disk.used, 0)} / ${gb(s.disk.total, 0)} GB` : '—'}</Fact>
          <Fact label="Network">{s ? `↓ ${rate(s.net.down)}  ↑ ${rate(s.net.up)}` : '—'}</Fact>
          <Fact label="Up for">{s ? duration(s.uptimeSec) : '—'}</Fact>
        </div>
      </div>
      <div style={{ width: 262, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
    <div style={{ position: 'relative', height: 142, borderRadius: 18, background: 'var(--fill-1)', flex: 'none' }}>
      <div style={{ position: 'absolute', left: 12, top: 10, height: 14, lineHeight: '14px', fontSize: 11, color: 'var(--muted)' }}>Top apps · {by === 'ram' ? 'RAM' : 'CPU'}</div>
      <button onClick={() => setBy(by === 'ram' ? 'cpu' : 'ram')} aria-label="Switch sort" style={{ position: 'absolute', right: 12, top: 10, height: 14, lineHeight: '14px', fontSize: 11, fontWeight: 500, color: 'var(--accent)' }}>{by === 'ram' ? 'CPU' : 'RAM'} ⇄</button>
      {top === null ? <div style={{ position: 'absolute', left: 0, right: 0, top: 70, textAlign: 'center', fontSize: 12, color: 'var(--muted)' }}>—</div> : rows.map((r, i) => {
        const c = avatarColor(r.name)
        return (
          <div key={r.name} style={{ position: 'absolute', left: 12, right: 12, top: 32 + i * 26, height: 22 }}>
            <div style={{ position: 'absolute', left: 0, top: 0, width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,.078)', color: c }}>{r.name[0]?.toUpperCase()}</div>
            <div style={{ position: 'absolute', left: 30, right: 0, top: 0, height: 14, lineHeight: '14px', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 500, ...ellipsis }}>{r.name}</span>
              <span style={{ color: 'var(--muted)', fontSize: 11, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{by === 'ram' ? (r.ramBytes >= GB ? `${gb(r.ramBytes)} GB` : `${Math.round(r.ramBytes / 2 ** 20)} MB`) : `${r.cpuPct.toFixed(0)}%`}</span>
            </div>
            <div style={{ position: 'absolute', left: 30, right: 0, top: 18, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.094)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(r.v / max) * 100}%`, background: c, borderRadius: 2, transition: 'width 600ms cubic-bezier(.34,.8,.34,1)' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
