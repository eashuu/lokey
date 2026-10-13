// Shared UI primitives for the island tabs. Keep tabs built from these so the look stays consistent.
// Rules: only animate transform/opacity (and short colour transitions); no looping animations; no blur/box-shadow animation.
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/format'

export function Card({ children, className, style, onClick }: { children: ReactNode; className?: string; style?: CSSProperties; onClick?: () => void }) {
  return <div className={cn('card', className)} style={{ padding: '0.75rem', ...style }} onClick={onClick}>{children}</div>
}

export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="label" style={style}>{children}</div>
}

/** Circular gauge. `value` 0..100. Colour defaults to the accent. */
export function Ring({ value, size = 64, stroke = 5, color = 'var(--accent)', children, track = 'var(--s3)' }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode; track?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const arc = c * 0.78 // 280-degree gauge with the gap at the bottom
  const off = arc * (1 - Math.min(100, Math.max(0, value)) / 100)
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(129deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${arc} ${c}`} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${arc} ${c}`} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.34,0.8,0.34,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{children}</div>
    </div>
  )
}

export function Bar({ value, color = 'var(--accent)', height = 4 }: { value: number; color?: string; height?: number }) {
  return (
    <div style={{ height, borderRadius: 999, background: 'var(--s3)', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, value))}%`, background: color, borderRadius: 999, transition: 'width 600ms cubic-bezier(0.34,0.8,0.34,1)' }} />
    </div>
  )
}

export function Sparkline({ values, width = 120, height = 32, color = 'var(--accent)' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <svg width={width} height={height} />
  const max = Math.max(...values, 1)
  const step = width / (values.length - 1)
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`)
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} style={{ width: '2.25rem', height: '1.25rem', borderRadius: 999, background: on ? 'var(--accent)' : 'var(--s3)', position: 'relative', transition: 'background-color 160ms', flex: 'none' }}>
      <span style={{ position: 'absolute', top: 2, left: 2, width: '1rem', height: '1rem', borderRadius: 999, background: on ? 'var(--accent-ink)' : 'var(--muted)', transform: `translateX(${on ? '1rem' : '0'})`, transition: 'transform 200ms cubic-bezier(0.34,1.4,0.5,1)' }} />
    </button>
  )
}

/** Horizontal slider, 0..1. Pointer-capture drag; calls onChange continuously and onCommit on release. */
export function Slider({ value, onChange, onCommit, label }: { value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const set = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }
  return (
    <div
      ref={ref}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); onChange(set(e)) }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(set(e)) }}
      onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); onCommit?.(set(e)) }}
      style={{ position: 'relative', height: '1.25rem', display: 'flex', alignItems: 'center', cursor: 'pointer', touchAction: 'none' }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, height: '0.3125rem', borderRadius: 999, background: 'var(--s3)' }} />
      <div style={{ position: 'absolute', left: 0, height: '0.3125rem', borderRadius: 999, background: 'var(--accent)', width: `${value * 100}%` }} />
      <div style={{ position: 'absolute', left: `calc(${value * 100}% - 0.5rem)`, width: '1rem', height: '1rem', borderRadius: 999, background: 'var(--text)' }} />
    </div>
  )
}

export function IconButton({ children, onClick, active, title, size = '2rem', style }: { children: ReactNode; onClick?: () => void; active?: boolean; title?: string; size?: string; style?: CSSProperties }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="icon-btn"
      style={{ width: size, height: size, borderRadius: 999, display: 'grid', placeItems: 'center', background: active ? 'var(--accent)' : 'var(--s2)', color: active ? 'var(--accent-ink)' : 'var(--text)', transition: 'background-color 140ms, transform 120ms', ...style }}
    >
      {children}
    </button>
  )
}

export function Chip({ children, on, onClick }: { children: ReactNode; on?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{ padding: '0.25rem 0.625rem', borderRadius: 999, fontSize: '0.6875rem', fontWeight: 600, background: on ? 'var(--accent)' : 'var(--s2)', color: on ? 'var(--accent-ink)' : 'var(--muted)', transition: 'background-color 140ms, color 140ms' }}>
      {children}
    </button>
  )
}

// ---- v2 primitives (design px; sized for the 0.9-scaled island menu, see docs/UI-SPEC.md) ------------------

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd style={{ display: 'inline-grid', placeItems: 'center', height: 20, lineHeight: 1, padding: '0 7px', marginRight: 6, borderRadius: 6, background: 'rgba(255,255,255,.094)', font: '500 11px var(--font-island)', color: 'var(--soft)' }}>
      {children}
    </kbd>
  )
}

/** 58px tile: icon circle + title + subtitle; `on` fills it with the accent. */
export function Tile({ icon, title, sub, on, disabled, onClick, style }: { icon: ReactNode; title: string; sub?: string; on?: boolean; disabled?: boolean; onClick?: () => void; style?: CSSProperties }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ position: 'relative', height: 58, borderRadius: 16, textAlign: 'left', background: on ? 'var(--accent)' : 'rgba(255,255,255,.078)', color: on ? 'var(--accent-ink)' : 'var(--text)', transition: 'background-color 180ms cubic-bezier(.33,1,.68,1)', opacity: disabled ? 0.45 : 1, ...style }}
    >
      <span style={{ position: 'absolute', left: 12, top: 12, width: 34, height: 34, borderRadius: 17, display: 'grid', placeItems: 'center', background: on ? 'color-mix(in srgb, var(--accent-ink) 14%, transparent)' : 'rgba(255,255,255,.07)' }}>{icon}</span>
      <span style={{ position: 'absolute', left: 56, right: 12, top: sub ? 11 : 20, height: 19, lineHeight: '19px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
      {sub && <span style={{ position: 'absolute', left: 56, right: 12, top: 30, height: 16, lineHeight: '16px', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: on ? 'color-mix(in srgb, var(--accent-ink) 62%, transparent)' : 'var(--muted)' }}>{sub}</span>}
    </button>
  )
}

/** 38px pill slider with the accent fill and value text at the right (volume, brightness). */
export function PillSlider({ value, onChange, onCommit, label, icon, text }: { value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; label?: string; icon?: ReactNode; text?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }
  return (
    <div
      ref={ref}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); onChange(at(e)) }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(at(e)) }}
      onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); onCommit?.(at(e)) }}
      style={{ position: 'relative', height: 38, borderRadius: 19, background: 'rgba(255,255,255,.063)', overflow: 'hidden', touchAction: 'none', cursor: 'pointer' }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${value * 100}%`, borderRadius: 19, background: 'var(--accent)' }} />
      {icon && <span style={{ position: 'absolute', left: 14, top: 0, height: 38, display: 'grid', placeItems: 'center', color: 'var(--accent-ink)', mixBlendMode: 'normal' }}>{icon}</span>}
      <span style={{ position: 'absolute', right: 16, top: 0, height: 38, lineHeight: '38px', fontSize: 12, fontWeight: 500 }}>{text ?? `${Math.round(value * 100)}`}</span>
    </div>
  )
}
