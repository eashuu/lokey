import { create } from 'zustand'
import type { TabId } from '@shared/bridge'
import type { Shape, View } from './shapes'

export type OpenMode = 'hover' | 'pinned'
export type SoulMode = 'MUTED' | 'LISTENING' | 'HEARING' | 'THINKING' | 'TALKING' | 'YAWNING' | 'WRITING' | 'LOOKING'
export type HeldPhase = 'listening' | 'thinking' | 'done'
export interface Caption { kind: 'said' | 'reply'; text: string }
export interface Peek { icon: string; label: string; value: number | null; text: string }

interface IslandState {
  shape: Shape
  view: View
  mode: OpenMode
  soul: SoulMode
  peek: Peek | null
  caption: Caption | null
  heldPhase: HeldPhase
  /** What the island returns to when the menu closes. */
  rest: 'sleep' | 'awake'
  setRest: (r: 'sleep' | 'awake') => void
  wake: (mode?: OpenMode) => void
  sleep: () => void
  openMenu: (view: View, mode?: OpenMode) => void
  closeMenu: () => void
  /** alias used by tabs after an action (launch, paste) */
  closeIsland: () => void
  setView: (v: View) => void
  setSoul: (m: SoulMode) => void
  hold: (phase?: HeldPhase) => void
  release: () => void
  setCaption: (c: Caption | null) => void
  showPeek: (p: Peek) => void
}

let peekTimer: ReturnType<typeof setTimeout> | undefined

export const useIsland = create<IslandState>((set, get) => ({
  shape: 'sleep',
  view: 'controls',
  mode: 'hover',
  soul: 'MUTED',
  peek: null,
  caption: null,
  heldPhase: 'listening',
  rest: 'sleep',
  setRest: rest => set(s => (s.shape === 'menu' || s.shape === 'held' ? { rest } : { rest, shape: rest, soul: rest === 'awake' ? 'LISTENING' : 'MUTED' })),
  wake: mode => set({ shape: 'awake', soul: 'LISTENING', mode: mode ?? get().mode, peek: null }),
  sleep: () => set({ shape: 'sleep', soul: 'MUTED' }),
  openMenu: (view, mode) => set(s => ({ shape: 'menu', view, mode: s.shape === 'menu' && s.mode === 'pinned' ? 'pinned' : (mode ?? s.mode), soul: 'LISTENING', peek: null })),
  closeMenu: () => set(s => ({ shape: s.rest, soul: s.rest === 'awake' ? 'LISTENING' : 'MUTED' })),
  closeIsland: () => get().closeMenu(),
  setView: view => set({ view }),
  setSoul: soul => set({ soul }),
  hold: phase => set({ shape: 'held', heldPhase: phase ?? 'listening', soul: phase === 'thinking' ? 'THINKING' : 'LISTENING', peek: null }),
  release: () => set(s => ({ shape: s.rest, soul: s.rest === 'awake' ? 'LISTENING' : 'MUTED' })),
  setCaption: caption => set({ caption }),
  showPeek: p => {
    set(s => (s.shape === 'menu' ? s : { peek: p }))
    clearTimeout(peekTimer)
    peekTimer = setTimeout(() => set({ peek: null }), 1700)
  },
}))

export const isMenu = () => useIsland.getState().shape === 'menu'
export type { TabId }
