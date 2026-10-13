import { useEffect } from 'react'
import { bridge } from '@/bridge'
import { initData, useData } from '@/lib/data'
import { setAnimSpeed } from '@/lib/motion'
import { accentFromHex, accentFromImage, applyTheme, FALLBACK_ACCENT } from '@/lib/theme'
import { Island } from '@/island/Island'
import { useIsland } from '@/island/store'
import { runBench } from '@/bench'

export function App() {
  const appearance = useData(s => s.settings.appearance)
  const islandOn = useData(s => s.settings.island.enabled)
  const wallpaper = useData(s => s.wallpaper)

  useEffect(() => { void initData().then(async () => { if (await bridge.bench?.config()) void runBench() }) }, [])

  // screen-edge glow follows what the assistant is doing (voice mode drives `soul`; today only the preview does)
  useEffect(() => {
    let last = ''
    return useIsland.subscribe(s => {
      const g = s.soul === 'TALKING' ? 'speaking' : s.soul === 'THINKING' ? 'thinking' : 'off'
      if (g !== last) { last = g; bridge.effects.glow(g) }
    })
  }, [])

  // peek: volume / brightness changes briefly widen the pill (never while the panel is open)
  useEffect(() => {
    let prev = useData.getState()
    return useData.subscribe(cur => {
      const a = cur.audio, pa = prev.audio
      if (a && pa && (a.volume !== pa.volume || a.muted !== pa.muted)) {
        useIsland.getState().showPeek({ icon: a.muted ? 'mute' : 'volume', label: 'Volume', value: a.muted ? 0 : a.volume, text: a.muted ? 'Mute' : String(Math.round(a.volume * 100)) })
      }
      const b = cur.system?.brightness, pb = prev.system?.brightness
      if (b != null && pb != null && b !== pb) useIsland.getState().showPeek({ icon: 'brightness', label: 'Light', value: b, text: String(Math.round(b * 100)) })
      prev = cur
    })
  }, [])

  useEffect(() => {
    applyTheme(appearance.theme, appearance.scale)
    setAnimSpeed(appearance.reduceMotion ? 0 : appearance.animSpeed)
  }, [appearance.theme, appearance.scale, appearance.animSpeed, appearance.reduceMotion])

  // accent: follows the wallpaper thumbnail unless a fixed colour is chosen
  useEffect(() => {
    if (appearance.accent !== 'wallpaper') { accentFromHex(appearance.accent); return }
    if (!wallpaper) { accentFromHex(FALLBACK_ACCENT); return }
    let live = true
    void bridge.call('wallpaper.thumb', { path: wallpaper, size: 96 }).then(r => { if (live && r.thumb) void accentFromImage(r.thumb) }).catch(() => undefined)
    return () => { live = false }
  }, [appearance.accent, wallpaper])

  return islandOn ? <Island /> : null
}
