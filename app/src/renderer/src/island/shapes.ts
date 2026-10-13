import type { TabId } from '@shared/bridge'
import type { ShapeParams } from './shapePath'

export type Shape = 'sleep' | 'awake' | 'held' | 'menu'
export type Flyout = 'wifi' | 'bluetooth' | 'audio'
export type View = 'music' | TabId | Flyout

/** Menu content size in design pixels (the content is laid out at this size, then scaled by `menuK`). */
export const MENU_SIZE: Record<View, { w: number; h: number }> = {
  music: { w: 380, h: 150 },
  controls: { w: 640, h: 390 },
  today: { w: 880, h: 442 },
  stats: { w: 880, h: 338 },
  clipboard: { w: 880, h: 446 },
  apps: { w: 720, h: 638 },
  wallpaper: { w: 1040, h: 314 },
  power: { w: 640, h: 166 },
  wifi: { w: 400, h: 440 },
  bluetooth: { w: 400, h: 440 },
  audio: { w: 400, h: 330 },
}

// Notch shapes in design pixels (before the user's size multiplier).
const NOTCH: Record<'sleep' | 'awake' | 'held', ShapeParams> = {
  sleep: { depth: 16, width: 210, corner: 17, rampW: 9, rampH: 11 },
  awake: { depth: 75, width: 210, corner: 17, rampW: 18, rampH: 22 },
  held: { depth: 36, width: 168, corner: 16, rampW: 10.8, rampH: 13.2 },
}
const MENU = { corner: 25.5, rampW: 30.6, rampH: 28.9 }

/** The menu is drawn at 0.9 of its design size, like the reference; notches at 0.8 so they feel small on a real desktop. */
export const MENU_BASE = 0.9
export const NOTCH_BASE = 0.8

export function paramsFor(shape: Shape, view: View, k: number): ShapeParams {
  if (shape === 'menu') {
    const m = MENU_SIZE[view]
    const s = MENU_BASE * k
    return { depth: m.h * s, width: m.w * s, corner: MENU.corner * s, rampW: MENU.rampW * s, rampH: MENU.rampH * s }
  }
  const n = NOTCH[shape]
  const s = NOTCH_BASE * k
  return { depth: n.depth * s, width: n.width * s, corner: n.corner * s, rampW: n.rampW * s, rampH: n.rampH * s }
}

export type MorphKind = 'open' | 'close' | 'menu' | 'music' | 'notch'

/** Which transition table applies when going from one state to another (UI-SPEC section 1). */
export function morphKind(from: { shape: Shape; view: View }, to: { shape: Shape; view: View }): MorphKind {
  const a = from.shape === 'menu', b = to.shape === 'menu'
  if (!a && b) return 'open'
  if (a && !b) return 'close'
  if (a && b) return from.view === 'music' || to.view === 'music' ? 'music' : 'menu'
  return 'notch'
}

export const MORPH: Record<MorphKind, { duration: number; ease: [number, number, number, number] }> = {
  open: { duration: 0.42, ease: [0.215, 0.61, 0.355, 1] },
  close: { duration: 0.42, ease: [0.65, 0, 0.35, 1] },
  menu: { duration: 0.22, ease: [0.215, 0.61, 0.355, 1] },
  music: { duration: 0.38, ease: [0.215, 0.61, 0.355, 1] },
  notch: { duration: 0.55, ease: [0.215, 0.61, 0.355, 1] },
}

/** Tab bar widths from the reference, design px. */
export const TAB_WIDTH: Record<TabId, number> = { controls: 83, today: 64, stats: 60, clipboard: 90, apps: 58, wallpaper: 94, power: 67 }

/** Brief widening used for volume/brightness peeks. */
export function peekParams(k: number): ShapeParams {
  const s = NOTCH_BASE * k
  return { depth: 46 * s, width: 330 * s, corner: 18 * s, rampW: 14 * s, rampH: 17 * s }
}
