import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

const ink = 'var(--accent-ink)'

/** 58px tile (UI-LAYOUT.md): icon disc, title, sub; with `onMore` also a divider + chevron zone at the right. */
export function SplitTile({ icon, title, sub, on, disabled, onClick, onMore, moreLabel, left, width }: { icon: ReactNode; title: string; sub?: string; on?: boolean; disabled?: boolean; onClick?: () => void; onMore?: () => void; moreLabel?: string; left: number; width: number }) {
  const right = onMore ? 2 : 18 // relative to the main button (which stops 40px short of the tile edge): 42 / 18 from the tile edge
  return (
    <div style={{ position: 'absolute', left, top: 0, width, height: 58, borderRadius: 16, background: on ? 'var(--accent)' : 'rgba(255,255,255,.078)', color: on ? ink : 'var(--text)', opacity: disabled ? 0.45 : 1, transition: 'background-color .18s cubic-bezier(.33,1,.68,1), color .18s cubic-bezier(.33,1,.68,1)' }}>
      <button onClick={onClick} disabled={disabled} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, right: onMore ? 40 : 0, borderRadius: onMore ? '16px 0 0 16px' : 16, textAlign: 'left' }}>
        <span style={{ position: 'absolute', left: 12, top: 12, width: 34, height: 34, borderRadius: 17, display: 'grid', placeItems: 'center', background: on ? `color-mix(in srgb, ${ink} 14%, transparent)` : 'rgba(255,255,255,.07)' }}>{icon}</span>
        <span style={{ position: 'absolute', left: 56, right, top: sub ? 11 : 20, height: 19, lineHeight: '19px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        {sub && <span style={{ position: 'absolute', left: 56, right, top: 30, height: 16, lineHeight: '16px', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: on ? `color-mix(in srgb, ${ink} 62%, transparent)` : 'var(--muted)', transition: 'color .18s cubic-bezier(.33,1,.68,1)' }}>{sub}</span>}
      </button>
      {onMore && (
        <>
          <i style={{ position: 'absolute', right: 36, top: 12, width: 1, height: 34, background: on ? `color-mix(in srgb, ${ink} 18%, transparent)` : 'rgba(244,245,248,.18)' }} />
          <button aria-label={moreLabel} onClick={onMore} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 40, borderRadius: '0 16px 16px 0' }}>
            <ChevronDown size={12} strokeWidth={1.8} style={{ position: 'absolute', right: 18, top: 23 }} />
          </button>
        </>
      )}
    </div>
  )
}
