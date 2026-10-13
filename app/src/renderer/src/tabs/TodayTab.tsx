import { useClock } from '@/island/Pill'
import { describeWeather, useWeather } from '@/lib/weather'
import { FocusCard, NextUp, TodoCard } from './today/Right'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const box = (left: number, top: number, width: number, height: number) => ({ position: 'absolute', left, top, width, height, borderRadius: 20, background: 'var(--fill-1)' }) as const
const BIG = { position: 'absolute', left: 0, right: 0, height: 56, lineHeight: '56px', textAlign: 'center', fontSize: 46, fontWeight: 500, fontVariantNumeric: 'tabular-nums' } as const

function Clock({ now }: { now: Date }) {
  const h = String(now.getHours() % 12 || 12).padStart(2, '0'), m = String(now.getMinutes()).padStart(2, '0')
  const dot = (e: number, cls?: string) => <span className={cls} style={{ position: 'absolute', left: 88 + e - 3.5, top: 94.5, width: 7, height: 7, borderRadius: 4, background: 'var(--accent)' }} />
  return (
    <div style={box(0, 0, 176, 214)}>
      {/* the single 1 s steps animation only exists while this tab (the open island) is mounted */}
      <style>{'@keyframes lk-dot{0%{opacity:1}50%{opacity:.55}}.lk-dot{animation:lk-dot 2s steps(1,end) infinite}'}</style>
      <div style={{ ...BIG, top: 25 }}>{h}</div>
      {dot(-13)}{dot(0, 'lk-dot')}{dot(13)}
      <div style={{ ...BIG, top: 109 }}>{m}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 14, height: 18, lineHeight: '18px', textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
        {now.getHours() < 12 ? 'AM' : 'PM'} · {now.toLocaleDateString('en-GB', { weekday: 'short' })} {now.getDate()}
      </div>
    </div>
  )
}

function Weather() {
  const w = useWeather()
  const wx = w ? describeWeather(w.code, w.isDay) : null
  const c = { position: 'absolute', left: 8, right: 8, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const
  return (
    <div style={box(0, 226, 176, 142)}>
      {wx && <wx.Icon size={36} color="#F2C94C" strokeWidth={1.6} style={{ position: 'absolute', left: 70, top: 16 }} />}
      <div style={{ ...c, top: 56, height: 36, lineHeight: '36px', fontSize: 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{w ? `${Math.round(w.temp)}°C` : '—'}</div>
      <div style={{ ...c, top: 94, height: 16, lineHeight: '16px', fontSize: 12, color: 'var(--muted)' }}>{wx?.text ?? 'Weather unavailable'}</div>
      {w?.city ? <div style={{ ...c, top: 112, height: 16, lineHeight: '16px', fontSize: 11, color: 'var(--soft)' }}>{w.city}</div> : null}
    </div>
  )
}

function Week({ now }: { now: Date }) {
  const mondayOffset = (now.getDay() + 6) % 7
  const days = DAYS.map((l, i) => ({ l, d: new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset + i), today: i === mondayOffset }))
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return (
    <div style={box(188, 0, 354, 182)}>
      <div style={{ position: 'absolute', left: 16, top: 12, height: 20, lineHeight: '20px', fontSize: 14, fontWeight: 500 }}>This week</div>
      <div style={{ position: 'absolute', right: 16, top: 12, height: 20, lineHeight: '20px', fontSize: 12, color: 'var(--muted)' }}>{md(days[0].d)} – {md(days[6].d)}</div>
      {days.map((x, i) => (
        <div key={i}>
          <div style={{ position: 'absolute', left: 12 + i * 47.14, width: 47.14, top: 42, height: 14, lineHeight: '14px', textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>{x.l}</div>
          <div style={{ position: 'absolute', left: 12 + i * 47.14 + 3, width: 41.14, top: 62, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', fontSize: 13, fontVariantNumeric: 'tabular-nums', fontWeight: x.today ? 500 : 400, background: x.today ? 'var(--accent)' : 'var(--fill-0)', color: x.today ? 'var(--accent-ink)' : 'var(--text)' }}>{x.d.getDate()}</div>
        </div>
      ))}
      <NextUp now={now} />
    </div>
  )
}

export function TodayTab() {
  const now = useClock()
  return (
    <div style={{ position: 'relative', width: 844, height: 368 }}>
      <Clock now={now} />
      <Weather />
      <Week now={now} />
      <FocusCard />
      <TodoCard now={now} />
    </div>
  )
}
