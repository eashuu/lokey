import { useEffect, useRef, useState } from 'react'
import { Lock, Moon, Power, RotateCw, type LucideIcon } from 'lucide-react'
import type { PowerAction } from '@shared/protocol'
import { bridge } from '@/bridge'

const ITEMS: { id: PowerAction; label: string; Icon: LucideIcon; destructive?: boolean }[] = [
  { id: 'lock', label: 'Lock', Icon: Lock },
  { id: 'sleep', label: 'Sleep', Icon: Moon },
  { id: 'restart', label: 'Restart', Icon: RotateCw, destructive: true },
  { id: 'shutdown', label: 'Shut down', Icon: Power, destructive: true },
]

/** Four 92px buttons across the 604px content width (gap 10); destructive ones need a second press within 2.5 s. */
export function PowerTab() {
  const [armed, setArmed] = useState<PowerAction | null>(null)
  const [hover, setHover] = useState<PowerAction | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const press = (id: PowerAction, destructive?: boolean) => {
    clearTimeout(timer.current)
    if (destructive && armed !== id) {
      setArmed(id)
      timer.current = setTimeout(() => setArmed(null), 2500)
      return
    }
    setArmed(null)
    void bridge.call('power.do', { action: id }).catch(() => undefined)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, width: 604 }}>
      {ITEMS.map(({ id, label, Icon, destructive }) => {
        const on = armed === id
        return (
          <button
            key={id}
            onClick={() => press(id, destructive)}
            onMouseEnter={() => setHover(id)}
            onMouseLeave={() => setHover(h => (h === id ? null : h))}
            className="active:scale-[0.97]"
            style={{ position: 'relative', height: 92, borderRadius: 20, color: on ? 'var(--bad)' : 'var(--text)', background: on ? 'color-mix(in srgb, var(--bad) 18%, transparent)' : hover === id ? 'var(--fill-4)' : 'var(--fill-1)', transition: 'background-color .1s linear, color .1s linear, transform .1s linear' }}
          >
            <span style={{ position: 'absolute', left: 0, right: 0, top: 17, height: 26, display: 'grid', placeItems: 'center' }}><Icon size={26} strokeWidth={1.8} /></span>
            <span style={{ position: 'absolute', left: 4, right: 4, top: 52, height: 20, lineHeight: '20px', fontSize: 13, fontWeight: 500, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{on ? 'Confirm?' : label}</span>
          </button>
        )
      })}
    </div>
  )
}
