import type { SoulPalette } from './Soul'

/** Soul skins, keyed by the id stored in `settings.loadout.soul`. `form: 1` = round puffball, 0 = water drop. */
export const SOUL_SKINS: Record<string, { name: string; palette: SoulPalette }> = {
  puff: { name: 'Puff', palette: { top: '#FFE3EF', bottom: '#FFA6CD', glow: '#FF7FB8', ink: '#2A1740', foot: '#E5457A', form: 1 } },
  bloom: { name: 'Bloom', palette: { top: '#F6E7FF', bottom: '#D7A6FF', glow: '#B97CFF', ink: '#2A1550', foot: '#9A52E0', form: 1 } },
  sunny: { name: 'Sunny', palette: { top: '#FFF6C9', bottom: '#FFD45E', glow: '#FFB830', ink: '#3A2600', foot: '#F28A1E', form: 1 } },
  minty: { name: 'Minty', palette: { top: '#E6FFF3', bottom: '#8FE8BE', glow: '#4FD6A0', ink: '#06301C', foot: '#2FAE7C', form: 1 } },
  sky: { name: 'Sky', palette: { top: '#E8F6FF', bottom: '#9AD2FF', glow: '#5AB0FF', ink: '#0E2A55', foot: '#3A86E8', form: 1 } },
  droplet: { name: 'Droplet', palette: { top: '#F4FCFF', bottom: '#8CCBFF', glow: '#54A8FF', ink: '#0E2A55', foot: '#54A8FF', form: 0 } },
  ember: { name: 'Ember', palette: { top: '#FFE9D6', bottom: '#FF9A6A', glow: '#FF5A36', ink: '#3A1000', foot: '#E0502A', form: 0 } },
  wisp: { name: 'Wisp', palette: { top: '#EAFBF1', bottom: '#8FE0AE', glow: '#52C98A', ink: '#06301C', foot: '#3FB07A', form: 0 } },
  amethyst: { name: 'Amethyst', palette: { top: '#F3EAFF', bottom: '#B79BFF', glow: '#8A5CFF', ink: '#22084D', foot: '#7A4CE8', form: 0 } },
  gilded: { name: 'Gilded', palette: { top: '#FFF6D8', bottom: '#FFC85A', glow: '#FFB020', ink: '#3A2600', foot: '#E89A10', form: 0 } },
}

/** Palette for a stored skin id; unknown/old ids (the former default "drop") fall back to the new default. */
export const skinPalette = (id: string | undefined): SoulPalette => (SOUL_SKINS[id ?? ''] ?? SOUL_SKINS.puff).palette
