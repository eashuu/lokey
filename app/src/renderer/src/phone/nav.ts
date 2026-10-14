import { create } from 'zustand'
import type { MainPage } from '@shared/bridge'

/** bottom navigation of the phone app; `section` opens a sub page of You (spirit, bond, voice, brain, wake, island, permissions, privacy, tips, about...) */
export type PhonePage = 'home' | 'inbox' | 'today' | 'pc' | 'you'

interface Nav { page: PhonePage; section?: string; go: (page: PhonePage, section?: string) => void }
export const usePage = create<Nav>(set => ({ page: 'home', section: undefined, go: (page, section) => set({ page, section }) }))

/** the desktop main-window pages and settings sections mapped onto the phone's pages (the desktop code calls openMain / openSettings) */
export const fromMain = (p: MainPage | undefined, section?: string): { page: PhonePage; section?: string } =>
  p === 'soul' ? { page: 'you', section: 'spirit' } : p === 'bond' ? { page: 'you', section: 'bond' } : p === 'desk' ? { page: 'today' } : p === 'settings' ? { page: 'you', section: section ?? 'voice' } : { page: 'home' }
