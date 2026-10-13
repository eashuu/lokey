import { bridge } from '@/bridge'

// The overlay is click-through except over the island. Elements that must catch the pointer call these
// from pointerenter/leave; clip-path on the island body means only its *visible* shape counts as "over".
let interactive = false
let depth = 0

export function enter() {
  depth++
  if (!interactive) { interactive = true; bridge.setInteractive(true) }
}

export function leave() {
  depth = Math.max(0, depth - 1)
  if (depth === 0 && interactive) { interactive = false; bridge.setInteractive(false) }
}

/** Force click-through (window blur, fullscreen). */
export function reset() {
  depth = 0
  if (interactive) { interactive = false; bridge.setInteractive(false) }
}

export const hitProps = { onPointerEnter: enter, onPointerLeave: leave } as const
