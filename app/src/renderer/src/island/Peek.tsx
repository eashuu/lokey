import { Sun, Volume2, VolumeX } from 'lucide-react'
import type { Peek } from './store'

/** Volume / brightness readout shown inside the widened notch. */
export function PeekRow({ peek }: { peek: Peek }) {
  const Icon = peek.icon === 'mute' ? VolumeX : peek.icon === 'brightness' ? Sun : Volume2
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: '100%', padding: '0 18px', fontFamily: 'var(--font-island)' }}>
      <Icon size={16} color="var(--accent)" />
      <span style={{ fontSize: 12, color: 'var(--muted)', width: 44 }}>{peek.label}</span>
      <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'var(--fill-4)', overflow: 'hidden' }}>
        {peek.value !== null && <div style={{ width: `${Math.round(peek.value * 100)}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />}
      </div>
      <span className="num" style={{ fontSize: 12, width: 34, textAlign: 'right' }}>{peek.text}</span>
    </div>
  )
}
