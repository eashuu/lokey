import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppEntry } from '@shared/protocol'
import { bridge } from '@/bridge'
import { useIsland } from '@/island/store'
import { Label } from '@/ui'
import { AppRow, FileRow } from './apps/AppRow'
import { rank } from './apps/search'
import { Kbd, SearchInput } from './clipboard/SearchInput'

interface FileHit { name: string; path: string }
type Item =
  | { k: 'h'; label: string }
  | { k: 'app'; e: AppEntry; i: number }
  | { k: 'file'; f: FileHit; i: number }

const MAX_ROWS = 200

// module-level cache so reopening the tab is instant; refreshed on mount and on `apps.changed`
let cache: AppEntry[] = []

function useApps() {
  const [apps, setApps] = useState(cache)
  useEffect(() => {
    let live = true
    const load = () => void bridge.call('apps.list', {}).then(r => {
      if (!live || !Array.isArray(r)) return
      cache = r
      setApps(r)
    }).catch(() => undefined)
    load()
    const off = bridge.on('apps.changed', load)
    return () => { live = false; off() }
  }, [])
  const star = useCallback((id: string, on: boolean) => {
    cache = cache.map(a => (a.id === id ? { ...a, starred: on } : a))
    setApps(cache)
    void bridge.call('apps.star', { id, on }).catch(() => undefined)
  }, [])
  return [apps, star] as const
}

export function AppsTab() {
  const [apps, star] = useApps()
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<FileHit[]>([])
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const q = query.trim()

  // file hits, debounced; stale answers are dropped
  useEffect(() => {
    setFiles([])
    if (q.length < 2) return
    let live = true
    const t = setTimeout(() => {
      void bridge.call('apps.searchFiles', { query: q, limit: 5 }).then(r => { if (live && Array.isArray(r)) setFiles(r.slice(0, 5)) }).catch(() => undefined)
    }, 200)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  const { items, flat } = useMemo(() => {
    const out: Item[] = []
    const flat: Item[] = []
    const add = (it: Item) => { out.push(it); if (it.k !== 'h') flat.push(it) }
    const addApps = (list: AppEntry[]) => list.forEach(e => add({ k: 'app', e, i: flat.length }))
    if (q) {
      addApps(rank(apps, q).slice(0, MAX_ROWS))
      if (files.length) { out.push({ k: 'h', label: 'Files' }); files.forEach(f => add({ k: 'file', f, i: flat.length })) }
    } else {
      const starred = apps.filter(a => a.starred)
      const recent = apps.filter(a => !a.starred && a.lastUsed).sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0)).slice(0, 5)
      const used = new Set([...starred, ...recent].map(a => a.id))
      const rest = apps.filter(a => !used.has(a.id)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_ROWS)
      if (starred.length) { out.push({ k: 'h', label: 'Starred' }); addApps(starred) }
      if (recent.length) { out.push({ k: 'h', label: 'Recent' }); addApps(recent) }
      if (rest.length) { out.push({ k: 'h', label: 'Applications' }); addApps(rest) }
    }
    return { items: out, flat }
  }, [apps, files, q])

  useEffect(() => setSel(0), [q])
  const cur = Math.min(sel, Math.max(0, flat.length - 1))

  const open = useCallback((i: number) => {
    const it = flat[i]
    if (!it) return
    if (it.k === 'app') void bridge.call('apps.launch', { id: it.e.id }).catch(() => undefined)
    else if (it.k === 'file') void bridge.call('apps.openPath', { path: it.f.path }).catch(() => undefined)
    useIsland.getState().closeIsland()
  }, [flat])

  // keys: the window only receives them while pinned; Esc is handled globally. Latest values via a ref.
  const live = useRef({ open, n: 0, cur: 0 })
  live.current = { open, n: flat.length, cur }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { open, n, cur } = live.current
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (n) setSel((cur + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
      } else if (e.key === 'Enter') open(cur)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { listRef.current?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: 'nearest' }) }, [cur])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <SearchInput value={query} onChange={setQuery} placeholder="Search apps, files and snippets…" hint={<Kbd>Win+A</Kbd>} />
      <div ref={listRef} className="scroll-y" style={{ height: '17.5rem' }}>
        {items.length === 0 && (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: '0.75rem', color: 'var(--dim)' }}>{q ? `No matches for “${q}”` : 'No apps found'}</div>
        )}
        {items.map((it, n) =>
          it.k === 'h' ? (
            <div key={`h-${it.label}`} style={{ padding: n === 0 ? '0 0.5rem 0.25rem' : '0.5rem 0.5rem 0.25rem' }}><Label>{it.label}</Label></div>
          ) : it.k === 'app' ? (
            <AppRow key={it.e.id} e={it.e} i={it.i} sel={it.i === cur} onOpen={open} onStar={star} />
          ) : (
            <FileRow key={it.f.path} name={it.f.name} path={it.f.path} i={it.i} sel={it.i === cur} onOpen={open} />
          ),
        )}
      </div>
    </div>
  )
}
