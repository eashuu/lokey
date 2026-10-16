// Headless mode of the Android page (`?headless=1`, set by the native shell's LokeyActivity): boot the same core as the WebView UI does, but mount
// no React UI. The native Compose app talks to it through the `LokeyCoreHost` JavascriptInterface (Kotlin `WebCore`); the protocol is in
// hostProtocol.ts and docs/NATIVE-APP.md. The LokeyNative Capacitor plugin keeps answering the core's native calls exactly as before.
import './shims/globals'
import { createHost, type HostOut } from './hostProtocol'

interface NativeHost { post(json: string): void }
declare global { interface Window { LokeyCoreHost?: NativeHost; __lokeyHost?: { recv(json: string): void } } }

const waitForHost = async (): Promise<NativeHost> => {
  for (let i = 0; i < 300; i++) { if (window.LokeyCoreHost) return window.LokeyCoreHost; await new Promise(r => setTimeout(r, 100)) }
  throw new Error('the native host did not attach')
}

/** plugin events (island.*, notification.*, reminder.fired...) as boot.ts re-dispatches them on window */
const native = {
  onEvent: (cb: (e: { name: string; data: unknown }) => void) => {
    const f = (e: Event) => cb((e as CustomEvent<{ name: string; data: unknown }>).detail)
    window.addEventListener('lokey:native', f)
    return () => window.removeEventListener('lokey:native', f)
  },
}

/** page-level hooks the phone UI used to set itself: the screenshot the agent's screen tool reads (phone/quick.tsx) */
const page = { setScreenshot: (shot: unknown) => { (window as unknown as { __lokeyScreenshot?: unknown }).__lokeyScreenshot = shot } }

export async function runHeadless(): Promise<void> {
  const nativeHost = await waitForHost()
  const post = (m: HostOut) => { try { nativeHost.post(JSON.stringify(m)) } catch (e) { console.error('[lokey] host post failed', e) } }
  const w = window as unknown as Record<string, unknown>
  const host = createHost(() => ({ bridge: w.lokey, confirm: w.lokeyConfirm, overlay: w.lokeyOverlay, native, core: w.__lokeyCore, page }), post)
  window.__lokeyHost = host // Kotlin: webView.evaluateJavascript("window.__lokeyHost.recv(<json string>)")
  try {
    const { vfsLoad } = await import('./vfs')
    await vfsLoad() // before any core module is evaluated: several read their files at import
    const { bootCore } = await import('./boot')
    const core = await bootCore()
    w.lokey = core.bridge
    post({ t: 'ready', ok: true, kind: core.bridge.kind })
  } catch (e) {
    const error = e instanceof Error ? (e.stack ?? e.message) : String(e)
    console.error('[lokey] the headless core failed to start', e)
    post({ t: 'ready', ok: false, error })
  }
}
