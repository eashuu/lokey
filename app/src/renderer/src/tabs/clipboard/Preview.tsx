import { useEffect, useState } from 'react'
import type { ClipItem } from '@shared/protocol'
import { bridge } from '@/bridge'
import { bytes, dayLabel } from '@/lib/format'

const KIND = { text: 'Text', image: 'Image', link: 'Link' } as const

function stats(it: ClipItem, full: string | null): string {
  if (it.kind === 'image') return bytes(it.size)
  const t = full ?? it.preview
  const chars = t.length
  const words = t.trim() ? t.trim().split(/\s+/).length : 0
  const lines = t ? t.split('\n').length : 0
  return `${chars} characters • ${words} ${words === 1 ? 'word' : 'words'} • ${lines} ${lines === 1 ? 'line' : 'lines'}`
}

function Meta({ top, k, v }: { top: number; k: string; v: string }) {
  return (
    <>
      <span style={{ position: 'absolute', left: 18, top, height: 20, lineHeight: '20px', fontSize: 12, color: 'var(--muted)' }}>{k}</span>
      <span style={{ position: 'absolute', left: 92, right: 18, top, height: 20, lineHeight: '20px', fontSize: 12, color: '#D3D9E3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</span>
    </>
  )
}

/** 460x280 preview card for the selected clip (design px). */
export function Preview({ item }: { item: ClipItem | undefined }) {
  // the list only carries a 400-character preview: fetch the whole item when it is selected
  const [full, setFull] = useState<{ id: string; text: string | null; image: string | null } | null>(null)
  const id = item?.id
  useEffect(() => {
    if (!id) return
    let live = true
    const t = setTimeout(() => { void bridge.call('clipboard.get', { id }).then(r => { if (live) setFull(r) }).catch(() => undefined) }, 60)
    return () => { live = false; clearTimeout(t) }
  }, [id])
  const mine = full && item && full.id === item.id ? full : null
  return (
    <div style={{ position: 'absolute', left: 384, top: 52, width: 460, height: 280, borderRadius: 18, background: 'var(--fill-1)', overflow: 'hidden' }}>
      {!item ? (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--muted)' }}>Nothing to preview</div>
      ) : (
        <>
          <div className="scroll-y" onWheel={e => e.stopPropagation()} style={{ position: 'absolute', left: 18, top: 16, width: 424, height: 174, overflowX: 'hidden', fontSize: 14, lineHeight: 1.5, color: '#E3E8F0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text' }}>
            {item.kind === 'image' && (mine?.image ?? item.image) ? (
              <img src={mine?.image ?? item.image ?? ''} alt="" draggable={false} style={{ display: 'block', maxWidth: '100%', borderRadius: 10, objectFit: 'contain' }} />
            ) : (
              mine?.text ?? (item.preview || (item.kind === 'image' ? 'Image' : '(empty)'))
            )}
          </div>
          <div style={{ position: 'absolute', left: 18, right: 18, top: 198, height: 1, background: 'rgba(255,255,255,.086)' }} />
          <Meta top={208} k="Type" v={KIND[item.kind]} />
          <Meta top={228} k="Size" v={stats(item, mine?.text ?? null)} />
          <Meta top={248} k="Copied" v={`${dayLabel(item.at)}, ${new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${item.source ? ` · ${item.source}` : ''}`} />
        </>
      )}
    </div>
  )
}
