import type { CSSProperties, ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { haptic } from '@/lib/platform'

export function PageHead({ title, line, right }: { title: string; line?: string; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, padding: '4px 4px 14px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 650, letterSpacing: '-.01em' }}>{title}</h1>
        {line && <div style={{ marginTop: 3, fontSize: 13, color: 'var(--muted)', lineHeight: 1.4 }}>{line}</div>}
      </div>
      {right}
    </div>
  )
}

export function Card({ children, style, title, right }: { children: ReactNode; style?: CSSProperties; title?: string; right?: ReactNode }) {
  return (
    <section style={{ background: 'var(--fill-1)', borderRadius: 28, padding: 16, display: 'grid', gap: 12, ...style }}>
      {title && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 }}><span style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.02em' }}>{title}</span>{right}</div>}
      {children}
    </section>
  )
}

/** a tappable list row (You page, sub page lists) */
export function ListRow({ icon, title, sub, onClick, right }: { icon?: ReactNode; title: string; sub?: string; onClick?: () => void; right?: ReactNode }) {
  return (
    <button onClick={() => { haptic(); onClick?.() }} style={{ display: 'flex', alignItems: 'center', gap: 14, minHeight: 60, padding: '0 14px 0 16px', width: '100%', textAlign: 'left' }}>
      {icon && <span style={{ width: 36, height: 36, borderRadius: 18, flex: 'none', display: 'grid', placeItems: 'center', background: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' }}>{icon}</span>}
      <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{title}</b>{sub && <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>}</span>
      {right ?? <ChevronRight size={18} color="var(--muted)" />}
    </button>
  )
}

export function SubHead({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 56, margin: '0 -8px' }}>
      <button aria-label="Back" onClick={() => { haptic(); onBack() }} style={{ width: 48, height: 48, display: 'grid', placeItems: 'center' }}><ChevronLeft size={24} /></button>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 650 }}>{title}</h1>
    </div>
  )
}
