import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { House, Inbox as InboxIcon, Monitor, CalendarDays, UserRound, type LucideIcon } from 'lucide-react'
import type { MainPage } from '@shared/bridge'
import { bridge } from '@/bridge'
import { App } from '@/App'
import { useData } from '@/lib/data'
import { dur } from '@/lib/motion'
import { haptic } from '@/lib/platform'
import { accentFromHex } from '@/lib/theme'
import { skinPalette } from '@/island/skins'
import { LyricsWindow } from '@/lyrics/LyricsWindow'
import { Home } from './Home'
import { Inbox } from './Inbox'
import { Today } from './Today'
import { PcPage } from './PcPage'
import { You } from './You'
import { OriginIsland } from './OriginIsland'
import { NativeIsland } from './nativeIsland'
import { Onboarding, hasOnboarded } from './Onboarding'
import { initActivities, useIsl } from './activities'
import { initChat, useChat } from './chat'
import { fromMain, usePage, type PhonePage } from './nav'
import { initPhoneReactions } from './reactions'
import { spiritStats, useSpirit } from './spirit'
import { useFocus } from '@/lib/focus'
import { useIsland } from '@/island/store'
import './phone.css'

// dev hooks for browser testing with the mock bridge (stripped from production builds)
if ((import.meta as unknown as { env: { DEV: boolean } }).env.DEV) (window as unknown as { __phone: unknown }).__phone = { isl: useIsl, focus: useFocus, chat: useChat, data: useData, spirit: useSpirit, island: useIsland, stats: spiritStats }

const NAV: { id: PhonePage; label: string; icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'inbox', label: 'Inbox', icon: InboxIcon },
  { id: 'today', label: 'Today', icon: CalendarDays },
  { id: 'pc', label: 'PC', icon: Monitor },
  { id: 'you', label: 'You', icon: UserRound },
]

const q = new URLSearchParams(location.search)
const wantOnboarding = () => (q.get('onboard') === '1' ? true : q.get('onboard') === '0' ? false : !hasOnboarded())

/** `#settings?section=voice`, `#main?page=bond` (the desktop deep links) land on the matching phone page; `?page=inbox` is for testing */
function pageFromHash(): { page: PhonePage; section?: string } {
  const [h, qs = ''] = location.hash.split('?')
  const p = new URLSearchParams(qs)
  if (h === '#settings') return { page: 'you', section: p.get('section') ?? 'voice' }
  if (h === '#main') return fromMain((p.get('page') ?? 'home') as MainPage, p.get('section') ?? undefined)
  const page = q.get('page') as PhonePage | null
  return page && NAV.some(n => n.id === page) ? { page, section: q.get('section') ?? undefined } : { page: 'home' }
}

function Page({ id, children }: { id: string; children: ReactNode }) {
  return (
    <motion.div key={id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: dur(0.16) }} style={{ position: 'absolute', inset: 0 }}>{children}</motion.div>
  )
}

export function PhoneApp() {
  const page = usePage(s => s.page)
  const go = usePage(s => s.go)
  const asks = useIsl(s => s.pcAsks.length)
  const [hash, setHash] = useState(location.hash)
  const [onboard, setOnboard] = useState(wantOnboarding)
  const accent = useData(s => s.settings.appearance.accent)
  const skin = useData(s => s.settings.loadout?.soul)
  const dictPhase = useChat(s => s.dictation?.phase)
  const state = useChat(s => s.state)

  useEffect(() => { const p = pageFromHash(); if (p.page !== 'home') go(p.page, p.section) }, [go])
  useEffect(() => initChat(), [])
  useEffect(() => initActivities(), [])
  useEffect(() => initPhoneReactions(), [])
  useEffect(() => {
    const f = () => setHash(location.hash)
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  // the spirit's mode follows what is going on (the loadout page can override it to preview a state)
  useEffect(() => {
    const m = dictPhase === 'working' ? 'WRITING' : dictPhase === 'listening' || state === 'listening' || state === 'connecting' ? 'HEARING' : state === 'thinking' ? 'THINKING' : state === 'speaking' ? 'TALKING' : 'LISTENING'
    useSpirit.getState().setMode(m)
  }, [state, dictPhase])

  // one accent from the spirit (or a fixed colour); there is no wallpaper on a phone
  useEffect(() => { accentFromHex(accent === 'wallpaper' ? skinPalette(skin).glow : accent) }, [accent, skin])

  // the desktop code opens Settings / the main window / the lyrics window through the bridge; here those are pages of this app
  useEffect(() => {
    const app = bridge.app as { openSettings: (s?: string) => void; openMain: (p?: MainPage, s?: string) => void; onNav: (cb: (n: { page: MainPage; section?: string }) => void) => () => void }
    const lyr = bridge.lyrics as { openWindow: () => void; win: { close: () => void } }
    app.openSettings = s => go('you', s ?? 'voice')
    app.openMain = (p, s) => { const t = fromMain(p, s); go(t.page, t.section) }
    lyr.openWindow = () => { location.hash = '#lyrics' }
    lyr.win.close = () => { if (location.hash === '#lyrics') { if (history.length > 1) history.back(); else location.hash = '' } }
    return app.onNav(n => { const t = fromMain(n.page, n.section); go(t.page, t.section) })
  }, [go])

  const lyrics = hash === '#lyrics'
  return (
    <div className="ph-root" style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-sans)' }}>
      <App />
      <main className="ph-body" style={{ position: 'absolute', left: 0, right: 0, top: 'calc(var(--sat) + 52px)', bottom: 'calc(var(--sab) + 64px)' }}>
        <AnimatePresence initial={false} mode="popLayout">
          {page === 'home' && <Page id="home"><Home /></Page>}
          {page === 'inbox' && <Page id="inbox"><Inbox /></Page>}
          {page === 'today' && <Page id="today"><Today /></Page>}
          {page === 'pc' && <Page id="pc"><PcPage /></Page>}
          {page === 'you' && <Page id="you"><You /></Page>}
        </AnimatePresence>
      </main>

      <nav className="ph-nav" aria-label="Pages">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => { haptic(); go(id) }} style={{ position: 'relative' }}>
            <Icon size={22} />{label}
            {id === 'pc' && asks > 0 && <i aria-label={`${asks} waiting`} style={{ position: 'absolute', top: 6, right: '28%', width: 9, height: 9, borderRadius: 5, background: '#f5a524' }} />}
          </button>
        ))}
      </nav>

      {/* the Origin Island: over the camera, over everything; only its own shape takes touches */}
      <OriginIsland />
      <NativeIsland />

      {lyrics && <div style={{ position: 'absolute', inset: 0, zIndex: 90 }}><LyricsWindow /></div>}
      {onboard && <Onboarding onDone={() => { setOnboard(false); go('home') }} />}
    </div>
  )
}
