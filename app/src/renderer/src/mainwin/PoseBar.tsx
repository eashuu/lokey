import { mascot } from '@/mascot/bus'
import { GALLERY } from '@/mascot/poses'
import type { SoulMode } from '@/island/store'

export const STATE_CHIPS: { mode: SoulMode; label: string }[] = [
  { mode: 'LISTENING', label: 'Idle' }, { mode: 'MUTED', label: 'Asleep' }, { mode: 'HEARING', label: 'Listening' }, { mode: 'THINKING', label: 'Thinking' },
  { mode: 'TALKING', label: 'Talking' }, { mode: 'WRITING', label: 'Writing' }, { mode: 'LOOKING', label: 'Looking' },
]

const chip = (on: boolean): React.CSSProperties => ({
  flex: 'none', height: 26, padding: '0 11px', borderRadius: 13, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
  background: on ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--fill-2)', color: on ? 'var(--accent)' : 'var(--soft)',
})

/** Preview strip for the spirit: its looping states, and one-shot actions that play once and settle back. */
export function PoseBar({ mode, onMode }: { mode: SoulMode; onMode: (m: SoulMode) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div className="scroll-x" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {STATE_CHIPS.map(c => <button key={c.mode} onClick={() => onMode(c.mode)} style={chip(c.mode === mode)}>{c.label}</button>)}
      </div>
      <div className="scroll-x" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
        {GALLERY.map(g => <button key={g.name} onClick={() => mascot.play(g.name, { prio: 3 })} style={chip(false)}>{g.label}</button>)}
      </div>
    </div>
  )
}
