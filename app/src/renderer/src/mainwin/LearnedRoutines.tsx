import { useEffect, useState } from 'react'
import { bridge } from '@/bridge'

type Routine = { id: string; name: string; steps: { app: string; label: string }[]; runs: number; approved: boolean }
const btn = { height: 24, padding: '0 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: 'var(--fill-3)', color: 'var(--text)' } as const
const field = { height: 24, padding: '0 8px', borderRadius: 8, fontSize: 12, background: 'var(--fill-2)', color: 'var(--text)', minWidth: 0 } as const

/** Routines Lokey learned by watching which apps you open: record, review, rename, edit steps, run, delete. */
export function LearnedRoutines() {
  const [rows, setRows] = useState<Routine[]>([])
  const [w, setW] = useState<{ active: boolean; name?: string; steps: number }>({ active: false, steps: 0 })
  const [name, setName] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const load = () => { void bridge.voice.routines().then(setRows); void bridge.voice.watchStatus().then(setW) }
  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t) }, [])
  const save = (r: Routine, patch: { name?: string; steps?: { app: string; label?: string }[] }) => void bridge.voice.routineSave(r.id, patch).then(load)
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', margin: '0 0 8px' }}>Learned routines{rows.length ? ` · ${rows.length}` : ''}</div>
      {w.active ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 8 }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)' }} />
          <span style={{ flex: 1 }}>Watching which apps you open for “{w.name}” · {w.steps} so far</span>
          <button style={btn} onClick={() => void bridge.voice.watchStop().then(load)}>Stop and save</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name a routine, then show me" style={{ ...field, flex: 1 }} maxLength={40} spellCheck={false} />
          <button style={{ ...btn, opacity: name.trim() ? 1 : 0.45 }} disabled={!name.trim()} onClick={() => { void bridge.voice.watchStart(name.trim()).then(() => { setName(''); load() }) }}>Watch me</button>
        </div>
      )}
      {!w.active && <div style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 8px', lineHeight: 1.45 }}>I only note which apps you bring to the front, in order. I never record typing, the screen or window titles, and I skip password and banking windows.</div>}
      <div style={{ display: 'grid', gap: 6 }}>
        {rows.map(r => (
          <div key={r.id} style={{ fontSize: 13 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 13 }} aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{r.name}<span style={{ color: 'var(--muted)' }}> · {r.steps.length} step{r.steps.length === 1 ? '' : 's'}{r.approved ? '' : ' · asks on first run'}</span></button>
              <button style={btn} onClick={() => bridge.voice.say(`run my routine ${r.name}`)}>Run</button>
              <button style={btn} onClick={() => void bridge.voice.routineDelete(r.id).then(load)}>Delete</button>
            </div>
            {open === r.id && (
              <div style={{ display: 'grid', gap: 4, padding: '6px 0 4px 12px' }}>
                <input defaultValue={r.name} aria-label="Routine name" maxLength={40} style={field} spellCheck={false} onBlur={e => { if (e.target.value.trim() && e.target.value !== r.name) save(r, { name: e.target.value }) }} />
                {r.steps.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ width: 16, color: 'var(--muted)', fontSize: 11 }}>{i + 1}</span>
                    <input defaultValue={s.app} aria-label={`Step ${i + 1} app`} maxLength={60} style={{ ...field, flex: 1 }} spellCheck={false}
                      onBlur={e => { if (e.target.value.trim() && e.target.value !== s.app) save(r, { steps: r.steps.map((x, j) => (j === i ? { app: e.target.value.trim() } : { app: x.app, label: x.label })) }) }} />
                    <button style={btn} aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => { const a = r.steps.map(x => ({ app: x.app, label: x.label })); [a[i - 1], a[i]] = [a[i], a[i - 1]]; save(r, { steps: a }) }}>Up</button>
                    <button style={btn} aria-label={`Remove step ${i + 1}`} onClick={() => save(r, { steps: r.steps.filter((_, j) => j !== i).map(x => ({ app: x.app, label: x.label })) })}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
