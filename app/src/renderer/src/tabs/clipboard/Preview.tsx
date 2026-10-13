import type { ClipItem } from '@shared/protocol'
import { bytes, dayLabel } from '@/lib/format'

const KIND = { text: 'Text', image: 'Image', link: 'Link' } as const

function stats(it: ClipItem): string {
  if (it.kind === 'image') return bytes(it.size)
  const chars = it.preview.length < 400 ? it.preview.length : it.size
  const words = it.preview.trim() ? it.preview.trim().split(/\s+/).length : 0
  const lines = it.preview ? it.preview.split('\n').length : 0
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
  return (
    <div style={{ position: 'absolute', left: 384, top: 52, width: 460, height: 280, borderRadius: 18, background: 'var(--fill-1)', overflow: 'hidden' }}>
      {!item ? (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 13, color: 'var(--muted)' }}>Nothing to preview</div>
      ) : (
        <>
          <div style={{ position: 'absolute', left: 18, top: 16, width: 424, height: 174, overflow: 'hidden', fontSize: 14, lineHeight: 1.5, color: '#E3E8F0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {item.kind === 'image' && item.image ? (
              <img src={item.image} alt="" draggable={false} style={{ display: 'block', maxWidth: '100%', maxHeight: 174, borderRadius: 10, objectFit: 'contain' }} />
            ) : (
              item.preview || (item.kind === 'image' ? 'Image' : '(empty)')
            )}
          </div>
          <div style={{ position: 'absolute', left: 18, right: 18, top: 198, height: 1, background: 'rgba(255,255,255,.086)' }} />
          <Meta top={208} k="Type" v={KIND[item.kind]} />
          <Meta top={228} k="Size" v={stats(item)} />
          <Meta top={248} k="Copied" v={`${dayLabel(item.at)}, ${new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${item.source ? ` · ${item.source}` : ''}`} />
        </>
      )}
    </div>
  )
}
