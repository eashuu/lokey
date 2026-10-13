import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import type { ClipItem } from '@shared/protocol'
import { bridge } from '@/bridge'
import { dayLabel } from '@/lib/format'
import { useIsland } from '@/island/store'
import { Chip, Label } from '@/ui'
import { ClipRow } from './clipboard/ClipRow'
import { SearchInput } from './clipboard/SearchInput'

type Kind = ClipItem['kind']
const FILTERS: { id: Kind | undefined; label: string; empty: string }[] = [
  { id: undefined, label: 'All', empty: 'Nothing copied yet' },
  { id: 'text', label: 'Text', empty: 'No text clips' },
  { id: 'image', label: 'Images', empty: 'No copied images' },
  { id: 'link', label: 'Links', empty: 'No copied links' },
]
const LIMIT = 200

export function ClipboardTab() {
  const [items, setItems] = useState<ClipItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<Kind | undefined>(undefined)
  const [confirm, setConfirm] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // list: immediate for filter changes, debounced 150 ms while typing
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      void bridge.call('clipboard.list', { query: query.trim() || undefined, kind, limit: LIMIT })
        .then(r => { if (live && Array.isArray(r)) { setItems(r); setLoaded(true) } })
        .catch(() => undefined)
    }, query ? 150 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [query, kind])

  // new copies merge in (if they match the current filter)
  useEffect(() => bridge.on('clipboard.changed', ({ item }) => {
    if (!item || (kind && item.kind !== kind)) return
    const q = query.trim().toLowerCase()
    if (q && !item.preview.toLowerCase().includes(q)) return
    setItems(prev => [item, ...prev.filter(x => x.id !== item.id)].slice(0, LIMIT))
  }), [query, kind])

  useEffect(() => () => clearTimeout(confirmTimer.current), [])

  const paste = useCallback((id: string) => {
    void bridge.call('clipboard.paste', { id }).catch(() => undefined)
    useIsland.getState().closeIsland()
  }, [])
  const pin = useCallback((id: string, on: boolean) => {
    setItems(p => p.map(x => (x.id === id ? { ...x, pinned: on } : x)))
    void bridge.call('clipboard.pin', { id, on }).catch(() => undefined)
  }, [])
  const del = useCallback((id: string) => {
    setItems(p => p.filter(x => x.id !== id))
    void bridge.call('clipboard.delete', { id }).catch(() => undefined)
  }, [])
  const clear = () => {
    if (!confirm) {
      setConfirm(true)
      confirmTimer.current = setTimeout(() => setConfirm(false), 2500)
      return
    }
    clearTimeout(confirmTimer.current)
    setConfirm(false)
    setItems(p => p.filter(x => x.pinned))
    void bridge.call('clipboard.clear', { keepPinned: true }).catch(() => undefined)
  }

  // pinned first, then the rest grouped by day (items arrive newest-first; sort anyway)
  const groups = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.at - a.at)
    const out: { label: string; items: ClipItem[] }[] = []
    const pinned = sorted.filter(x => x.pinned)
    if (pinned.length) out.push({ label: 'Pinned', items: pinned })
    for (const it of sorted) {
      if (it.pinned) continue
      const label = dayLabel(it.at)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(it)
      else out.push({ label, items: [it] })
    }
    return out
  }, [items])

  const filter = FILTERS.find(f => f.id === kind)!
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search clipboard history…" />
        {FILTERS.map(f => <Chip key={f.label} on={f.id === kind} onClick={() => setKind(f.id)}>{f.label}</Chip>)}
        <button
          onClick={clear}
          style={{ padding: '0.25rem 0.5rem', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600, color: confirm ? 'var(--bad)' : 'var(--dim)', transition: 'color 140ms', whiteSpace: 'nowrap' }}
        >
          {confirm ? 'Clear all?' : 'Clear'}
        </button>
      </div>
      <div className="scroll-y" style={{ height: '16rem' }}>
        {groups.length === 0 && (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', alignContent: 'center', justifyItems: 'center', gap: '0.5rem', color: 'var(--dim)', fontSize: '0.75rem', opacity: loaded ? 1 : 0 }}>
            <ClipboardList size={22} />
            {query.trim() ? `No matches for “${query.trim()}”` : filter.empty}
          </div>
        )}
        {groups.map((g, n) => (
          <div key={g.label}>
            <div style={{ padding: n === 0 ? '0 0.5rem 0.25rem' : '0.5rem 0.5rem 0.25rem' }}><Label>{g.label}</Label></div>
            {g.items.map(it => <ClipRow key={it.id} item={it} onPaste={paste} onPin={pin} onDelete={del} />)}
          </div>
        ))}
      </div>
      <div style={{ fontSize: '0.625rem', color: 'var(--dim)', textAlign: 'center' }}>History kept 30 days · encrypted on this PC</div>
    </div>
  )
}
