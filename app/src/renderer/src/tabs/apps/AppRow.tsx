import { memo, type CSSProperties, type ReactNode } from 'react'
import { FileText, Star } from 'lucide-react'
import type { AppEntry } from '@shared/protocol'
import { AppIcon } from './AppIcon'

const kindLabel = { app: 'Application', game: 'Game', store: 'Store app' } as const

const ell: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

/** 42px row at `top`; the selected one gets a highlight (inset 2px top/bottom, r12) and the "↵ Open" tail. */
function Shell({ i, top, sel, onOpen, tail, children }: { i: number; top: number; sel: boolean; onOpen: (i: number) => void; tail: string; children: ReactNode }) {
  return (
    <div className="group" data-i={i} onClick={() => onOpen(i)} style={{ position: 'absolute', left: 0, top, width: 684, height: 42, cursor: 'pointer' }}>
      <div
        className={sel ? undefined : 'group-hover:bg-[var(--fill-2)]'}
        style={{ position: 'absolute', left: 0, right: 0, top: 2, bottom: 2, borderRadius: 12, background: sel ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : undefined, transition: 'background-color .1s linear' }}
      />
      {children}
      <span style={{ position: 'absolute', left: 544, top: 0, width: 92, height: 42, lineHeight: '42px', textAlign: 'right', fontSize: 11, color: 'var(--muted)' }}>{sel ? '↵ Open' : tail}</span>
    </div>
  )
}

export const AppRow = memo(function AppRow({ e, i, top, sel, onOpen, onStar }: { e: AppEntry; i: number; top: number; sel: boolean; onOpen: (i: number) => void; onStar: (id: string, on: boolean) => void }) {
  return (
    <Shell i={i} top={top} sel={sel} onOpen={onOpen} tail={kindLabel[e.kind]}>
      <AppIcon id={e.id} name={e.name} />
      <span style={{ position: 'absolute', left: 50, top: 0, width: 480, height: 42, lineHeight: '42px', fontSize: 14, color: sel ? '#F4F5F8' : '#D3D9E3', ...ell }}>{e.name}</span>
      <button
        aria-label={e.starred ? 'Unstar' : 'Star'}
        title={e.starred ? 'Unstar' : 'Star'}
        onClick={ev => { ev.stopPropagation(); onStar(e.id, !e.starred) }}
        className={`transition duration-100 ease-linear active:scale-[.96] ${e.starred || sel ? '' : 'opacity-0 group-hover:opacity-100'}`}
        style={{ position: 'absolute', left: 644, top: 7, width: 28, height: 28, display: 'grid', placeItems: 'center', color: e.starred ? 'var(--accent)' : 'var(--muted)' }}
      >
        <Star size={15} fill={e.starred ? 'currentColor' : 'none'} />
      </button>
    </Shell>
  )
})

export const FileRow = memo(function FileRow({ name, path, i, top, sel, onOpen }: { name: string; path: string; i: number; top: number; sel: boolean; onOpen: (i: number) => void }) {
  return (
    <Shell i={i} top={top} sel={sel} onOpen={onOpen} tail="File">
      <div style={{ position: 'absolute', left: 10, top: 7, width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,.102)', display: 'grid', placeItems: 'center', color: 'var(--soft)' }}><FileText size={15} /></div>
      <span style={{ position: 'absolute', left: 50, top: 0, width: 240, height: 42, lineHeight: '42px', fontSize: 14, color: sel ? '#F4F5F8' : '#D3D9E3', ...ell }}>{name}</span>
      <span title={path} style={{ position: 'absolute', left: 300, top: 0, width: 230, height: 42, lineHeight: '42px', fontSize: 11, color: 'var(--muted)', direction: 'rtl', textAlign: 'left', ...ell }}>{path}</span>
    </Shell>
  )
})
