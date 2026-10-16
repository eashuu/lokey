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
  /** a voice turn is running: the voice bridge owns `soul` and the notch must not fall asleep under it */
  voiceBusy: boolean
  setVoiceBusy: (b: boolean) => void
  /** What the island returns to when the menu closes. */
  rest: 'sleep' | 'awake'
  setRest: (r: 'sleep' | 'awake') => void
  wake: (mode?: OpenMode) => void
  sleep: () => void
  openMenu: (view: View, mode?: OpenMode) => void
  closeMenu: () => void
  /** alias used by tabs after an action (launch, paste) */
  closeIsland: () => void
  /** a request for the person is on screen (island/ask.ts); nothing else may change the shape until it is answered */
  showAsk: () => void
  endAsk: () => void
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
  voiceBusy: false,
  setVoiceBusy: voiceBusy => set({ voiceBusy }),
  rest: 'sleep',
  setRest: rest => set(s => (s.shape === 'menu' || s.shape === 'held' || s.shape === 'ask' ? { rest } : { rest, shape: rest, soul: rest === 'awake' ? 'LISTENING' : 'MUTED' })),
  wake: mode => set(s => (s.shape === 'ask' ? s : { shape: 'awake', soul: 'LISTENING', mode: mode ?? s.mode, peek: null })),
  sleep: () => set(s => (s.voiceBusy || s.shape === 'ask' ? s : { shape: 'sleep', soul: 'MUTED' })),
  openMenu: (view, mode) => set(s => s.shape === 'ask' ? s : ({ shape: 'menu', view, mode: s.shape === 'menu' && s.mode === 'pinned' ? 'pinned' : (mode ?? s.mode), soul: s.voiceBusy ? s.soul : 'LISTENING', peek: null })),
  closeMenu: () => set(s => s.shape === 'ask' ? s : ({ shape: s.rest, soul: s.voiceBusy ? s.soul : s.rest === 'awake' ? 'LISTENING' : 'MUTED' })),
  closeIsland: () => get().closeMenu(),
  setView: view => set({ view }),
  setSoul: soul => set({ soul }),
  hold: phase => set(s => (s.shape === 'ask' ? s : { shape: 'held', heldPhase: phase ?? 'listening', soul: phase === 'thinking' ? 'THINKING' : 'LISTENING', peek: null })),
  showAsk: () => set({ shape: 'ask', soul: 'LISTENING', peek: null, mode: 'hover' }),
  endAsk: () => set(s => (s.shape === 'ask' ? { shape: s.rest, soul: s.voiceBusy ? s.soul : s.rest === 'awake' ? 'LISTENING' : 'MUTED' } : s)),
  release: () => set(s => s.shape === 'ask' ? s : ({ shape: s.rest, soul: s.voiceBusy ? s.soul : s.rest === 'awake' ? 'LISTENING' : 'MUTED' })),
  setCaption: caption => set({ caption }),
  showPeek: p => {
    set(s => (s.shape === 'menu' || s.shape === 'ask' ? s : { peek: p }))
    clearTimeout(peekTimer)
    peekTimer = setTimeout(() => set({ peek: null }), 1700)
  },
}))

export const isMenu = () => useIsland.getState().shape === 'menu'
export type { TabId }
