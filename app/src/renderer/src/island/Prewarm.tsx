import { useEffect, useState } from 'react'
import { useData } from '@/lib/data'
import { MenuContent } from './Panel'
import type { View } from './shapes'
import { useIsland } from './store'

/**
 * First-open stalls come from mounting a tab for the first time (layout, fonts, module code). Once the app has been
 * idle for a few seconds, mount each view once, off screen and invisible, one per idle slot, then drop it again.
 * Skips flyouts (they would start network scans) and never runs while the island is in use.
 */
export function Prewarm({ k }: { k: number }) {
  const order = useData(s => s.settings.island.tabs)
  const [current, setCurrent] = useState<View | null>(null)

  useEffect(() => {
    const queue: View[] = ['music', ...order]
    let cancelled = false
    let t: ReturnType<typeof setTimeout>
    const next = () => {
      if (cancelled) return
      const v = queue.shift()
      if (!v) { setCurrent(null); return }
      if (useIsland.getState().shape === 'menu') { queue.unshift(v); t = setTimeout(next, 1500); return }
      setCurrent(v)
      t = setTimeout(() => { setCurrent(null); t = setTimeout(next, 250) }, 450)
    }
    t = setTimeout(next, 5000)
    return () => { cancelled = true; clearTimeout(t) }
  }, [order])

  if (!current) return null
  return (
    <div aria-hidden style={{ position: 'fixed', left: -4000, top: 0, width: 1100, height: 700, opacity: 0, pointerEvents: 'none', contain: 'strict' }}>
      <MenuContent view={current} scale={0.9 * k} left={0} />
    </div>
  )
}
