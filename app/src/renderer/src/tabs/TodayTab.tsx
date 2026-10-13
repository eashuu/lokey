import { useClock } from '@/island/Pill'
import { describeWeather, useWeather } from '@/lib/weather'
import { useTodos } from '@/lib/todos'
import { FocusCard, NextUp, TodoCard } from './today/Right'

const CARD = { background: 'var(--fill-1)', borderRadius: 20, position: 'relative' as const, flex: 'none' as const }
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const
const BIG = { position: 'absolute', left: 0, right: 0, height: 56, lineHeight: '56px', textAlign: 'center', fontSize: 46, fontWeight: 500, fontVariantNumeric: 'tabular-nums' } as const

function Clock({ now }: { now: Date }) {
  const h = String(now.getHours() % 12 || 12).padStart(2, '0'), m = String(now.getMinutes()).padStart(2, '0')
  const dot = { width: 6, height: 6, borderRadius: 3, background: 'var(--accent)' }
  return (
    <div style={{ ...CARD, width: 172, height: 226 }}>
      <div style={{ ...BIG, top: 18 }}>{h}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 84, height: 6, display: 'flex', justifyContent: 'center', gap: 8 }}><span style={dot} /><span style={dot} /><span style={dot} /></div>
      <div style={{ ...BIG, top: 102 }}>{m}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 184, height: 18, lineHeight: '18px', textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
        {now.getHours() < 12 ? 'AM' : 'PM'} · {now.toLocaleDateString('en-GB', { weekday: 'short' })} {now.getDate()}
      </div>
    </div>
  )
}

function Weather() {
  const w = useWeather()
  const wx = w ? describeWeather(w.code, w.isDay) : null
  const c = { position: 'absolute', left: 8, right: 8, textAlign: 'center', ...ellipsis } as const
  return (
    <div style={{ ...CARD, width: 172, height: 134 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 14, height: 24, display: 'flex', justifyContent: 'center' }}>{wx && <wx.Icon size={24} color="var(--accent)" strokeWidth={1.75} />}</div>
      <div style={{ ...c, top: 44, height: 36, lineHeight: '36px', fontSize: 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{w ? `${Math.round(w.temp)}°C` : '—'}</div>
      <div style={{ ...c, top: 84, height: 16, lineHeight: '16px', fontSize: 12, color: 'var(--muted)' }}>{wx?.text ?? 'Weather unavailable'}</div>
      {w?.city ? <div style={{ ...c, top: 104, height: 16, lineHeight: '16px', fontSize: 11, color: 'var(--soft)' }}>{w.city}</div> : null}
    </div>
  )
}

function Week({ now }: { now: Date }) {
  const items = useTodos(s => s.items)
  const mondayOffset = (now.getDay() + 6) % 7
  const days = DAYS.map((l, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset + i)
    const due = items.some(t => !t.done && t.due !== null && new Date(t.due).toDateString() === d.toDateString())
    return { l, d, due, today: i === mondayOffset }
  })
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return (
    <div style={{ ...CARD, width: 354, height: 190 }}>
      <div style={{ position: 'absolute', left: 16, top: 14, height: 18, lineHeight: '18px', fontSize: 14, fontWeight: 500 }}>This week</div>
      <div style={{ position: 'absolute', right: 16, top: 14, height: 18, lineHeight: '18px', fontSize: 12, color: 'var(--muted)' }}>{md(days[0].d)} – {md(days[6].d)}</div>
      {days.map((x, i) => (
        <div key={i} style={{ position: 'absolute', left: 12 + i * (330 / 7), width: 330 / 7, top: 44, textAlign: 'center' }}>
          <div style={{ height: 14, lineHeight: '14px', fontSize: 11, color: 'var(--muted)' }}>{x.l}</div>
          <div style={{ position: 'relative', margin: '6px auto 0', width: 42, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 14, fontVariantNumeric: 'tabular-nums', fontWeight: x.today ? 500 : 400, background: x.today ? 'var(--accent)' : 'var(--fill-0)', color: x.today ? 'var(--accent-ink)' : 'var(--text)' }}>
            {x.d.getDate()}
            {x.due && <span style={{ position: 'absolute', bottom: 5, left: 19, width: 4, height: 4, borderRadius: 2, background: x.today ? 'var(--accent-ink)' : 'var(--accent)' }} />}
          </div>
        </div>
      ))}
      <div style={{ position: 'absolute', left: 12, top: 118 }}><NextUp now={now} /></div>
    </div>
  )
}

export function TodayTab() {
  const now = useClock()
  return (
    <div style={{ display: 'flex', gap: 12, height: 372 }}>
      <div style={{ width: 172, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Clock now={now} />
        <Weather />
      </div>
      <div style={{ width: 354, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Week now={now} />
        <FocusCard />
      </div>
      <div style={{ width: 294, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <TodoCard now={now} />
      </div>
    </div>
  )
}
