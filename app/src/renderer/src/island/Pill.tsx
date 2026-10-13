import { useEffect, useState } from 'react'
import { Volume2, VolumeX, Sun } from 'lucide-react'
import { useData } from '@/lib/data'
import { Mascot } from './Mascot'
import { useIsland } from './store'

export const PILL_W_REM = 10.5
export const PILL_H_REM = 2.25
export const PEEK_W_REM = 17

/** Re-renders once a minute, aligned to the minute boundary. No other timers. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    const tick = () => { setNow(new Date()); t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50) }
    t = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50)
    return () => clearTimeout(t)
  }, [])
  return now
}

export function Pill({ visible }: { visible: boolean }) {
  const media = useData(s => s.media)
  const peek = useIsland(s => s.peek)
  const now = useClock()
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  const playing = !!media?.hasSession && media.playing

  const width = peek ? `${PEEK_W_REM}rem` : `${PILL_W_REM}rem`
  return (
    <div style={{ width, height: `${PILL_H_REM}rem`, display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.75rem', opacity: visible ? 1 : 0, transition: 'opacity 140ms linear', flex: 'none' }}>
      {peek ? <PeekRow icon={peek.icon} label={peek.label} value={peek.value} text={peek.text} /> : (
        <>
          <Mascot size={20} active={false} />
          <div className="num" style={{ fontSize: '0.8125rem', fontWeight: 500, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {playing && media ? <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, color: 'var(--muted)' }}>{media.title}</span> : time}
          </div>
          {playing && media?.art ? <img src={media.art} alt="" style={{ width: '1.25rem', height: '1.25rem', borderRadius: '0.35rem', objectFit: 'cover' }} /> : null}
        </>
      )}
    </div>
  )
}

function PeekRow({ icon, label, value, text }: { icon: string; label: string; value: number | null; text: string }) {
  const Icon = icon === 'mute' ? VolumeX : icon === 'brightness' ? Sun : Volume2
  return (
    <>
      <Icon size={16} color="var(--accent)" />
      <span style={{ fontSize: '0.75rem', color: 'var(--muted)', width: '3.25rem' }}>{label}</span>
      <div style={{ flex: 1, height: '0.3125rem', borderRadius: 999, background: 'var(--s3)', overflow: 'hidden' }}>
        {value !== null && <div style={{ width: `${Math.round(value * 100)}%`, height: '100%', background: 'var(--accent)', borderRadius: 999 }} />}
      </div>
      <span className="num" style={{ fontSize: '0.75rem', width: '2rem', textAlign: 'right' }}>{text}</span>
    </>
  )
}
