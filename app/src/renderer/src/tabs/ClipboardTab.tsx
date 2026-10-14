import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ClipboardList, Settings } from 'lucide-react'
import type { ClipItem } from '@shared/protocol'
import { bridge } from '@/bridge'
import { dayLabel } from '@/lib/format'
import { useIsland } from '@/island/store'
import { Kbd } from '@/ui'
import { ClipRow } from './clipboard/ClipRow'
import { Preview } from './clipboard/Preview'
import { SearchInput } from './clipboard/SearchInput'

type Kind = ClipItem['kind']
const FILTERS: { id: Kind | undefined; label: string; empty: string }[] = [
  { id: undefined, label: 'All', empty: 'Nothing copied yet' },
  { id: 'text', label: 'Text', empty: 'No text clips' },
  { id: 'image', label: 'Images', empty: 'No copied images' },
  { id: 'link', label: 'Links', empty: 'No copied links' },
]
const LIMIT = 200

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={`transition duration-100 ease-linear active:scale-[.96] ${on ? '' : 'hover:bg-[var(--fill-3)]'}`}
      style={{ height: 28, padding: '0 12px', borderRadius: 14, fontSize: 12, fontWeight: 500, background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-ink)' : 'var(--soft)' }}
    >
      {children}
    </button>
  )
}

const hintLabel = { fontSize: 12, color: 'var(--soft)' } as const

