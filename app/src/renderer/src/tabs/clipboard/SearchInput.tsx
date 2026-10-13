import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { useIsland } from '@/island/store'

/**
 * Search bar (design px) for a window that is only keyboard-focusable while the island is pinned: touching it pins the
 * island (main then focuses the window) and we focus the input once that has happened.
 * `right` is absolutely placed at the bar's right edge and `rightPad` reserves its width for the input.
 */
export function SearchInput({ value, onChange, placeholder, height, fontSize, iconLeft, iconTop, iconSize = 16, textLeft, right, rightPad = 12, onKeyDown }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  height: number
  fontSize: number
  iconLeft: number
  iconTop?: number
  iconSize?: number
  textLeft: number
  right?: ReactNode
  rightPad?: number
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const focusSoon = () => {
    queueMicrotask(() => ref.current?.focus())
    // the window only becomes focusable after main reacts to `pinned`, so retry twice
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
    <div style={{ position: 'relative', height, borderRadius: 14, background: 'var(--fill-1)' }}>
      <Search size={iconSize} color="var(--muted)" style={{ position: 'absolute', left: iconLeft, top: iconTop ?? (height - iconSize) / 2, pointerEvents: 'none' }} />
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={e => onChange(e.target.value)}
        onPointerDown={pin}
        onFocus={() => { if (useIsland.getState().mode !== 'pinned') pin() }}
        onKeyDown={onKeyDown}
        className="placeholder:text-[var(--muted)]"
        style={{ position: 'absolute', left: textLeft, right: rightPad, top: 0, height, width: `calc(100% - ${textLeft + rightPad}px)`, background: 'none', border: 0, outline: 'none', padding: 0, font: 'inherit', fontSize, color: 'var(--text)', userSelect: 'text' }}
      />
      {right}
    </div>
  )
}
