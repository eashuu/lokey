import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'

/** 604x38 pill slider (volume, brightness): accent fill, icon at left, value at right. `onIcon` makes the icon a button. */
export function Pill({ value, onChange, onCommit, label, icon, onIcon, iconLabel, text, dim, width = 604, height = 38 }: {
  value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; label: string
  icon: ReactNode; onIcon?: () => void; iconLabel?: string; text: string; dim?: boolean; width?: number; height?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const at = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }
  const W = width
  const ink = (x: number): CSSProperties => ({ color: value * W > x ? 'var(--accent-ink)' : 'var(--text)' })
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
      onPointerCancel={e => onCommit?.(at(e))} // a cancelled drag (touch, pen, focus loss) still ends where it was
      style={{ position: 'relative', width: W, height, borderRadius: height / 2, background: 'var(--fill-1)', overflow: 'hidden', touchAction: 'none', cursor: 'pointer' }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.max(50, value * W), borderRadius: height / 2, background: 'var(--accent)', opacity: dim ? 0.5 : 1, transition: 'opacity .14s linear' }} />
      <button
        aria-label={iconLabel}
        disabled={!onIcon}
        onPointerDown={e => e.stopPropagation()}
        onClick={onIcon}
        className="hover:brightness-[1.15] active:scale-[0.94]"
        style={{ position: 'absolute', left: 8, top: (height - 30) / 2, width: 32, height: 30, borderRadius: 15, cursor: onIcon ? 'pointer' : 'default', color: 'var(--accent-ink)', transition: 'filter .1s linear, transform .1s linear' }}
      >
        <span style={{ position: 'absolute', left: 8, top: 7, width: 16, height: 16, display: 'grid', placeItems: 'center' }}>{icon}</span>
      </button>
      <span style={{ position: 'absolute', right: 16, top: 0, height, lineHeight: `${height}px`, fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', ...ink(W - 52) }}>{text}</span>
    </div>
  )
}
