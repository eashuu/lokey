export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export function bytes(n: number, digits = 1): string {
  if (n < 1024) return `${Math.round(n)} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return `${n >= 100 ? Math.round(n) : n.toFixed(digits)} ${u[i]}`
}

export function rate(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB/s`
  return `${Math.round(n / 1e3)} KB/s`
}

export function duration(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h} h ${m} m` : `${m} m`
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function dayLabel(at: number, now = new Date()): string {
  const d = new Date(at)
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((a - b) / 86400000)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
}

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
