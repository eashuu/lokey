import { create } from 'zustand'
import type { TabId } from '@shared/bridge'

export type OpenMode = 'hover' | 'pinned'
export interface Peek { icon: string; label: string; value: number | null; text: string }

interface IslandState {
  open: boolean
  mode: OpenMode
  tab: TabId
  peek: Peek | null
  openIsland: (mode: OpenMode, tab?: TabId) => void
  closeIsland: () => void
  setTab: (tab: TabId) => void
  showPeek: (p: Peek) => void
}

let peekTimer: ReturnType<typeof setTimeout> | undefined

export const useIsland = create<IslandState>(set => ({
  open: false,
  mode: 'hover',
  tab: 'controls',
  peek: null,
  openIsland: (mode, tab) => set(s => ({ open: true, mode: s.open && s.mode === 'pinned' ? 'pinned' : mode, tab: tab ?? s.tab, peek: null })),
  closeIsland: () => set({ open: false }),
  setTab: tab => set({ tab }),
  showPeek: p => {
    set(s => (s.open ? s : { peek: p }))
    clearTimeout(peekTimer)
    peekTimer = setTimeout(() => set({ peek: null }), 1700)
  },
}))
