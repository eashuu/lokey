import { useClock } from '@/island/Pill'
import { describeWeather, useWeather } from '@/lib/weather'
import { useTodos } from '@/lib/todos'
import { Card, Label } from '@/ui'
import { FocusCard, NextUp, TodoCard } from './today/Right'

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function Header({ now }: { now: Date }) {
  const w = useWeather()
  const wx = w ? describeWeather(w.code, w.isDay) : null
  return (
    <Card style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
      <div style={{ minWidth: 0 }}>
        <div className="num" style={{ fontSize: '2.25rem', fontWeight: 600, lineHeight: 1 }}>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.375rem', whiteSpace: 'nowrap' }}>{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 'none' }}>
        {wx ? <wx.Icon size={26} color="var(--accent)" strokeWidth={1.75} /> : null}
        <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
          <div className="num" style={{ fontSize: '1.125rem', fontWeight: 500 }}>{w ? `${Math.round(w.temp)}°C` : '—'}</div>
          <div style={{ fontSize: '0.625rem', color: 'var(--muted)' }}>{wx?.text ?? 'Weather unavailable'}</div>
          {w?.city ? <div style={{ fontSize: '0.625rem', color: 'var(--dim)' }}>{w.city}</div> : null}
        </div>
      </div>
    </Card>
  )
}

function Week({ now }: { now: Date }) {
  const items = useTodos(s => s.items)
  const mondayOffset = (now.getDay() + 6) % 7
  const days = DAYS.map((l, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset + i)
    const due = items.some(t => !t.done && t.due !== null && new Date(t.due).toDateString() === d.toDateString())
    return { l, d, due, today: i === mondayOffset, weekend: i >= 5 }
  })
  return (
    <Card style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <Label>This week</Label>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.25rem' }}>
        {days.map((x, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', padding: '0.375rem 0', borderRadius: '0.75rem',
            background: x.today ? 'var(--accent)' : 'var(--s2)', color: x.today ? 'var(--accent-ink)' : x.weekend ? 'var(--dim)' : 'var(--text)',
          }}>
            <span style={{ fontSize: '0.5625rem', fontWeight: 600, opacity: 0.75 }}>{x.l}</span>
            <span className="num" style={{ fontSize: '0.9375rem', fontWeight: 500 }}>{x.d.getDate()}</span>
            <span style={{ width: '0.25rem', height: '0.25rem', borderRadius: 999, background: x.due ? (x.today ? 'var(--accent-ink)' : 'var(--accent)') : 'transparent' }} />
          </div>
        ))}
      </div>
    </Card>
  )
}

export function TodayTab() {
  const now = useClock()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '0.5rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
        <Header now={now} />
        <Week now={now} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
        <NextUp now={now} />
        <FocusCard />
        <TodoCard now={now} />
      </div>
    </div>
  )
}
