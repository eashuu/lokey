import { Droplet, Smile, AudioLines, Zap, type LucideIcon } from 'lucide-react'

export type SlotId = 'soul' | 'personality' | 'voice' | 'abilities'

/** The four loadout slots. `angle` is the base orbit angle in degrees (screen orientation, y up). */
export const SLOTS: { id: SlotId; title: string; color: string; icon: LucideIcon; angle: number }[] = [
  { id: 'soul', title: 'Soul', color: '#C3AAFF', icon: Droplet, angle: 140 },
  { id: 'personality', title: 'Personality', color: '#FF9F6E', icon: Smile, angle: 40 },
  { id: 'voice', title: 'Voice', color: '#00CFF7', icon: AudioLines, angle: -140 },
  { id: 'abilities', title: 'Abilities', color: '#6FD579', icon: Zap, angle: -40 },
]