export function ClipboardTab() {
  const [items, setItems] = useState<ClipItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<Kind | undefined>(undefined)
  const [confirm, setConfirm] = useState(false)
  const [selId, setSelId] = useState<string | undefined>(undefined)
  const [picked, setPicked] = useState<string[]>([])
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const listRef = useRef<HTMLDivElement>(null)

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
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups])
  const curIdx = Math.max(0, flat.findIndex(x => x.id === selId))
  const cur: ClipItem | undefined = flat[curIdx]

  // `clipboard.paste` is the only protocol call that sets the clipboard: paste closes the island, copy leaves it open
  const send = useCallback((id: string) => { void bridge.call('clipboard.paste', { id }).catch(() => undefined) }, [])
  const paste = useCallback((id: string) => { send(id); useIsland.getState().closeIsland() }, [send])

  // latest values for the window key handler
  const live = useRef({ flat, curIdx, picked })
  live.current = { flat, curIdx, picked }

  const pin = useCallback((id: string, on: boolean) => {
    setItems(p => p.map(x => (x.id === id ? { ...x, pinned: on } : x)))
    void bridge.call('clipboard.pin', { id, on }).catch(() => undefined)
  }, [])
  const del = useCallback((id: string) => {
    const { flat, curIdx } = live.current
    if (flat[curIdx]?.id === id) setSelId((flat[curIdx + 1] ?? flat[curIdx - 1])?.id)
    setPicked(p => p.filter(x => x !== id))
    setItems(p => p.filter(x => x.id !== id))
    void bridge.call('clipboard.delete', { id }).catch(() => undefined)
  }, [])
  const select = useCallback((id: string, multi: boolean) => {
    setSelId(id)
    setPicked(p => (multi ? (p.includes(id) ? p.filter(x => x !== id) : [...p, id]) : []))
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

  // keys (the window only receives them while the island is pinned; Esc is handled by main)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey) return
      const { flat, curIdx, picked } = live.current
      const t = e.target instanceof HTMLInputElement ? e.target : null
      const sel = flat[curIdx]
      // paste/copy act on the first picked item (list order) when several are picked
      const target = flat.find(x => picked.includes(x.id)) ?? sel
      const k = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey) {
        if (k === 'c') {
          if (t && t.selectionStart !== t.selectionEnd) return // let the input copy its own text
          e.preventDefault()
          if (target) send(target.id)
        } else if (k === 'p') {
          e.preventDefault()
          if (sel) pin(sel.id, !sel.pinned)
        }
        return
      }
      if (k === 'arrowdown' || k === 'arrowup') {
        e.preventDefault()
        const n = flat[Math.min(flat.length - 1, Math.max(0, curIdx + (k === 'arrowdown' ? 1 : -1)))]
        if (n) { setSelId(n.id); setPicked([]) }
      } else if (k === 'enter') {
        if (target) paste(target.id)
      } else if (k === 'delete') {
        if (t?.value) return // editing the search text
        if (sel) del(sel.id)
      } else if (k === 'tab') {
        e.preventDefault()
        setKind(p => FILTERS[(FILTERS.findIndex(f => f.id === p) + (e.shiftKey ? 3 : 1)) % 4].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [send, paste, pin, del])

  useEffect(() => {
    if (cur) listRef.current?.querySelector(`[data-id="${cur.id}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cur?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // absolute rows: header top e+4 (h22, e += 26), row top e+1 (h36, e += 38)
  const layout = useMemo(() => {
    let e = 0
    const nodes: ReactNode[] = []
    for (const g of groups) {
      nodes.push(<div key={`h-${g.label}`} style={{ position: 'absolute', left: 10, top: e + 4, height: 22, lineHeight: '22px', fontSize: 11, fontWeight: 500, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>{g.label}</div>)
      e += 26
      for (const it of g.items) {
        nodes.push(<ClipRow key={it.id} item={it} top={e + 1} sel={it.id === cur?.id} picked={picked.includes(it.id)} onSelect={select} onPaste={paste} onPin={pin} onDelete={del} />)
        e += 38
      }
    }
    return { nodes, height: e }
  }, [groups, cur?.id, picked, select, paste, pin, del])

  const filter = FILTERS.find(f => f.id === kind)!
  return (
    <div style={{ position: 'relative', width: 844, height: 372 }}>
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder={`Search ${items.length} ${items.length === 1 ? 'item' : 'items'}…`}
        height={42}
        fontSize={14}
        iconLeft={15}
        iconTop={12}
        iconSize={18}
        textLeft={42}
        rightPad={300}
        right={
          <>
            <div style={{ position: 'absolute', right: 44, top: 7, display: 'flex', alignItems: 'center', gap: 4 }}>
              {FILTERS.map(f => <FilterChip key={f.label} on={f.id === kind} onClick={() => setKind(f.id)}>{f.label}</FilterChip>)}
            </div>
            <button
              title="Settings"
              aria-label="Settings"
              onClick={() => bridge.app.openSettings('general')}
              className="transition duration-100 ease-linear active:scale-[.96]"
              style={{ position: 'absolute', left: 814, top: 13, width: 16, height: 16, display: 'grid', placeItems: 'center', color: 'var(--soft)' }}
            >
              <Settings size={16} />
            </button>
          </>
        }
      />

      <div ref={listRef} className="scroll-y" style={{ position: 'absolute', left: 0, top: 52, width: 372, height: 280, overflowX: 'hidden' }}>
        {groups.length === 0 && (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center', alignContent: 'center', justifyItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 12, opacity: loaded ? 1 : 0 }}>
            <ClipboardList size={22} />
            {query.trim() ? `No matches for “${query.trim()}”` : filter.empty}
          </div>
        )}
        <div style={{ position: 'relative', height: layout.height }}>
          {layout.nodes}
        </div>
      </div>

      <Preview item={cur} />

      <div style={{ position: 'absolute', left: 0, top: 342, width: 844, height: 30, display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 4, whiteSpace: 'pre' }}>
        <span style={{ display: 'flex', alignItems: 'center' }}><Kbd>↵</Kbd><span style={hintLabel}>Paste</span></span>
        <span style={{ display: 'flex', alignItems: 'center' }}><Kbd>Ctrl C</Kbd><span style={hintLabel}>Copy</span></span>
        <span style={{ display: 'flex', alignItems: 'center' }}><Kbd>Ctrl P</Kbd><span style={hintLabel}>Pin</span></span>
        <span style={{ display: 'flex', alignItems: 'center' }}><Kbd>Del</Kbd><span style={hintLabel}>Remove</span></span>
        <button onClick={clear} className="transition duration-100 ease-linear active:scale-[.96]" style={{ ...hintLabel, color: confirm ? 'var(--bad)' : 'var(--soft)' }}>{confirm ? 'Clear all?' : 'Clear'}</button>
        <span style={{ ...hintLabel, color: 'var(--muted)', marginLeft: 'auto' }}>↑↓ Move  ·  Ctrl/Shift pick several  ·  Tab Filter</span>
      </div>
    </div>
  )
}
