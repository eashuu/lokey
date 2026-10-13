import { memo, type ReactNode } from 'react'
import { AlignLeft, Image as ImageIcon, Link2, Pin, Trash2 } from 'lucide-react'
import type { ClipItem } from '@shared/protocol'
import { bytes } from '@/lib/format'

const icons = { text: AlignLeft, image: ImageIcon, link: Link2 } as const

/** "now", "4m", "1h", "2d" */
function short(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function clipTitle(it: ClipItem): string {
  if (it.kind === 'image') return `Image • ${bytes(it.size)}`
  return it.preview.split('\n').find(l => l.trim())?.trim() || '(empty)'
}

function Act({ title, on, onClick, children }: { title: string; on?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={e => { e.stopPropagation(); onClick() }}
      className="transition duration-100 ease-linear active:scale-[.96]"
      style={{ width: 22, height: 22, borderRadius: 7, display: 'grid', placeItems: 'center', background: 'var(--fill-2)', color: on ? 'var(--accent)' : 'var(--soft)' }}
    >
      {children}
    </button>
  )
}

export const ClipRow = memo(function ClipRow({ item, top, sel, picked, onSelect, onPaste, onPin, onDelete }: {
  item: ClipItem
  top: number
  sel: boolean
  picked: boolean
  onSelect: (id: string, multi: boolean) => void
  onPaste: (id: string) => void
  onPin: (id: string, on: boolean) => void
  onDelete: (id: string) => void
}) {
  const Icon = item.pinned ? Pin : icons[item.kind]
  return (
    <div
      data-id={item.id}
      className="group hover:bg-[var(--fill-2)] transition-colors duration-100 ease-linear"
      onClick={e => onSelect(item.id, e.ctrlKey || e.metaKey || e.shiftKey)}
      onDoubleClick={() => onPaste(item.id)}
      style={{ position: 'absolute', left: 0, top, width: 366, height: 36, borderRadius: 10, cursor: 'pointer', background: sel ? 'color-mix(in srgb, var(--accent) 20%, transparent)' : picked ? 'color-mix(in srgb, var(--accent) 11%, transparent)' : undefined }}
    >
      <span style={{ position: 'absolute', left: 8, top: 5, width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center', background: sel ? 'color-mix(in srgb, var(--accent) 28%, transparent)' : 'rgb(var(--ov) / .07)', color: sel ? 'var(--accent)' : 'var(--muted)' }}>
        <Icon size={16} />
      </span>
      <span style={{ position: 'absolute', left: 44, right: 52, top: 0, height: 36, lineHeight: '36px', fontSize: 13, fontWeight: sel ? 500 : 400, color: sel ? 'var(--text)' : 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {clipTitle(item)}
      </span>
      <span className="group-hover:opacity-0" style={{ position: 'absolute', right: 8, top: 0, height: 36, lineHeight: '36px', fontSize: 11, color: 'var(--muted)' }}>{short(item.at)}</span>
      <span className="opacity-0 group-hover:opacity-100" style={{ position: 'absolute', right: 6, top: 7, display: 'flex', gap: 4 }}>
        <Act title={item.pinned ? 'Unpin' : 'Pin'} on={item.pinned} onClick={() => onPin(item.id, !item.pinned)}><Pin size={12} fill={item.pinned ? 'currentColor' : 'none'} /></Act>
        <Act title="Delete" onClick={() => onDelete(item.id)}><Trash2 size={12} /></Act>
      </span>
    </div>
  )
})
