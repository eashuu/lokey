import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

/** 58px tile like ui `Tile`, plus a divider and a chevron zone at the right that triggers `onMore` (opens a settings page). */
export function SplitTile({ icon, title, sub, on, onClick, onMore, moreLabel }: { icon: ReactNode; title: string; sub?: string; on?: boolean; onClick: () => void; onMore: () => void; moreLabel: string }) {
  const ink = 'var(--accent-ink)'
  return (
    <div style={{ position: 'relative', height: 58, borderRadius: 16, background: on ? 'var(--accent)' : 'rgba(255,255,255,.078)', color: on ? ink : 'var(--text)', transition: 'background-color 180ms cubic-bezier(.33,1,.68,1)' }}>
      <button onClick={onClick} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, right: 37, borderRadius: '16px 0 0 16px', textAlign: 'left' }}>
        <span style={{ position: 'absolute', left: 12, top: 12, width: 34, height: 34, borderRadius: 17, display: 'grid', placeItems: 'center', background: on ? `color-mix(in srgb, ${ink} 14%, transparent)` : 'rgba(255,255,255,.07)' }}>{icon}</span>
        <span style={{ position: 'absolute', left: 56, right: 8, top: sub ? 11 : 20, height: 19, lineHeight: '19px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        {sub && <span style={{ position: 'absolute', left: 56, right: 8, top: 30, height: 16, lineHeight: '16px', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: on ? `color-mix(in srgb, ${ink} 62%, transparent)` : 'var(--muted)' }}>{sub}</span>}
      </button>
      <i style={{ position: 'absolute', right: 36, top: 12, width: 1, height: 34, background: on ? `color-mix(in srgb, ${ink} 18%, transparent)` : 'rgba(244,245,248,.18)' }} />
      <button aria-label={moreLabel} onClick={onMore} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 36, borderRadius: '0 16px 16px 0', display: 'grid', placeItems: 'center' }}>
        <ChevronDown size={14} strokeWidth={1.8} />
      </button>
    </div>
  )
}
