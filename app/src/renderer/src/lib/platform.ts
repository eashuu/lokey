// Phone gate: every phone-only change in the renderer is behind `isPhone` (or CSS under `html.phone`), so the Windows UI is untouched.
// ?mobile=1 forces it (browser testing with the mock bridge), ?mobile=0 forbids it, ?sat=NN fakes a status-bar / punch-hole inset.
const q = (() => { try { return new URLSearchParams(location.search) } catch { return new URLSearchParams() } })()
const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor

export const isPhone: boolean = (() => {
  if (q.get('mobile') === '0') return false
  if (cap) return typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() || q.get('mobile') === '1' : true
  if (q.get('mobile') === '1') return true
  try { return innerWidth < 700 && matchMedia('(pointer: coarse)').matches } catch { return false }
})()

if (isPhone) {
  const root = document.documentElement
  root.classList.add('phone')
  if (q.has('sat')) root.style.setProperty('--sat', `${+q.get('sat')!}px`)
}

let probe: HTMLDivElement | null = null
/** safe-area insets in CSS px (status bar / punch hole at the top, gesture bar at the bottom) */
export function safeInsets() {
  if (!isPhone) return { top: 0, bottom: 0 }
  if (!probe) {
    probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:var(--sat,0px);padding-bottom:var(--sab,0px)'
    document.body.appendChild(probe)
  }
  const s = getComputedStyle(probe)
  return { top: parseFloat(s.paddingTop) || 0, bottom: parseFloat(s.paddingBottom) || 0 }
}

/** the area the island lives in: the window below the status bar */
export const viewport = () => ({ w: innerWidth, h: innerHeight - (isPhone ? safeInsets().top : 0) })

/** short vibration where the WebView allows it (Capacitor haptics, then the web API); silent otherwise */
export function haptic(kind: 'tick' | 'heavy' = 'tick') {
  try {
    const h = (window as unknown as { Capacitor?: { Plugins?: { Haptics?: { impact?: (o: { style: string }) => void } } } }).Capacitor?.Plugins?.Haptics
    if (h?.impact) { h.impact({ style: kind === 'heavy' ? 'HEAVY' : 'LIGHT' }); return }
    navigator.vibrate?.(kind === 'heavy' ? 28 : 10)
  } catch { /* no haptics */ }
}

export const prefersReducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }
