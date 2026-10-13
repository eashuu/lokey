import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Zap } from 'lucide-react'
import type { AppEntry } from '@shared/protocol'
import { bridge } from '@/bridge'
import { useIsland } from '@/island/store'
import { AppRow, FileRow } from './apps/AppRow'
import { rank } from './apps/search'
import { SearchInput } from './clipboard/SearchInput'

interface FileHit { name: string; path: string }
type Item =
  | { k: 'h'; label: string; top: number }
  | { k: 'app'; e: AppEntry; i: number; top: number }
  | { k: 'file'; f: FileHit; i: number; top: number }

const MAX_ROWS = 200
const RECENT_KEY = 'lokey.apps.recent.v1'
const RECENT_MAX = 5
const PAGE_H = 564
const OVERSCAN = 6 * 42

function loadRecent(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch { return [] }
}

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

/** A previous search term: 32 high, width 7*len+44, accent bolt dot at (6,6). */
function Chip({ x, term, onClick }: { x: number; term: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="transition duration-100 ease-linear hover:bg-[var(--fill-3)] active:scale-[.96]"
      style={{ position: 'absolute', left: x, top: 0, width: 7 * term.length + 44, height: 32, borderRadius: 16, background: 'var(--fill-1)', color: 'var(--soft)', fontSize: 12, fontWeight: 500, textAlign: 'left', paddingLeft: 32, lineHeight: '32px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      <i style={{ position: 'absolute', left: 6, top: 6, width: 20, height: 20, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--accent) 35%, transparent)', color: 'var(--accent)' }}><Zap size={11} fill="currentColor" /></i>
      {term}
    </button>
  )
}

export function AppsTab() {
  const [apps, star] = useApps()
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState(loadRecent)
  const [files, setFiles] = useState<FileHit[]>([])
  const [sel, setSel] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const q = query.trim()

  // remember a search the user committed (Enter, or launching a result): last 5 distinct terms
  const commit = useCallback((term: string) => {
    const t = term.trim().slice(0, 24)
    if (!t) return
    setRecent(prev => {
      const next = [t, ...prev.filter(x => x.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_MAX)
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
      return next
    })
  }, [])

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

  // chips row (top 56, x += width + 8) pushes the list from y 56 to y 96
  const chips = useMemo(() => {
    let x = 0
    const out: { term: string; x: number }[] = []
    for (const term of recent) {
      const w = 7 * term.length + 44
      if (x + w > 684) break
      out.push({ term, x })
      x += w + 8
    }
    return out
  }, [recent])
  const listTop = chips.length ? 96 : 56
  const listH = PAGE_H - listTop

  // positions inside the list: header top e+4 (h20, e += 24), row top e (h42, e += 42)
  const { items, flat, height } = useMemo(() => {
    const out: Item[] = []
    const flat: Item[] = []
    let e = 0
    const head = (label: string) => { out.push({ k: 'h', label, top: e + 4 }); e += 24 }
    const row = (mk: (i: number, top: number) => Item) => { const it = mk(flat.length, e); out.push(it); flat.push(it); e += 42 }
    const addApps = (list: AppEntry[]) => list.forEach(a => row((i, top) => ({ k: 'app', e: a, i, top })))
    if (q) {
      addApps(rank(apps, q).slice(0, MAX_ROWS))
      if (files.length) { head('Files'); files.forEach(f => row((i, top) => ({ k: 'file', f, i, top }))) }
    } else {
      const starred = apps.filter(a => a.starred)
      const recentApps = apps.filter(a => !a.starred && a.lastUsed).sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0)).slice(0, 5)
      const used = new Set([...starred, ...recentApps].map(a => a.id))
      const rest = apps.filter(a => !used.has(a.id)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_ROWS)
      if (starred.length) { head('Starred'); addApps(starred) }
      if (recentApps.length) { head('Recent'); addApps(recentApps) }
      if (rest.length) { head('Applications'); addApps(rest) }
    }
    return { items: out, flat, height: e }
  }, [apps, files, q])

  useEffect(() => setSel(0), [q])
  const cur = Math.min(sel, Math.max(0, flat.length - 1))

  const open = useCallback((i: number) => {
    if (q) commit(q)
    const it = flat[i]
    if (!it) return
    if (it.k === 'app') void bridge.call('apps.launch', { id: it.e.id }).catch(() => undefined)
    else if (it.k === 'file') void bridge.call('apps.openPath', { path: it.f.path }).catch(() => undefined)
    useIsland.getState().closeIsland()
  }, [flat, q, commit])

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

  // rows are virtualised, so keep the selected one in view by arithmetic rather than scrollIntoView
  useEffect(() => {
    const el = listRef.current
    const top = flat[cur]?.top
    if (!el || top === undefined) return
    if (cur === 0) el.scrollTop = 0
    else if (top < el.scrollTop) el.scrollTop = top
    else if (top + 42 > el.scrollTop + listH) el.scrollTop = top + 42 - listH
  }, [cur, flat, listH])

  const lo = scrollTop - OVERSCAN
  const hi = scrollTop + listH + OVERSCAN
  return (
    <div style={{ position: 'relative', width: 684, height: PAGE_H }}>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search apps, files and snippets…"
        height={46}
        fontSize={17}
        iconLeft={13}
        iconTop={14}
        iconSize={18}
        textLeft={40}
        rightPad={72}
        right={!query && <span style={{ position: 'absolute', right: 12, top: 0, height: 46, lineHeight: '46px', fontSize: 11, color: 'var(--muted)', pointerEvents: 'none' }}>Win+A</span>}
      />
      {chips.length > 0 && (
        <div style={{ position: 'absolute', left: 0, top: 56, width: 684, height: 32 }}>
          {chips.map(c => <Chip key={c.term} x={c.x} term={c.term} onClick={() => { useIsland.setState({ mode: 'pinned' }); setQuery(c.term) }} />)}
        </div>
      )}
      <div ref={listRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} className="scroll-y" style={{ position: 'absolute', left: 0, top: listTop, width: 684, height: listH, overflowX: 'hidden' }}>
        {items.length === 0 && (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--muted)' }}>{q ? `No matches for “${q}”` : 'No apps found'}</div>
        )}
        <div style={{ position: 'relative', height }}>
          {items.map(it => {
            if (it.top + 42 < lo || it.top > hi) return null
            return it.k === 'h' ? (
              <div key={`h-${it.label}`} style={{ position: 'absolute', left: 10, top: it.top, height: 20, lineHeight: '20px', fontSize: 11, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>{it.label}</div>
            ) : it.k === 'app' ? (
              <AppRow key={it.e.id} e={it.e} i={it.i} top={it.top} sel={it.i === cur} onOpen={open} onStar={star} />
            ) : (
              <FileRow key={it.f.path} name={it.f.name} path={it.f.path} i={it.i} top={it.top} sel={it.i === cur} onOpen={open} />
            )
          })}
        </div>
      </div>
    </div>
  )
}
