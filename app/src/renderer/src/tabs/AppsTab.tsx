import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppEntry } from '@shared/protocol'
import { bridge } from '@/bridge'
import { useIsland } from '@/island/store'
import { AppRow, FileRow } from './apps/AppRow'
import { rank } from './apps/search'
import { SearchInput } from './clipboard/SearchInput'

interface FileHit { name: string; path: string }
type Item =
  | { k: 'h'; label: string }
  | { k: 'app'; e: AppEntry; i: number }
  | { k: 'file'; f: FileHit; i: number }

type Filter = 'apps' | 'games' | 'files'
const CHIPS: { id: Filter; label: string }[] = [
  { id: 'apps', label: 'Apps' },
  { id: 'games', label: 'Games' },
  { id: 'files', label: 'Files' },
]

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

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={on ? undefined : 'hover:bg-[var(--fill-2)]'}
      style={{ position: 'relative', height: 32, padding: '0 14px 0 32px', borderRadius: 16, fontSize: 13, fontWeight: 500, background: on ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--fill-1)', color: on ? 'var(--accent)' : 'var(--soft)', transition: 'background-color 140ms, color 140ms' }}
    >
      <i style={{ position: 'absolute', left: 6, top: 6, width: 20, height: 20, borderRadius: 10, background: `color-mix(in srgb, var(--accent) ${on ? 100 : 28}%, transparent)` }} />
      {children}
    </button>
  )
}

export function AppsTab() {
  const [apps, star] = useApps()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter | null>(null)
  const [files, setFiles] = useState<FileHit[]>([])
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const q = query.trim()
  const filesOnly = filter === 'files'

  // file hits, debounced; stale answers are dropped
  useEffect(() => {
    setFiles([])
    if (q.length < 2 || filter === 'apps' || filter === 'games') return
    const limit = filesOnly ? 30 : 5
    let live = true
    const t = setTimeout(() => {
      void bridge.call('apps.searchFiles', { query: q, limit }).then(r => { if (live && Array.isArray(r)) setFiles(r.slice(0, limit)) }).catch(() => undefined)
    }, 200)
    return () => { live = false; clearTimeout(t) }
  }, [q, filter, filesOnly])

  const { items, flat } = useMemo(() => {
    const out: Item[] = []
    const flat: Item[] = []
    const add = (it: Item) => { out.push(it); if (it.k !== 'h') flat.push(it) }
    const addApps = (list: AppEntry[]) => list.forEach(e => add({ k: 'app', e, i: flat.length }))
    const addFiles = () => { if (files.length) { out.push({ k: 'h', label: 'Files' }); files.forEach(f => add({ k: 'file', f, i: flat.length })) } }
    const pool = filter === 'apps' ? apps.filter(a => a.kind !== 'game') : filter === 'games' ? apps.filter(a => a.kind === 'game') : apps
    if (filesOnly) addFiles()
    else if (q) { addApps(rank(pool, q).slice(0, MAX_ROWS)); addFiles() }
    else {
      const starred = pool.filter(a => a.starred)
      const recent = pool.filter(a => !a.starred && a.lastUsed).sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0)).slice(0, 5)
      const used = new Set([...starred, ...recent].map(a => a.id))
      const rest = pool.filter(a => !used.has(a.id)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_ROWS)
      if (starred.length) { out.push({ k: 'h', label: 'Starred' }); addApps(starred) }
      if (recent.length) { out.push({ k: 'h', label: 'Recent' }); addApps(recent) }
      if (rest.length) { out.push({ k: 'h', label: 'Applications' }); addApps(rest) }
    }
    return { items: out, flat }
  }, [apps, files, q, filter, filesOnly])

  useEffect(() => setSel(0), [q, filter])
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

  const empty = filesOnly && q.length < 2 ? 'Type to search your files' : q ? `No matches for “${q}”` : 'No apps found'
  return (
    <div style={{ position: 'relative', width: 684, height: 568 }}>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search apps, files and snippets…"
        height={46}
        fontSize={17}
        iconLeft={14}
        iconSize={18}
        textLeft={40}
        rightPad={72}
        right={!query && <span style={{ position: 'absolute', right: 12, top: 0, height: 46, lineHeight: '46px', fontSize: 11, color: 'var(--muted)', pointerEvents: 'none' }}>Win+A</span>}
      />
      <div style={{ position: 'absolute', left: 0, top: 56, display: 'flex', gap: 8 }}>
        {CHIPS.map(c => <Chip key={c.id} on={filter === c.id} onClick={() => setFilter(f => (f === c.id ? null : c.id))}>{c.label}</Chip>)}
      </div>
      <div ref={listRef} className="scroll-y" style={{ position: 'absolute', left: 0, top: 98, width: 684, height: 470 }}>
        {items.length === 0 && (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--muted)' }}>{empty}</div>
        )}
        {items.map((it, n) =>
          it.k === 'h' ? (
            <div key={`h-${it.label}`} style={{ height: 20, lineHeight: '20px', padding: '0 10px', marginTop: n === 0 ? 0 : 8, fontSize: 11, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>{it.label}</div>
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
