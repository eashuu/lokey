import type { SoulPalette } from './Soul'

/** Soul skins, keyed by the id stored in `settings.loadout.soul`. */
export const SOUL_SKINS: Record<string, { name: string; palette: SoulPalette }> = {
  drop: { name: 'Drop', palette: { top: '#F4FCFF', bottom: '#8CCBFF', glow: '#54A8FF', ink: '#0E2A55' } },
  ember: { name: 'Ember', palette: { top: '#FFE9D6', bottom: '#FF9A6A', glow: '#FF5A36', ink: '#3A1000' } },
  wisp: { name: 'Wisp', palette: { top: '#EAFBF1', bottom: '#8FE0AE', glow: '#52C98A', ink: '#06301C' } },
  amethyst: { name: 'Amethyst', palette: { top: '#F3EAFF', bottom: '#B79BFF', glow: '#8A5CFF', ink: '#22084D' } },
  gilded: { name: 'Gilded', palette: { top: '#FFF6D8', bottom: '#FFC85A', glow: '#FFB020', ink: '#3A2600' } },
}
