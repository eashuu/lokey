import { useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { useData } from '@/lib/data'
import { haptic } from '@/lib/platform'
import { SOUL_SKINS, skinPalette } from '@/island/skins'
import type { SoulMode } from '@/island/store'
import { Picker } from '@/mainwin/Picker'
import { PoseBar } from '@/mainwin/PoseBar'
import { SLOTS, type SlotId } from '@/mainwin/slots'
import { Spirit, useSpirit } from './spirit'

/** You > Spirit: the big live spirit (poke it, long-press it), its four slots as a grid, and the pose / state strip. Picker: skins, personalities, voices, abilities. */
export function Loadout() {
  const lo = useData(s => s.settings.loadout)
  const [picker, setPicker] = useState<SlotId | null>(null)
  const [mode, setMode] = useState<SoulMode>('LISTENING')
  const setOverride = useSpirit(s => s.setOverride)
  useEffect(() => { setOverride(mode === 'LISTENING' ? null : mode) }, [mode, setOverride])
  useEffect(() => () => setOverride(null), [setOverride])
  const pers = lo.personalities.find(p => p.id === lo.personality)
  const values: Record<SlotId, string> = { soul: SOUL_SKINS[lo.soul]?.name ?? lo.soul, personality: pers?.name ?? '—', voice: lo.voice, abilities: lo.abilities.length ? `${lo.abilities.length} on` : '—' }
  const palette = skinPalette(lo.soul)
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ margin: '0 auto', width: 230, height: 230, borderRadius: '50%', display: 'grid', placeItems: 'center', boxSizing: 'border-box', border: '2px solid rgb(var(--ov) / .1)', background: `radial-gradient(circle, ${palette.glow}38 0%, ${palette.glow}14 55%, transparent 100%), var(--s1)` }}>
        <Spirit size={200} poke emotes />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {SLOTS.map(s => (
          <button key={s.id} onClick={() => { haptic(); setPicker(s.id) }} aria-label={`${s.title}: ${values[s.id]}`} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 68, padding: '0 14px', borderRadius: 24, textAlign: 'left', background: 'var(--fill-1)' }}>
            <s.icon size={20} color={s.color} style={{ flex: 'none' }} />
            <span style={{ minWidth: 0 }}><span style={{ display: 'block', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{values[s.id]}</span><span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{s.title}</span></span>
          </button>
        ))}
      </div>
      <PoseBar mode={mode} onMode={setMode} />
      <AnimatePresence>{picker && <Picker key="picker" slot={picker} onClose={() => setPicker(null)} />}</AnimatePresence>
    </div>
  )
}
