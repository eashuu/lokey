import { bridge } from '@/bridge'

// The overlay window is shaped to the island (BrowserWindow.setShape), so everything outside the island belongs to
// the apps underneath: there is no click-through toggling and no mouse hook. Growing is immediate; shrinking waits
// until the morph has finished so nothing that is still visible gets clipped.
export interface Rect { x: number; y: number; w: number; h: number }

let sent: Rect | null = null
let target: Rect | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let extras: Rect[] = []

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
const same = (a: Rect | null, b: Rect | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

// Changing the window region (SetWindowRgn) while a mouse button is held can make Windows drop the button release, so
// the click never happens. Region changes made during a press are held back until the release (400 ms at most).
let pressed = false
let want: Rect | null = null
let flushTimer: ReturnType<typeof setTimeout> | undefined
export const pointerState = { deferred: 0 }

function send(r: Rect) {
  sent = r
  bridge.setRegion([r, ...extras].map(q => ({ x: Math.floor(q.x), y: Math.floor(q.y), w: Math.ceil(q.w), h: Math.ceil(q.h) })))
}
function flush() {
  clearTimeout(flushTimer)
  if (want && !same(sent, want)) send(want)
  want = null
}
function push(r: Rect) {
  want = r
  if (!pressed) { flush(); return }
  pointerState.deferred++
  clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, 400)
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { pressed = true }, true)
  const up = () => { pressed = false; if (want) flush() }
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  window.addEventListener('blur', up)
  // a release that never arrived must not leave us in "pressed" for good
  window.addEventListener('pointermove', e => { if (pressed && e.buttons === 0) up() }, true)
}

/** `shrinkAfterMs`: how long the current morph still runs. Extra rects (captions) are always included. */
export function setRegion(next: Rect, shrinkAfterMs: number, more: Rect[] = []) {
  extras = more
  target = next
  clearTimeout(timer)
  const grown = sent ? union(sent, next) : next
  if (!same(sent, grown)) push(grown)
  if (!same(grown, next)) {
    timer = setTimeout(() => { if (target) push(target) }, Math.max(0, shrinkAfterMs) + 80)
  }
}
