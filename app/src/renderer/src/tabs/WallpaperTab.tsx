import { useEffect, useRef, useState } from 'react'
import { Folder } from 'lucide-react'
import type { WallpaperItem } from '@shared/protocol'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { Chip, IconButton } from '@/ui'
import { Carousel } from './wallpaper/Carousel'

type Source = 'recent' | 'folder'

// Protocol follow-up: the sidecar must expand "%PICTURES%" to the user's Pictures folder when no folder is configured.
const DEFAULT_FOLDER = '%PICTURES%'

export function WallpaperTab() {
  const folderSetting = useData(s => s.settings.wallpaper.folder)
  const current = useData(s => s.wallpaper)
  const [source, setSource] = useState<Source>('recent')
  const [items, setItems] = useState<WallpaperItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [index, setIndex] = useState(0)
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({})
  const asked = useRef(new Set<string>())

  useEffect(() => {
    let live = true
    setLoaded(false)
    const req = source === 'recent'
      ? bridge.call('wallpaper.recent', {})
      : bridge.call('wallpaper.folder', { folder: folderSetting || DEFAULT_FOLDER, limit: 40 })
    void req.then(r => {
      if (!live || !Array.isArray(r)) return
      setItems(r)
      setIndex(Math.max(0, r.findIndex(x => x.path === useData.getState().wallpaper)))
      setLoaded(true)
    }).catch(() => { if (live) setLoaded(true) })
    return () => { live = false }
  }, [source, folderSetting])

  // lazily fetch thumbnails for the cards that are on screen
  useEffect(() => {
    for (let i = Math.max(0, index - 2); i <= Math.min(items.length - 1, index + 2); i++) {
      const it = items[i]
      if (it.thumb || asked.current.has(it.path)) continue
      asked.current.add(it.path)
      void bridge.call('wallpaper.thumb', { path: it.path, size: 480 })
        .then(r => setThumbs(t => ({ ...t, [it.path]: r?.thumb ?? null })))
        .catch(() => undefined)
    }
  }, [items, index])

  const set = (path: string) => {
    void bridge.call('wallpaper.set', { path }).then(() => useData.setState({ wallpaper: path })).catch(() => undefined)
  }

  const sel = items[index]
  const isCurrent = !!sel && sel.path === current
  const folderName = (folderSetting ?? '').split(/[\\/]/).filter(Boolean).pop() ?? 'Pictures'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <Chip on={source === 'recent'} onClick={() => setSource('recent')}>Recent</Chip>
        <Chip on={source === 'folder'} onClick={() => setSource('folder')}>My folder</Chip>
        <span style={{ fontSize: '0.6875rem', color: 'var(--dim)', marginLeft: '0.25rem' }}>
          <span className="num">{items.length}</span> {items.length === 1 ? 'picture' : 'pictures'}
        </span>
        <span style={{ flex: 1 }} />
        <span title={folderSetting ?? 'Pictures'} style={{ fontSize: '0.6875rem', color: 'var(--dim)', maxWidth: '10rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folderName}</span>
        <IconButton title="Choose folder" size="1.75rem" onClick={async () => { const f = await bridge.app.pickFolder(); if (f) void bridge.settings.set({ wallpaper: { folder: f } }) }}><Folder size={14} /></IconButton>
      </div>

      {items.length === 0 ? (
        <div style={{ height: '9rem', display: 'grid', placeItems: 'center', fontSize: '0.75rem', color: 'var(--dim)', opacity: loaded ? 1 : 0 }}>No pictures found</div>
      ) : (
        <Carousel items={items} thumbs={thumbs} index={index} onIndex={setIndex} current={current} onSet={set} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', minHeight: '1.875rem' }}>
        {sel && (
          <>
            <span style={{ fontSize: '0.6875rem', color: 'var(--dim)', maxWidth: '12rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel.name}</span>
            <button
              onClick={() => set(sel.path)}
              disabled={isCurrent}
              style={{ padding: '0.375rem 0.875rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 600, background: isCurrent ? 'var(--s2)' : 'var(--accent)', color: isCurrent ? 'var(--muted)' : 'var(--accent-ink)', cursor: isCurrent ? 'default' : 'pointer', transition: 'background-color 140ms, color 140ms' }}
            >
              {isCurrent ? 'Current wallpaper' : 'Set as wallpaper'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
