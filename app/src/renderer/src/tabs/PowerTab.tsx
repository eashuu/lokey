import { useEffect, useRef, useState } from 'react'
import { Lock, LogOut, Moon, Power, RotateCw, Snowflake, type LucideIcon } from 'lucide-react'
import type { PowerAction } from '@shared/protocol'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'

const ITEMS: { id: PowerAction; label: string; Icon: LucideIcon; destructive?: boolean }[] = [
  { id: 'lock', label: 'Lock', Icon: Lock },
  { id: 'sleep', label: 'Sleep', Icon: Moon },
  { id: 'hibernate', label: 'Hibernate', Icon: Snowflake },
  { id: 'signout', label: 'Sign out', Icon: LogOut, destructive: true },
  { id: 'restart', label: 'Restart', Icon: RotateCw, destructive: true },
  { id: 'shutdown', label: 'Shut down', Icon: Power, destructive: true },
]

export function PowerTab() {
  const user = useData(s => s.user)
  const [armed, setArmed] = useState<PowerAction | null>(null)
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '9rem' }}>
      {user && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '1.75rem' }}>
          <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '0.5rem', background: 'var(--s2)', overflow: 'hidden', flex: 'none', display: 'grid', placeItems: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted)' }}>
            {user.avatar ? <img src={user.avatar} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : user.name.slice(0, 1).toUpperCase()}
          </div>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</span>
          <span className="num" style={{ fontSize: '0.6875rem', color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.machine}</span>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.5rem' }}>
        {ITEMS.map(({ id, label, Icon, destructive }) => {
          const on = armed === id
          return (
            <button
              key={id}
              onClick={() => press(id, destructive)}
              className={on ? 'card active:scale-[0.96]' : 'card hover:bg-s2 active:scale-[0.96]'}
              style={{
                height: '4.25rem', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                color: on ? 'var(--bad)' : 'var(--text)',
                ...(on ? { background: 'color-mix(in srgb, var(--bad) 16%, var(--s1))', borderColor: 'color-mix(in srgb, var(--bad) 45%, transparent)' } : null),
                transition: 'background-color 140ms, color 140ms, border-color 140ms, transform 120ms',
              }}
            >
              <Icon size={20} />
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{on ? 'Confirm?' : label}</span>
            </button>
          )
        })}
      </div>
      <div style={{ fontSize: '0.6875rem', color: 'var(--dim)', textAlign: 'center' }}>Destructive actions need a second click.</div>
    </div>
  )
}
