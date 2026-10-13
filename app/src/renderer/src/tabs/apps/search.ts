import type { AppEntry } from '@shared/protocol'

/** 0 prefix, 1 word-start, 2 substring, 3 subsequence, -1 no match. */
export function score(name: string, q: string): number {
  const n = name.toLowerCase()
  if (n.startsWith(q)) return 0
  if (n.split(/[\s\-_.()]+/).some(w => w.startsWith(q))) return 1
  if (n.includes(q)) return 2
  let i = 0
  for (const c of n) if (c === q[i] && ++i === q.length) return 3
  return -1
}

export function rank(apps: AppEntry[], query: string): AppEntry[] {
  const q = query.trim().toLowerCase()
  return apps
    .map(a => ({ a, s: score(a.name, q) }))
    .filter(x => x.s >= 0)
    .sort((x, y) => x.s - y.s || Number(y.a.starred) - Number(x.a.starred) || x.a.name.length - y.a.name.length || x.a.name.localeCompare(y.a.name))
    .map(x => x.a)
}
