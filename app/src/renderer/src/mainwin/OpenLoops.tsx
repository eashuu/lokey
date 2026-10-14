import { useEffect, useState } from 'react'
import { bridge } from '@/bridge'

type Loop = { id: string; what: string; who?: string; due?: string }
const btn = { height: 24, padding: '0 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: 'var(--fill-3)', color: 'var(--text)' } as const

/** things you said you would do; hides itself when there are none */
export function OpenLoops() {
  const [rows, setRows] = useState<Loop[]>([])
  const load = () => { void bridge.voice.loops().then(setRows) }
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])
  if (!rows.length) return null
  const act = (id: string, a: 'done' | 'drop' | 'snooze') => void bridge.voice.loopSet(id, a).then(load)
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', margin: '0 0 8px' }}>Open loops · {rows.length}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map(r => (
          <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <span style={{ flex: 1, minWidth: 0 }}>{r.what}{r.who ? ` (${r.who})` : ''}{r.due ? <span style={{ color: 'var(--muted)' }}> · {new Date(r.due).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span> : null}</span>
            <button style={btn} onClick={() => act(r.id, 'done')}>Done</button>
            <button style={btn} onClick={() => act(r.id, 'snooze')}>Snooze</button>
            <button style={btn} onClick={() => act(r.id, 'drop')}>Drop</button>
          </div>
        ))}
      </div>
    </div>
  )
}
