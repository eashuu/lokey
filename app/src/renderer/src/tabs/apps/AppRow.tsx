import { memo, type CSSProperties, type ReactNode } from 'react'
import { FileText, Star } from 'lucide-react'
import type { AppEntry } from '@shared/protocol'
import { AppIcon } from './AppIcon'

const kindLabel = { app: 'Application', game: 'Game', store: 'Store app' } as const

const ell: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

/** 42px row; the selected one gets an accent highlight inset 2px and the "↵ Open" hint. */
function Shell({ i, sel, onOpen, children }: { i: number; sel: boolean; onOpen: (i: number) => void; children: ReactNode }) {
  return (
    <div className="group" data-i={i} onClick={() => onOpen(i)} style={{ position: 'relative', height: 42, cursor: 'pointer' }}>
      <div
        className={sel ? undefined : 'group-hover:bg-[var(--fill-1)]'}
        style={{ position: 'absolute', inset: 2, borderRadius: 12, background: sel ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : undefined, transition: 'background-color 120ms' }}
      />
      {children}
      {sel && <span style={{ position: 'absolute', left: 430, top: 0, width: 100, height: 42, lineHeight: '42px', textAlign: 'right', fontSize: 11, color: 'var(--muted)' }}>↵ Open</span>}
    </div>
  )
}

const kindStyle = (label: string): ReactNode => (
  <span style={{ position: 'absolute', left: 544, top: 0, width: 92, height: 42, lineHeight: '42px', textAlign: 'right', fontSize: 11, color: 'var(--muted)' }}>{label}</span>
)

export const AppRow = memo(function AppRow({ e, i, sel, onOpen, onStar }: { e: AppEntry; i: number; sel: boolean; onOpen: (i: number) => void; onStar: (id: string, on: boolean) => void }) {
  return (
    <Shell i={i} sel={sel} onOpen={onOpen}>
      <AppIcon id={e.id} name={e.name} />
      <span style={{ position: 'absolute', left: 50, top: 0, width: 370, height: 42, lineHeight: '42px', fontSize: 14, color: sel ? '#F4F5F8' : '#D3D9E3', ...ell }}>{e.name}</span>
      {kindStyle(kindLabel[e.kind])}
      <button
        aria-label={e.starred ? 'Unstar' : 'Star'}
        title={e.starred ? 'Unstar' : 'Star'}
        onClick={ev => { ev.stopPropagation(); onStar(e.id, !e.starred) }}
        className={e.starred || sel ? undefined : 'opacity-0 group-hover:opacity-100'}
        style={{ position: 'absolute', left: 644, top: 9, width: 24, height: 24, display: 'grid', placeItems: 'center', color: e.starred ? 'var(--accent)' : 'var(--muted)' }}
      >
        <Star size={14} fill={e.starred ? 'currentColor' : 'none'} />
      </button>
    </Shell>
  )
})

export const FileRow = memo(function FileRow({ name, path, i, sel, onOpen }: { name: string; path: string; i: number; sel: boolean; onOpen: (i: number) => void }) {
  return (
    <Shell i={i} sel={sel} onOpen={onOpen}>
      <div style={{ position: 'absolute', left: 10, top: 7, width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.102)', display: 'grid', placeItems: 'center', color: 'var(--soft)' }}><FileText size={15} /></div>
      <span style={{ position: 'absolute', left: 50, top: 0, width: 240, height: 42, lineHeight: '42px', fontSize: 14, color: sel ? '#F4F5F8' : '#D3D9E3', ...ell }}>{name}</span>
      <span title={path} style={{ position: 'absolute', left: 300, top: 0, width: 130, height: 42, lineHeight: '42px', fontSize: 11, color: 'var(--muted)', direction: 'rtl', textAlign: 'left', ...ell }}>{path}</span>
      {kindStyle('File')}
    </Shell>
  )
})
