import { animate, type MotionValue } from 'motion/react'

// Animation tokens. `speed` comes from settings (0 = animations off, 1 = normal).
let speed = 1
export const setAnimSpeed = (s: number) => { speed = s }
export const animSpeed = () => speed

export type SpringKind = 'spatial' | 'fast' | 'soft'

// Springs tuned to feel like Caelestia's spatial curves (slight overshoot, settles ~450 ms).
const springs: Record<SpringKind, { stiffness: number; damping: number; mass: number }> = {
  spatial: { stiffness: 230, damping: 22, mass: 1 },
  fast: { stiffness: 380, damping: 26, mass: 1 },
  soft: { stiffness: 140, damping: 20, mass: 1 },
}

/** Drive a MotionValue to `target` with a spring; instantly when animations are off. */
export function spring(mv: MotionValue<number>, target: number, kind: SpringKind = 'spatial') {
  if (speed <= 0) { mv.set(target); return }
  const s = springs[kind]
  return animate(mv, target, { type: 'spring', stiffness: s.stiffness * speed * speed, damping: s.damping * speed, mass: s.mass, restDelta: 0.1, restSpeed: 0.2 })
}

/** Duration in seconds for tween-style effects (opacity crossfades). */
export const dur = (seconds: number) => (speed <= 0 ? 0 : seconds / speed)

export const ease = { standard: [0.2, 0, 0, 1] as const, effects: [0.34, 0.8, 0.34, 1] as const }
