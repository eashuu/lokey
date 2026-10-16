// `?spirit=1`: a page that shows only the existing WebGL spirit (renderer/src/phone/spirit.tsx), for the native app's `SpiritView` (one small plain
// WebView inside the Compose UI). The native side drives it through `window.__spirit` and hears the long-press (hold to talk) through the
// optional `LokeySpirit` JavascriptInterface. No core runs here, so the renderer sees the mock bridge.
import '../renderer/src/lib/platform' // first: it marks <html class="phone"> before anything is styled
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../renderer/src/design/tokens.css'
import '../renderer/src/phone/phone.css'
import { Spirit, useSpirit } from '../renderer/src/phone/spirit'
import { mascot } from '../renderer/src/mascot/bus'
import { useData } from '../renderer/src/lib/data'
import type { EmoteKind } from '../renderer/src/mascot/bus'
import type { SoulMode } from '../renderer/src/island/store'

interface SpiritCmd { mode?: SoulMode; skin?: string; calm?: boolean; play?: string; emote?: EmoteKind }
declare global { interface Window { __spirit?: { set(json: string): void }; LokeySpirit?: { hold(on: boolean): void; tap(): void } } }

function SpiritPage() {
  const [size, setSize] = useState(() => Math.max(64, Math.min(innerWidth, innerHeight)))
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const holding = useRef(false)
  useEffect(() => {
    const onSize = () => setSize(Math.max(64, Math.min(innerWidth, innerHeight)))
    addEventListener('resize', onSize)
    window.__spirit = {
      set(json) {
        let c: SpiritCmd
        try { c = JSON.parse(json) as SpiritCmd } catch { return }
        if (c.mode) useSpirit.getState().setMode(c.mode)
        if (c.skin !== undefined || c.calm !== undefined) useData.setState(s => ({ settings: { ...s.settings, loadout: { ...s.settings.loadout, soul: c.skin ?? s.settings.loadout.soul }, phone: { ...s.settings.phone, spirit: c.calm === undefined ? s.settings.phone.spirit : c.calm ? 'calm' : 'full' } } }))
        if (c.play) mascot.play(c.play)
        if (c.emote) mascot.emote(c.emote)
      },
    }
    return () => { removeEventListener('resize', onSize); delete window.__spirit }
  }, [])
  // tap = poke (the Spirit component reacts itself); long-press = hold to talk, reported to the native side
  const down = () => { holding.current = false; clearTimeout(timer.current); timer.current = setTimeout(() => { holding.current = true; window.LokeySpirit?.hold(true) }, 420); window.LokeySpirit?.tap() }
  const up = () => { clearTimeout(timer.current); if (holding.current) { holding.current = false; window.LokeySpirit?.hold(false) } }
  return (
    <div onPointerDown={down} onPointerUp={up} onPointerCancel={up} onContextMenu={e => e.preventDefault()} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
      <Spirit size={size} poke emotes />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<SpiritPage />)
