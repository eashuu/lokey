import { useEffect, useState } from 'react'
import { bridge } from '@/bridge'

const box = { background: 'var(--card, rgba(255,255,255,0.05))', borderRadius: 10, padding: '0.75rem 1rem', margin: '0.5rem 0', fontSize: '0.8125rem' } as const

// Settings > Permissions: actions Lokey no longer asks about (earned trust), each with a Revoke.
export function PermissionsSection() {
  const [rules, setRules] = useState<string[]>([])
  const load = () => { void bridge.voice.trustRules().then(setRules) }
  useEffect(load, [])
  return (
    <div>
      <div style={{ ...box, color: 'var(--muted)', lineHeight: 1.5 }}>After you approve the same action five times and never refuse it, I offer to stop asking. Shell commands, deleting, sending messages, power and anything driven from the screen, the web or a phone always ask.</div>
      {rules.length === 0 ? <div style={box}>No standing permissions yet.</div> : rules.map(r => {
        const [tool, target] = r.split('|')
        return (
          <div key={r} style={{ ...box, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.replace(/_/g, ' ')}{target ? `: ${target}` : ''}</span>
            <button onClick={() => void bridge.voice.trustRevoke(r).then(load)} style={{ height: 26, padding: '0 12px', borderRadius: 13 }}>Revoke</button>
          </div>
        )
      })}
    </div>
  )
}
