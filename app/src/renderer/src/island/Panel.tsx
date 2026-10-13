import { useData } from '@/lib/data'
import { cn } from '@/lib/format'
import { motion } from 'motion/react'
import { tabs } from '@/tabs/registry'
import { MENU_SIZE, TAB_WIDTH, type View } from './shapes'
import { useIsland } from './store'
import type { TabId } from '@shared/bridge'
import { MusicView } from '@/tabs/MusicView'
import { FlyoutView } from '@/tabs/flyouts'

/** Where tab content starts inside the menu box, in design pixels (see UI-SPEC section 4). */
export const CONTENT_X = 18
export const CONTENT_Y = 56

/**
 * Menu content for one view, laid out at its design size (w x h) and scaled by `scale` as a whole, so every
 * measurement in UI-SPEC.md applies as written. The clip-path morph reveals it; this box never animates.
 */
export function MenuContent({ view, scale, left }: { view: View; scale: number; left: number }) {
  const { w, h } = MENU_SIZE[view]
  return (
    <div style={{ position: 'absolute', top: 0, left, width: w * scale, height: h * scale }}>
      <div style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: '0 0', position: 'relative', fontFamily: 'var(--font-island)', color: 'var(--text)' }}>
        {view === 'music' ? <MusicView /> : view === 'wifi' || view === 'bluetooth' || view === 'audio' ? <FlyoutView view={view} w={w} h={h} /> : <TabbedView view={view} w={w} />}
      </div>
    </div>
  )
}

function TabbedView({ view, w }: { view: TabId; w: number }) {
  const order = useData(s => s.settings.island.tabs)
  const Active = tabs[view].Component
  return (
    <>
      <TabBar current={view} order={order} w={w} />
      <motion.div key={view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.14, ease: 'linear' }} style={{ position: 'absolute', left: CONTENT_X, top: CONTENT_Y, width: w - CONTENT_X * 2 }}>
        <Active />
      </motion.div>
    </>
  )
}

export function TabBar({ current, order, w }: { current: TabId; order: TabId[]; w: number }) {
  const setView = useIsland(s => s.setView)
  const onWheel = (e: React.WheelEvent) => {
    e.stopPropagation()
    const i = order.indexOf(current)
    const n = order[Math.min(order.length - 1, Math.max(0, i + (e.deltaY > 0 ? 1 : -1)))]
    if (n && n !== current) setView(n)
  }
  const total = order.reduce((s, id) => s + TAB_WIDTH[id], 0) + 6 * (order.length - 1)
  return (
    <div onWheel={onWheel} style={{ position: 'absolute', top: 15, left: 18 + (w - 36 - total) / 2, width: total, display: 'flex', gap: 6 }}>
      {order.map(id => {
        const on = id === current
        return (
          <button
            key={id}
            onClick={() => setView(id)}
            data-on={on}
            className={cn('tab-btn')}
            style={{ width: TAB_WIDTH[id], height: 28, borderRadius: 14, fontSize: 13, display: 'grid', placeItems: 'center', whiteSpace: 'nowrap' }}
          >
            {tabs[id].label}
          </button>
        )
      })}
    </div>
  )
}
