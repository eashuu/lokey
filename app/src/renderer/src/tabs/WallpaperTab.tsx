import { useEffect, useRef, useState } from 'react'
import { Folder } from 'lucide-react'
import type { WallpaperItem } from '@shared/protocol'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { Carousel } from './wallpaper/Carousel'

type Source = 'recent' | 'folder'

// Protocol follow-up: the sidecar must expand "%PICTURES%" to the user's Pictures folder when no folder is configured.
const DEFAULT_FOLDER = '%PICTURES%'

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      style={{ height: 28, padding: '0 14px', borderRadius: 14, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', background: on ? 'var(--accent)' : 'rgba(255,255,255,.055)', color: on ? 'var(--accent-ink)' : 'var(--soft)', transition: 'background-color 140ms, color 140ms' }}
    >
      {children}
    </button>
  )
}

export function WallpaperTab() {
  const folderSetting = useData(s => s.settings.wallpaper.folder)
  const current = useData(s => s.wallpaper)
  const [source, setSource] = useState<Source>('recent')
  const [items, setItems] = useState<WallpaperItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [index, setIndex] = useState(0)
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({})
  const [applying, setApplying] = useState<string | null>(null)
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
    setApplying(path)
    void bridge.call('wallpaper.set', { path })
      .then(() => useData.setState({ wallpaper: path }))
      .catch(() => undefined)
      .finally(() => setApplying(a => (a === path ? null : a)))
  }

  return (
    <div style={{ position: 'relative', width: 1004, height: 244 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1004, height: 34 }}>
        <div style={{ position: 'absolute', left: 0, top: 3, display: 'flex', gap: 6 }}>
          <Pill on={source === 'recent'} onClick={() => setSource('recent')}>Recent</Pill>
          <Pill on={source === 'folder'} onClick={() => setSource('folder')}>My folder</Pill>
        </div>
        <span style={{ position: 'absolute', left: 172, top: 0, height: 34, lineHeight: '34px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {items.length} {items.length === 1 ? 'picture' : 'pictures'}
        </span>
        <button
          title={folderSetting ? `Choose folder (${folderSetting})` : 'Choose folder'}
          aria-label="Choose folder"
          onClick={async () => { const f = await bridge.app.pickFolder(); if (f) void bridge.settings.set({ wallpaper: { folder: f } }) }}
          className="hover:bg-[var(--fill-2)]"
          style={{ position: 'absolute', right: 0, top: 2, width: 30, height: 30, borderRadius: 15, display: 'grid', placeItems: 'center', background: 'var(--fill-1)', color: 'var(--soft)' }}
        >
          <Folder size={14} />
        </button>
      </div>

      {items.length === 0 ? (
        <div style={{ position: 'absolute', left: 0, top: 44, width: 1004, height: 196, display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--muted)', opacity: loaded ? 1 : 0 }}>No pictures found</div>
      ) : (
        <Carousel items={items} thumbs={thumbs} index={index} onIndex={setIndex} current={applying ?? current} onSet={set} />
      )}
    </div>
  )
}
