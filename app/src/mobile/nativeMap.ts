// Where the core / UI speak differently from the plugin (PLUGIN.md): permission names and shapes, list methods that must stay lists when the
// plugin answers { ok:false, reason }. Everything else goes through under the sidecar's own names.

/** the names the phone UI uses -> the plugin's */
const PERM_TO_NATIVE: Record<string, string> = { microphone: 'mic', notification_listener: 'notification-listener', battery: 'battery-optimisation-exempt' }
const PERM_FROM_NATIVE = Object.fromEntries(Object.entries(PERM_TO_NATIVE).map(([k, v]) => [v, k]))

export function toNative(method: string, params: unknown): unknown {
  if ((method === 'perm.status' || method === 'perm.request') && params && typeof params === 'object') {
    const n = (params as { name?: unknown }).name
    if (typeof n === 'string') return { ...(params as object), name: PERM_TO_NATIVE[n] ?? n }
  }
  return params
}

/** results the UI iterates: an { ok:false, reason } answer (permission missing, throttled...) becomes an empty list */
const LISTS = new Set(['wifi.scan', 'bt.devices', 'bt.discover', 'audio.devices', 'apps.list', 'apps.searchFiles', 'clipboard.list', 'wallpaper.recent', 'wallpaper.folder', 'windows.list', 'process.list', 'notifications.list', 'contacts.search', 'sms.list', 'calllog.list', 'calendar.list', 'reminder.list'])

export function fromNative(method: string, r: unknown): unknown {
  if (LISTS.has(method) && !Array.isArray(r)) return []
  if (method === 'perm.status') {
    const o = r as { permissions?: Record<string, boolean>; name?: string; granted?: boolean; kind?: string } | null
    if (o?.permissions) {
      // { mic: true, ... } -> the UI's keys, keeping the plugin's own too
      const out: Record<string, boolean> = { ...o.permissions }
      for (const [k, v] of Object.entries(PERM_FROM_NATIVE)) if (k in o.permissions) out[v] = o.permissions[k]
      return out
    }
    if (o?.name) return { ...o, name: PERM_FROM_NATIVE[o.name] ?? o.name }
  }
  return r
}
