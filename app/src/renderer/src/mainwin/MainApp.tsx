import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Droplet, House, Link2, Monitor, Settings2, type LucideIcon } from 'lucide-react'
import type { MainPage } from '@shared/bridge'
import { initData } from '@/lib/data'
import { dur } from '@/lib/motion'
import { Mascot } from '@/island/Mascot'
import { Loadout } from './Loadout'
import { Home, SettingsPage } from './pages'
import { Bond, Desk } from './DeskBond'
import { useThemeBoot } from './useThemeBoot'
import './mainwin.css'

const NAV: { id: MainPage; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'bond', label: 'Bond', icon: Link2 },
  { id: 'soul', label: 'Soul', icon: Droplet },
  { id: 'desk', label: 'Desk', icon: Monitor },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

const pageFromHash = (): MainPage => {
  const p = new URLSearchParams(location.hash.split('?')[1] ?? '').get('page')
  return NAV.some(n => n.id === p) ? (p as MainPage) : 'soul'
}

let booted = false

export function MainApp() {
  const [page, setPage] = useState<MainPage>(pageFromHash)
  const accent = useThemeBoot()

  useEffect(() => {
    if (!booted) { booted = true; void initData() }
    const f = () => setPage(pageFromHash())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  return (
    <div className="lk-main" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'color-mix(in srgb, var(--bg) 78%, transparent)', ...accent }}>
      <header style={{ height: 44, flex: 'none', display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 14, WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <Mascot size={20} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>lokey</span>
      </header>
      <main style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <AnimatePresence initial={false}>
          <motion.div key={page} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur(0.15) }}
            style={{ position: 'absolute', inset: '0 0 64px 0' }}>
            {page === 'soul' && <Loadout />}
            {page === 'settings' && <SettingsPage />}
            {page === 'home' && <Home />}
            {page === 'bond' && <Bond />}
            {page === 'desk' && <Desk />}
          </motion.div>
        </AnimatePresence>
      </main>
      <nav aria-label="Pages" style={{ position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', borderRadius: 18, background: 'rgba(8,9,12,.62)', backdropFilter: 'blur(14px)' }}>
        <div className="lk-nav">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} className="lk-nav-btn" data-on={page === id} aria-label={label} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
              <Icon size={16} style={{ flex: 'none' }} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
