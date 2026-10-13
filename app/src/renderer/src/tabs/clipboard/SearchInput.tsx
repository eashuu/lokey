import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { useIsland } from '@/island/store'

/**
 * Search box for a window that is only keyboard-focusable while the island is pinned: touching it pins the island
 * (main then focuses the window) and we focus the input once that has happened.
 */
export function SearchInput({ value, onChange, placeholder, hint, onKeyDown }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  hint?: ReactNode
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const focusSoon = () => {
    queueMicrotask(() => ref.current?.focus())
    // the window only becomes focusable after main reacts to `pinned`, so retry once
    timers.current.push(setTimeout(() => ref.current?.focus(), 50), setTimeout(() => ref.current?.focus(), 250))
  }
  const pin = () => {
    if (useIsland.getState().mode !== 'pinned') useIsland.setState({ mode: 'pinned' })
    focusSoon()
  }
  useEffect(() => {
    if (useIsland.getState().mode === 'pinned') focusSoon()
    const t = timers.current
    return () => t.forEach(clearTimeout)
  }, [])
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <input
        ref={ref}
        className="field"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={e => onChange(e.target.value)}
        onPointerDown={pin}
        onFocus={() => { if (useIsland.getState().mode !== 'pinned') pin() }}
        onKeyDown={onKeyDown}
        style={hint && !value ? { paddingRight: '4rem' } : undefined}
      />
      {hint && !value && <span style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>{hint}</span>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="num" style={{ fontSize: '0.625rem', padding: '0.125rem 0.375rem', borderRadius: '0.375rem', background: 'var(--s3)', color: 'var(--muted)', border: '1px solid var(--line)' }}>{children}</kbd>
}
