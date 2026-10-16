// Slider logic shared by every slider in the app (ui.tsx Slider/PillSlider, MusicView seek, controls/Media seek, controls/Pill).
// Pure on purpose, so a self-check can run it without a window. The React hook that wires it to the DOM is renderer/lib/useSlider.ts.

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : Number.isFinite(n) ? n : 0)
/** pointer x -> 0..1 along a bar; a zero-width bar gives 0 instead of NaN */
export const sliderFrac = (clientX: number, left: number, width: number) => (width > 0 ? clamp01((clientX - left) / width) : 0)

/** keyboard operation, following the ARIA slider pattern: arrows step, Page keys jump, Home/End go to the ends. Returns the new value or null when the key is not ours. */
export function sliderKey(key: string, value: number, shift = false): number | null {
  const step = shift ? 0.01 : 0.05
  switch (key) {
    case 'ArrowLeft': case 'ArrowDown': return clamp01(value - step)
    case 'ArrowRight': case 'ArrowUp': return clamp01(value + step)
    case 'PageDown': return clamp01(value - 0.1)
    case 'PageUp': return clamp01(value + 0.1)
    case 'Home': return 0
    case 'End': return 1
    default: return null
  }
}

/** One drag. Ends exactly once however it ends (pointerup, pointercancel or lostpointercapture, which browsers may fire in either order). */
export class SliderDrag {
  active = false
  last = 0
  down(v: number) { this.active = true; this.last = v }
  move(v: number) { if (this.active) this.last = v }
  /** value to commit and whether the drag was cancelled; null when no drag is open (a second end event is ignored) */
  end(v?: number, cancelled = false): { value: number; cancelled: boolean } | null {
    if (!this.active) return null
    this.active = false
    if (v !== undefined && !cancelled) this.last = v
    return { value: this.last, cancelled }
  }
}

export function sliderSelfCheck(): string {
  const need = (c: unknown, m: string) => { if (!c) throw new Error('slider: ' + m) }
  need(sliderFrac(50, 0, 100) === 0.5 && sliderFrac(-20, 0, 100) === 0 && sliderFrac(500, 0, 100) === 1 && sliderFrac(5, 0, 0) === 0, 'frac clamps and survives zero width')
  need(sliderKey('ArrowRight', 0.5) === 0.55 || Math.abs(sliderKey('ArrowRight', 0.5)! - 0.55) < 1e-9, 'arrow right steps up')
  need(sliderKey('ArrowLeft', 0.02) === 0 && sliderKey('ArrowUp', 0.99) === 1, 'keys clamp')
  need(Math.abs(sliderKey('ArrowRight', 0.5, true)! - 0.51) < 1e-9, 'shift = fine step')
  need(sliderKey('Home', 0.4) === 0 && sliderKey('End', 0.4) === 1 && Math.abs(sliderKey('PageUp', 0.4)! - 0.5) < 1e-9, 'home end page')
  need(sliderKey('a', 0.4) === null && sliderKey('Tab', 0.4) === null, 'other keys are left alone (Tab must still move focus)')
  const d = new SliderDrag()
  need(d.end(0.3) === null, 'no drag, no commit')
  d.down(0.1); d.move(0.6)
  const up = d.end(0.7)
  need(up?.value === 0.7 && !up.cancelled, 'pointerup commits where it ended')
  need(d.end(0.2, true) === null, 'lostpointercapture after pointerup does not commit twice')
  d.down(0.2); d.move(0.45)
  const c = d.end(undefined, true)
  need(c?.value === 0.45 && c.cancelled, 'pointercancel ends at the last position and is flagged cancelled')
  need(d.end() === null, 'only once')
  d.down(0.5)
  const l = d.end(0, true) // lostpointercapture alone (window lost focus): the bogus clientX 0 is ignored
  need(l?.value === 0.5 && l.cancelled, 'lost capture keeps the last real value')
  return 'ok'
}
