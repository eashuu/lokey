import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { SliderDrag, sliderFrac, sliderKey } from '@shared/slider'

/**
 * One slider behaviour for every bar in the app: pointer drag with capture (ends once on up, cancel or lost capture), arrow/Page/Home/End keys,
 * tabIndex and ARIA values. Spread `props` on the bar element and add your own aria-label and style.
 * onCommit(value, cancelled): cancelled = the drag was interrupted (touch cancel, focus loss); most sliders still keep the value, a seek bar may ignore it.
 */
export function useSlider({ value, onChange, onCommit, disabled }: { value: number; onChange: (v: number) => void; onCommit?: (v: number, cancelled: boolean) => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef(new SliderDrag())
  const at = (e: PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return sliderFrac(e.clientX, r.left, r.width) }
  const finish = (v?: number, cancelled = false) => { const r = drag.current.end(v, cancelled); if (r) onCommit?.(r.value, r.cancelled) }
  const props = {
    ref,
    role: 'slider' as const,
    tabIndex: disabled ? -1 : 0,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round(value * 100),
    'aria-disabled': disabled || undefined,
    onPointerDown: (e: PointerEvent) => {
      if (disabled) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const v = at(e); drag.current.down(v); onChange(v)
    },
    onPointerMove: (e: PointerEvent) => { if (drag.current.active && e.currentTarget.hasPointerCapture(e.pointerId)) { const v = at(e); drag.current.move(v); onChange(v) } },
    onPointerUp: (e: PointerEvent) => { const v = at(e); try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ } finish(v) },
    onPointerCancel: () => finish(undefined, true),
    onLostPointerCapture: () => finish(undefined, true), // after a normal pointerup the drag is already closed, so this is a no-op then
    onKeyDown: (e: KeyboardEvent) => {
      if (disabled || e.ctrlKey || e.altKey || e.metaKey) return
      const v = sliderKey(e.key, value, e.shiftKey)
      if (v === null) return
      e.preventDefault()
      onChange(v); onCommit?.(v, false)
    },
  }
  return props
}
