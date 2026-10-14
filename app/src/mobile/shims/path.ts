// POSIX path. The virtual file system is POSIX-style; a Windows-looking path like C:\x is just a plain segment.
export const sep = '/'
export const delimiter = ':'
const norm = (p: string) => {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..') } else out.push(s) }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.')
}
export const normalize = (p: string) => { const n = norm(p); return p.endsWith('/') && n !== '/' ? n + '/' : n }
export const join = (...a: string[]) => { const j = a.filter(Boolean).join('/'); return j ? norm(j) : '.' }
// ponytail: a Windows-style drive path (C:\x) counts as absolute and stays as it is, so the core's Windows path rules (safety.ts) keep their meaning
const drive = (p: string) => /^[A-Za-z]:[\\/]/.test(p)
export const isAbsolute = (p: string) => p.startsWith('/') || drive(p)
export const resolve = (...a: string[]) => { let r = ''; for (let i = a.length - 1; i >= 0 && !isAbsolute(r); i--) if (a[i]) r = a[i] + (r ? '/' + r : ''); return drive(r) ? r : norm(r.startsWith('/') ? r : '/' + r) }
export const dirname = (p: string) => { const n = norm(p); const i = n.lastIndexOf('/'); return i < 0 ? '.' : i === 0 ? '/' : n.slice(0, i) }
export const basename = (p: string, ext?: string) => { let b = p.replace(/\/+$/, ''); b = b.slice(b.lastIndexOf('/') + 1); return ext && b.endsWith(ext) && b !== ext ? b.slice(0, -ext.length) : b }
export const extname = (p: string) => { const b = basename(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i) }
export const relative = (from: string, to: string) => {
  const f = resolve(from).split('/').filter(Boolean), t = resolve(to).split('/').filter(Boolean)
  let i = 0
  while (i < f.length && i < t.length && f[i] === t[i]) i++
  return [...f.slice(i).map(() => '..'), ...t.slice(i)].join('/')
}
export const parse = (p: string) => ({ root: p.startsWith('/') ? '/' : '', dir: dirname(p), base: basename(p), ext: extname(p), name: basename(p, extname(p)) })
export const posix = { sep, delimiter, normalize, join, isAbsolute, resolve, dirname, basename, extname, relative, parse }
export const win32 = posix
export default posix
