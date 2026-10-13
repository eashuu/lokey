import { useEffect, useRef, useState } from 'react'
import { Folder } from 'lucide-react'
import type { WallpaperItem } from '@shared/protocol'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { Carousel } from './wallpaper/Carousel'

type Source = 'recent' | 'folder'

// Protocol follow-up: the sidecar must expand "%PICTURES%" to the user's Pictures folder when no folder is configured.
const DEFAULT_FOLDER = '%PICTURES%'

function Pill({ left, on, onClick, children }: { left: number; on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={`transition duration-100 ease-linear active:scale-[.96] ${on ? '' : 'hover:bg-[var(--fill-3)]'}`}
      style={{ position: 'absolute', left, top: 3, height: 28, padding: '0 14px', borderRadius: 14, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', background: on ? 'var(--accent)' : 'rgba(255,255,255,.055)', color: on ? 'var(--accent-ink)' : 'var(--soft)' }}
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

  // lazily fetch thumbnails for the cards that are on screen (circular, like the carousel)
  useEffect(() => {
    const n = items.length
    for (let d = -3; d <= 3; d++) {
      const it = items[n >= 3 ? (((index + d) % n) + n) % n : index + d]
      if (!it || it.thumb || asked.current.has(it.path)) continue
      asked.current.add(it.path)
      void bridge.call('wallpaper.thumb', { path: it.path, size: 480 })
        .then(r => setThumbs(t => ({ ...t, [it.path]: r?.thumb ?? null })))
        .catch(() => undefined)
    }
  }, [items, index])

  const set = (path: string, x: number, y: number) => {
    setApplying(path)
    void bridge.effects.revealWallpaper(path, x, y)
      .then(() => useData.setState({ wallpaper: path }))
      .catch(() => undefined)
      .finally(() => setApplying(a => (a === path ? null : a)))
  }

  return (
    <div style={{ position: 'relative', width: 1004, height: 240 }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1004, height: 34 }}>
        <Pill left={0} on={source === 'recent'} onClick={() => setSource('recent')}>Recent</Pill>
        <Pill left={78} on={source === 'folder'} onClick={() => setSource('folder')}>My folder</Pill>
        <span style={{ position: 'absolute', left: 172, top: 0, height: 34, lineHeight: '34px', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {items.length} {items.length === 1 ? 'picture' : 'pictures'}
        </span>
        <button
          title={folderSetting ? `Choose folder (${folderSetting})` : 'Choose folder'}
          aria-label="Choose folder"
          onClick={async () => { const f = await bridge.app.pickFolder(); if (f) void bridge.settings.set({ wallpaper: { folder: f } }) }}
          className="transition duration-100 ease-linear hover:bg-[var(--fill-3)] active:scale-[.96]"
          style={{ position: 'absolute', left: 974, top: 2, width: 30, height: 30, borderRadius: 15, display: 'grid', placeItems: 'center', background: 'var(--fill-1)', color: 'var(--soft)' }}
        >
          <Folder size={15} />
        </button>
      </div>

      {items.length === 0 ? (
        <div style={{ position: 'absolute', left: 0, top: 44, width: 1004, height: 196, display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--muted)', opacity: loaded ? 1 : 0 }}>No pictures found</div>
      ) : (
        <Carousel key={source} items={items} thumbs={thumbs} index={index} onIndex={setIndex} current={applying ?? current} onSet={set} />
      )}
    </div>
  )
}
