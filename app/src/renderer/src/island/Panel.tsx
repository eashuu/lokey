import { useEffect, useRef, useState } from 'react'
import { useData } from '@/lib/data'
import { cn } from '@/lib/format'
import { tabs } from '@/tabs/registry'
import { useIsland } from './store'

/** The open panel: tab bar + the active tab. Content is mounted only while open (plus a short exit grace). */
export function Panel({ open, onHeight }: { open: boolean; onHeight: (h: number) => void }) {
  const tab = useIsland(s => s.tab)
  const order = useData(s => s.settings.island.tabs)
  const [mounted, setMounted] = useState(open)
  const inner = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) { setMounted(true); return }
    const t = setTimeout(() => setMounted(false), 600)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    const el = inner.current
    if (!el || !mounted) return
    const ro = new ResizeObserver(() => onHeight(Math.ceil(el.getBoundingClientRect().height)))
    ro.observe(el)
    onHeight(Math.ceil(el.getBoundingClientRect().height))
    return () => ro.disconnect()
  }, [mounted, tab, onHeight])

  const active = tabs[tab]
  const Active = active.Component
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', opacity: open ? 1 : 0, transition: `opacity ${open ? '180ms 60ms' : '120ms'} linear`, pointerEvents: open ? 'auto' : 'none' }}>
      {mounted && (
        <div ref={inner} style={{ padding: '0.625rem 1rem 1rem' }}>
          <TabBar current={tab} order={order} />
          <div key={tab} className="tab-in" style={{ marginTop: '0.75rem' }}>
            <Active />
          </div>
        </div>
      )}
    </div>
  )
}

function TabBar({ current, order }: { current: string; order: string[] }) {
  const setTab = useIsland(s => s.setTab)
  const onWheel = (e: React.WheelEvent) => {
    const i = order.indexOf(current)
    const n = order[Math.min(order.length - 1, Math.max(0, i + (e.deltaY > 0 ? 1 : -1)))]
    if (n && n !== current) setTab(n as never)
  }
  return (
    <div onWheel={onWheel} style={{ display: 'flex', justifyContent: 'center', gap: '0.125rem' }}>
      {order.map(id => {
        const t = tabs[id as keyof typeof tabs]
        if (!t) return null
        const on = id === current
        return (
          <button
            key={id}
            onClick={() => setTab(id as never)}
            className={cn('rounded-full')}
            style={{
              padding: '0.3125rem 0.75rem', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.01em',
              color: on ? 'var(--accent)' : 'var(--dim)', background: on ? 'var(--accent-soft)' : 'transparent',
              transition: 'color 160ms, background-color 160ms',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
