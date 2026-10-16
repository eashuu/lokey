// The Android page's first script (vite.mobile.config.ts swaps it in for the renderer's own entry): installs the Node globals, restores the
// virtual disk, boots the core and publishes it as `window.lokey`, then loads the unchanged React UI, which picks `window.lokey` up like it
// does the Electron preload's. Outside the Android app, `?mobile=1` boots the same core in a desktop browser for testing; otherwise the UI
// runs on its mock bridge exactly as before.
import './shims/globals'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

declare global { interface Window { __lokeyBootError?: string } }

async function main() {
  // the native shell's two helper pages (docs/NATIVE-APP.md): the core without a UI, and the spirit alone
  if (/[?&]headless=1(&|$)/.test(location.search)) { await (await import('./headless')).runHeadless(); return }
  if (/[?&]spirit=1(&|$)/.test(location.search)) { await import('./spiritPage'); return }
  if (Capacitor.isNativePlatform() || /[?&]mobile=1\b/.test(location.search)) {
    try {
      const { vfsLoad } = await import('./vfs')
      await vfsLoad() // before any core module is evaluated: several read their files at import
      const { bootCore } = await import('./boot')
      window.lokey = (await bootCore()).bridge
    } catch (e) {
      delete (window as { lokey?: unknown }).lokey // a half-wired preload bridge would be worse than the mock
      window.__lokeyBootError = e instanceof Error ? (e.stack ?? e.message) : String(e)
      console.error('[lokey] the core failed to start; the UI falls back to sample data', e)
    }
  }
  await import('../renderer/src/main')
  if (Capacitor.isNativePlatform()) void backButton()
}

/** hardware / gesture back: close the island menu, else go back to Home, else send the app to the background (never exit: the assistant keeps running) */
async function backButton() {
  const [{ usePage }, { useIsland }] = await Promise.all([import('../renderer/src/phone/nav'), import('../renderer/src/island/store')])
  await App.addListener('backButton', () => {
    const isl = useIsland.getState(), nav = usePage.getState()
    if (isl.shape === 'menu') isl.closeMenu()
    else if (nav.page !== 'home') nav.go('home')
    else void App.minimizeApp()
  })
}
void main()
