import { memo, type ReactNode } from 'react'
import { FileText, Star } from 'lucide-react'
import type { AppEntry } from '@shared/protocol'
import { cn } from '@/lib/format'
import { AppIcon } from './AppIcon'

const kindLabel = { app: 'Application', game: 'Game', store: 'Store app' } as const

function Shell({ i, sel, onOpen, children }: { i: number; sel: boolean; onOpen: (i: number) => void; children: ReactNode }) {
  return (
    <div className={cn('row-hover group')} data-i={i} data-sel={sel} onClick={() => onOpen(i)} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.25rem 0.5rem', height: '2.5rem', cursor: 'pointer' }}>
      {children}
    </div>
  )
}

const Hint = ({ show }: { show: boolean }) => (
  <span className="num" style={{ fontSize: '0.625rem', color: 'var(--muted)', opacity: show ? 1 : 0, width: '3rem', textAlign: 'right', flex: 'none' }}>↵ Open</span>
)

export const AppRow = memo(function AppRow({ e, i, sel, onOpen, onStar }: { e: AppEntry; i: number; sel: boolean; onOpen: (i: number) => void; onStar: (id: string, on: boolean) => void }) {
  return (
    <Shell i={i} sel={sel} onOpen={onOpen}>
      <AppIcon id={e.id} name={e.name} />
      <span style={{ flex: 1, minWidth: 0, fontSize: '0.8125rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
      <span style={{ fontSize: '0.6875rem', color: 'var(--dim)', flex: 'none' }}>{kindLabel[e.kind]}</span>
      <button
        aria-label={e.starred ? 'Unstar' : 'Star'}
        title={e.starred ? 'Unstar' : 'Star'}
        onClick={ev => { ev.stopPropagation(); onStar(e.id, !e.starred) }}
        className={cn('grid place-items-center transition-opacity', !e.starred && 'opacity-0 group-hover:opacity-100')}
        style={{ width: '1.5rem', height: '1.5rem', flex: 'none', color: e.starred ? 'var(--accent)' : 'var(--muted)' }}
      >
        <Star size={14} fill={e.starred ? 'currentColor' : 'none'} />
      </button>
      <Hint show={sel} />
    </Shell>
  )
})

export const FileRow = memo(function FileRow({ name, path, i, sel, onOpen }: { name: string; path: string; i: number; sel: boolean; onOpen: (i: number) => void }) {
  return (
    <Shell i={i} sel={sel} onOpen={onOpen}>
      <div style={{ width: '2rem', height: '2rem', flex: 'none', borderRadius: '0.5rem', background: 'var(--s2)', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}><FileText size={16} /></div>
      <span style={{ flex: 'none', maxWidth: '12rem', fontSize: '0.8125rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span title={path} style={{ flex: 1, minWidth: 0, fontSize: '0.6875rem', color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left' }}>{path}</span>
      <Hint show={sel} />
    </Shell>
  )
})
