import { memo } from 'react'
import { Image as ImageIcon, Link2, Pin, Trash2, Type } from 'lucide-react'
import type { ClipItem } from '@shared/protocol'
import { ago } from '@/lib/format'

const icons = { text: Type, image: ImageIcon, link: Link2 } as const

function Act({ title, on, onClick, children }: { title: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={e => { e.stopPropagation(); onClick() }}
      className={`grid place-items-center transition-opacity ${on ? '' : 'opacity-0 group-hover:opacity-100'}`}
      style={{ width: '1.5rem', height: '1.5rem', borderRadius: '0.5rem', background: 'var(--s3)', color: on ? 'var(--accent)' : 'var(--muted)' }}
    >
      {children}
    </button>
  )
}

export const ClipRow = memo(function ClipRow({ item, onPaste, onPin, onDelete }: { item: ClipItem; onPaste: (id: string) => void; onPin: (id: string, on: boolean) => void; onDelete: (id: string) => void }) {
  const Icon = icons[item.kind]
  return (
    <div className="row-hover group" onClick={() => onPaste(item.id)} style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start', padding: '0.5rem', cursor: 'pointer' }}>
      <div style={{ width: '1.5rem', height: '1.5rem', flex: 'none', borderRadius: '0.5rem', background: 'var(--s2)', color: item.kind === 'link' ? 'var(--accent)' : 'var(--muted)', display: 'grid', placeItems: 'center' }}>
        <Icon size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {item.kind === 'image' && item.image ? (
          <img src={item.image} alt="" draggable={false} style={{ display: 'block', maxHeight: '5rem', maxWidth: '100%', borderRadius: '0.5rem', border: '1px solid var(--line)' }} />
        ) : (
          <div style={{ fontSize: '0.8125rem', lineHeight: 1.35, whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', color: item.kind === 'link' ? 'var(--accent)' : 'var(--text)' }}>
            {item.preview || (item.kind === 'image' ? 'Image' : '(empty)')}
          </div>
        )}
        <div style={{ marginTop: '0.1875rem', fontSize: '0.6875rem', color: 'var(--dim)' }}>
          {item.source && <>{item.source} · </>}{ago(item.at)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.25rem', flex: 'none' }}>
        <Act title={item.pinned ? 'Unpin' : 'Pin'} on={item.pinned} onClick={() => onPin(item.id, !item.pinned)}><Pin size={12} fill={item.pinned ? 'currentColor' : 'none'} /></Act>
        <Act title="Delete" onClick={() => onDelete(item.id)}><Trash2 size={12} /></Act>
      </div>
    </div>
  )
})
