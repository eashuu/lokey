import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useIsland } from '@/island/store'
import { bridge } from '@/bridge'
import type { EventName, Events } from '@shared/protocol'

/** Subscribe to a bridge event for the lifetime of the view. */
export function useBridgeEvent<E extends EventName>(event: E, cb: (d: Events[E]) => void) {
  useEffect(() => bridge.on(event, cb), []) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Rotating glyph; it only exists (and so only animates) while an operation is running. */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <motion.span style={{ display: 'inline-grid', placeItems: 'center', width: size, height: size, flex: 'none' }} animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}>
      <Loader2 size={size} strokeWidth={2} />
    </motion.span>
  )
}

/** Hover-fill button base (`--fill-1` at rest, `--fill-4` on hover, 0.1s linear). */
export function Btn({ children, onClick, style, title, disabled, kind = 'soft' }: { children: ReactNode; onClick?: () => void; style?: CSSProperties; title?: string; disabled?: boolean; kind?: 'soft' | 'accent' | 'bad' }) {
  const [hover, setHover] = useState(false)
  const bg = kind === 'accent' ? 'var(--accent)' : kind === 'bad' ? 'color-mix(in srgb, var(--bad) 18%, transparent)' : hover ? 'var(--fill-4)' : 'var(--fill-1)'
  const color = kind === 'accent' ? 'var(--accent-ink)' : kind === 'bad' ? 'var(--bad)' : 'var(--text)'
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="active:scale-[0.97]"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, flex: 'none', fontSize: 12, fontWeight: 500, background: bg, color, opacity: disabled ? 0.5 : kind === 'accent' && hover ? 0.9 : 1, transition: 'background-color .1s linear, color .1s linear, opacity .1s linear, transform .1s linear', ...style }}
    >
      {children}
    </button>
  )
}

export function Msg({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 28px 40px', textAlign: 'center', fontSize: 13, color: 'var(--muted)', lineHeight: '18px' }}>
      <span>{children}</span>
      {action}
    </div>
  )
}

export function Section({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 28, margin: '6px 0 4px', padding: '0 4px', fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>
      <span>{children}</span>
      {right}
    </div>
  )
}

/** Header (56px: back, title, right slot) + scrolling body (14px side padding, 18px bottom). `bottom` reserves room for a pinned footer. */
export function Shell({ title, right, w, h, children, bottom = 0 }: { title: string; right?: ReactNode; w: number; h: number; children: ReactNode; bottom?: number }) {
  const [hover, setHover] = useState(false)
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }}>
      <button
        aria-label="Back"
        onClick={() => useIsland.getState().setView('controls')}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ position: 'absolute', left: 14, top: 14, width: 28, height: 28, borderRadius: 14, display: 'grid', placeItems: 'center', background: hover ? 'var(--fill-4)' : 'var(--fill-1)', transition: 'background-color .1s linear' }}
      >
        <ChevronLeft size={16} strokeWidth={1.8} />
      </button>
      <div style={{ position: 'absolute', left: 52, top: 14, height: 28, lineHeight: '28px', fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{title}</div>
      <div style={{ position: 'absolute', right: 14, top: 14, height: 28, display: 'flex', alignItems: 'center', gap: 8 }}>{right}</div>
      <div className="scroll-y" style={{ position: 'absolute', left: 0, right: 0, top: 56, bottom, padding: '0 14px 18px' }}>{children}</div>
    </div>
  )
}
