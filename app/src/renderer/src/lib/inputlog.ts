import { bridge } from '@/bridge'
import { useIsland } from '@/island/store'
import { pointerState } from './region'

// Input diagnostics for the overlay: writes one line to main.log when a click looks lost, so a "clicking does nothing"
// report comes with evidence. Nothing is logged for normal clicks; at most 20 lines per session.
let lines = 0
const say = (m: string) => { if (lines++ < 20) bridge.app.log(`input: ${m}`) }

export function initInputLog() {
  let down: { t: number; x: number; y: number; target: string; shape: string; view: string } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const where = () => { const s = useIsland.getState(); return { shape: s.shape, view: s.view } }
  const onDown = (e: PointerEvent) => {
    const el = e.target as HTMLElement | null
    down = { t: performance.now(), x: Math.round(e.clientX), y: Math.round(e.clientY), target: `${el?.tagName ?? '?'}.${String(el?.className ?? '').slice(0, 30)}`, ...where() }
    clearTimeout(timer)
    timer = setTimeout(() => { if (down) say(`pointerdown at ${down.x},${down.y} on ${down.target} (${down.shape}/${down.view}) had no release after 1.5 s; deferred region changes so far: ${pointerState.deferred}`) }, 1500)
  }
  const onUp = () => { down = null; clearTimeout(timer) }
  const onCancel = (e: PointerEvent) => { say(`pointercancel (${e.pointerType}) at ${Math.round(e.clientX)},${Math.round(e.clientY)} ${JSON.stringify(where())}`); down = null; clearTimeout(timer) }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
  return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('pointerup', onUp, true); window.removeEventListener('pointercancel', onCancel, true) }
}
