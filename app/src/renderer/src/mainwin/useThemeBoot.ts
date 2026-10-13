import { useEffect, useState, type CSSProperties } from 'react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { setAnimSpeed } from '@/lib/motion'
import { accentFromHex, accentFromImage, applyTheme, FALLBACK_ACCENT } from '@/lib/theme'

const VARS = ['--accent', '--accent-ink', '--accent-soft', '--chest', '--done', '--ember', '--panel']
const read = () => Object.fromEntries(VARS.map(v => [v, document.documentElement.style.getPropertyValue(v)]).filter(([, v]) => v)) as CSSProperties

/** Same theme wiring as App.tsx (theme, anim speed, wallpaper / fixed accent) for the main window. */
export function useThemeBoot(): CSSProperties {
  // The accent is also pinned on the main window's root element: SettingsApp (embedded as a page) rewrites the
  // document-level accent with its own fallback, and an inline value on a descendant wins over that.
  const [vars, setVars] = useState<CSSProperties>({})
  const snap = () => setVars(read())
  const appearance = useData(s => s.settings.appearance)
  const wallpaper = useData(s => s.wallpaper)

  useEffect(() => {
    applyTheme(appearance.theme, 1) // the main window ignores the island's UI scale
    setAnimSpeed(appearance.reduceMotion ? 0 : appearance.animSpeed)
  }, [appearance.theme, appearance.animSpeed, appearance.reduceMotion])

  useEffect(() => {
    if (appearance.accent !== 'wallpaper') { accentFromHex(appearance.accent); snap(); return }
    if (!wallpaper) { accentFromHex(FALLBACK_ACCENT); snap(); return }
    let live = true
    void bridge.call('wallpaper.thumb', { path: wallpaper, size: 96 })
      .then(async r => { if (live && r.thumb) { await accentFromImage(r.thumb); snap() } })
      .catch(() => undefined)
    return () => { live = false }
  }, [appearance.accent, wallpaper])
  return vars
}
