import { useEffect, useState } from 'react'
import { bridge } from '@/bridge'
import { Toggle } from '@/ui'

type St = Awaited<ReturnType<typeof bridge.link.state>>
const box = { background: 'var(--card, rgba(255,255,255,0.05))', borderRadius: 10, padding: '0.75rem 1rem', margin: '0.5rem 0', fontSize: '0.8125rem' } as const

// Settings > Devices: turn Lokey Link on, show a one-time pairing code and the LAN URL, list and revoke phones.
export function DevicesSection() {
  const [st, setSt] = useState<St | null>(null)
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null)
  const [now, setNow] = useState(Date.now())
  const load = () => { void bridge.link.state().then(setSt) }
  useEffect(() => { load(); const t = setInterval(() => { setNow(Date.now()); load() }, 2000); return () => clearInterval(t) }, [])
  if (!st) return null
  const left = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0
  return (
    <div style={{ maxWidth: '34rem', color: 'var(--text)' }}>
      <div style={{ ...box, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span><b>Lokey Link</b><br /><span style={{ color: 'var(--muted)' }}>Lets your phone approve actions, send text and search memory over your Wi-Fi. Off by default. No remote mouse/keyboard control.</span></span>
        <Toggle on={st.enabled} onChange={v => { void bridge.link.setEnabled(v).then(load) }} />
      </div>
      {st.enabled && (
        <div style={box}>
          <div>Open on the phone (same Wi-Fi): <b>{st.url ?? 'no private network found'}</b></div>
          <div style={{ marginTop: 8 }}>
            {code && left > 0
              ? <span>Code: <b style={{ fontSize: '1.4rem', letterSpacing: '0.2em' }}>{code.code}</b> <span style={{ color: 'var(--muted)' }}>({left}s, 5 tries)</span></span>
              : <button onClick={() => { void bridge.link.newCode().then(setCode) }} style={{ padding: '0.4rem 0.8rem' }}>Pair a phone</button>}
          </div>
        </div>
      )}
      <div style={{ color: 'var(--muted)', margin: '0.75rem 0 0.25rem', fontSize: '0.75rem' }}>Paired phones</div>
      {st.devices.length === 0 && <div style={{ color: 'var(--dim)', fontSize: '0.8125rem' }}>None yet.</div>}
      {st.devices.map(d => (
        <div key={d.id} style={{ ...box, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span><b>{d.name}</b><br /><span style={{ color: 'var(--muted)' }}>{d.scopes.join(', ')}; {d.lastSeen ? `last seen ${new Date(d.lastSeen).toLocaleString()}` : 'never connected'}</span></span>
          <button onClick={() => { void bridge.link.revoke(d.id).then(load) }} style={{ padding: '0.3rem 0.7rem' }}>Revoke</button>
        </div>
      ))}
    </div>
  )
}
