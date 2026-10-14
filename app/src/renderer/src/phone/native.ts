import { bridge } from '@/bridge'

// Phone-only plugin methods (app/mobile/android/PLUGIN.md) go through the same bridge.call as everything else; they are not in the
// typed protocol, so this is the one untyped door. A failed call resolves { ok:false, reason }, never rejects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const native = (method: string, params: unknown = {}): Promise<any> => (bridge.call as unknown as (m: string, p: unknown) => Promise<unknown>)(method, params).catch(e => ({ ok: false, reason: String(e?.message ?? e) }))

/** "permission needed: contacts (perm.request contacts)" -> the permission name, or null when the failure is something else */
export const needsPerm = (r: unknown): string | null => {
  const reason = (r as { ok?: boolean; reason?: string } | null)?.reason
  if (!reason || (r as { ok?: boolean }).ok !== false) return null
  const m = /permission needed: ([\w-]+)/.exec(reason)
  return m ? m[1] : null
}
export const isFail = (r: unknown) => !!r && typeof r === 'object' && (r as { ok?: boolean }).ok === false

/** link extras the Android core adds on top of the shared Bridge type (see mobile/boot.ts) */
type Link = { say?: (text: string) => Promise<{ ok: boolean; error?: string }> }
export const linkSay = async (text: string) => {
  const l = bridge.link as unknown as Link
  if (l.say) return l.say(text)
  const core = (window as unknown as { __lokeyCore?: { linkClient?: Link } }).__lokeyCore
  if (core?.linkClient?.say) return core.linkClient.say(text)
  return { ok: false, error: 'Not paired with a PC in this build' }
}

/** native plugin events by name (island.*, notification.*, reminder.fired...): through the bridge's own bus when it forwards them, and through the
 *  `lokey:native` window event the mobile core fires for every plugin event (mobile/boot.ts). One call per delivery. */
export function onNativeName(names: string[], cb: (name: string, data: Record<string, unknown>) => void): () => void {
  const seen = new Set<string>()
  const once = (name: string, data: unknown) => {
    const d = (data ?? {}) as Record<string, unknown>
    const k = name + JSON.stringify(d).slice(0, 200) + Math.floor(performance.now() / 50)
    if (seen.has(k)) return
    seen.add(k); setTimeout(() => seen.delete(k), 200)
    cb(name, d)
  }
  const on = bridge.on as unknown as (e: string, f: (d: unknown) => void) => () => void
  const offs = names.map(n => { try { return on(n, d => once(n, d)) } catch { return () => undefined } })
  const w = (e: Event) => { const { name, data } = (e as CustomEvent<{ name: string; data: unknown }>).detail; if (names.includes(name)) once(name, data) }
  window.addEventListener('lokey:native', w)
  return () => { offs.forEach(f => f?.()); window.removeEventListener('lokey:native', w) }
}
