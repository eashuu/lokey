import { Capacitor, registerPlugin } from '@capacitor/core'

// The Kotlin plugin `LokeyNative` (app/mobile/android, see PLUGIN.md there): one method, `call({ method, params })`, that always resolves
// `{ result }` (a failure is `{ result: { ok: false, reason } }`, never a rejection) and one event stream `addListener('event', ({ name, data }))`.
// Method names are the sidecar's (shared/protocol.ts) plus phone-only ones; nativeMap.ts translates the few places where the core's names differ.
interface Plugin {
  call(o: { method: string; params?: unknown }): Promise<unknown>
  addListener(ev: 'event', cb: (e: { name: string; data: unknown }) => void): Promise<{ remove(): Promise<void> }>
}

// `globalThis.__lokeyNative` lets `pnpm mobile:check` (and a browser test page) stand in for the plugin
const injected = () => (globalThis as unknown as { __lokeyNative?: Plugin }).__lokeyNative ?? null
let plugin: Plugin | null = null
const get = (): Plugin => injected() ?? (plugin ??= registerPlugin<Plugin>('LokeyNative'))

/** true inside the Android app once the Kotlin plugin is registered (false in a browser and while the plugin does not exist yet) */
export function hasNative(): boolean {
  if (injected()) return true
  try { return !!Capacitor?.isNativePlatform?.() && Capacitor.isPluginAvailable('LokeyNative') } catch { return false }
}

/** the plugin wraps every answer as { result }; a bare answer (older plugin, test double) passes through */
const unwrap = (r: unknown) => {
  if (r && typeof r === 'object' && !Array.isArray(r)) { const k = Object.keys(r); if (k.length === 1 && k[0] === 'result') return (r as { result: unknown }).result }
  return r
}

export class NativeUnavailable extends Error { constructor(m: string) { super(m) } }

/** call a plugin method; rejects with NativeUnavailable when there is no plugin or it does not know the method ("unknown method" answer) */
export async function nativeCall<T = unknown>(method: string, params: unknown = {}, timeoutMs = 15_000): Promise<T> {
  if (!hasNative()) throw new NativeUnavailable('native plugin not available')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const r = unwrap(await Promise.race([get().call({ method, params }), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`${method} timed out`)), timeoutMs) })]))
    if (r && typeof r === 'object' && (r as { ok?: unknown }).ok === false && /unknown method|not implemented/i.test(String((r as { reason?: unknown }).reason ?? ''))) throw new NativeUnavailable(String((r as { reason?: unknown }).reason))
    return r as T
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (!(e instanceof NativeUnavailable) && /unimplemented|not implemented|unknown method|no such method/i.test(m)) throw new NativeUnavailable(m)
    throw e
  } finally { clearTimeout(timer) }
}

/** subscribe to native events (media.changed, stats.tick, ...); returns an unsubscribe. A no-op without the plugin. */
export function onNativeEvent(cb: (name: string, data: unknown) => void): () => void {
  if (!hasNative()) return () => undefined
  let h: { remove(): Promise<void> } | null = null, dead = false
  void get().addListener('event', e => cb(e.name, e.data)).then(x => { if (dead) void x.remove(); else h = x }).catch(() => undefined)
  return () => { dead = true; void h?.remove() }
}
