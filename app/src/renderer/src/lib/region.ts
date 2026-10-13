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

function push(r: Rect) {
  sent = r
  bridge.setRegion([r, ...extras].map(q => ({ x: Math.floor(q.x), y: Math.floor(q.y), w: Math.ceil(q.w), h: Math.ceil(q.h) })))
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
