import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Pencil, Plus, Trash2, X } from 'lucide-react'
import type { Settings } from '@shared/bridge'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { dur } from '@/lib/motion'
import { Soul } from '@/island/Soul'
import { SOUL_SKINS } from '@/island/skins'
import { Toggle } from '@/ui'
import { SLOTS, type SlotId } from './slots'

type Loadout = Settings['loadout']
const write = (patch: Partial<Loadout>) => { void bridge.settings.set({ loadout: patch }) }
const EASE = [0.33, 1, 0.68, 1] as const

const VOICES: [string, string][] = [
  ['Zephyr', 'airy and light on its feet'], ['Puck', 'playful and quick'], ['Charon', 'calm and low'], ['Kore', 'clear and steady'],
  ['Fenrir', 'warm with a gruff edge'], ['Leda', 'soft, a little shy'], ['Orus', 'measured and sturdy'], ['Aoede', 'light and melodic'],
  ['Callirrhoe', 'easy and unhurried'], ['Autonoe', 'crisp and cheerful'], ['Enceladus', 'hushed and breathy'], ['Iapetus', 'even and plainspoken'],
  ['Umbriel', 'smooth and relaxed'], ['Algieba', 'rich and mellow'], ['Despina', 'gentle, with a lilt'], ['Erinome', 'precise and cool'],
  ['Algenib', 'low with a rough edge'], ['Rasalgethi', 'thoughtful and wry'], ['Laomedeia', 'upbeat and open'], ['Achernar', 'tender and quiet'],
  ['Alnilam', 'confident and direct'], ['Schedar', 'friendly and level'], ['Gacrux', 'grounded and mature'], ['Pulcherrima', 'forward and lively'],
  ['Achird', 'warm and chatty'], ['Zubenelgenubi', 'casual and dry'], ['Vindemiatrix', 'kind and soothing'], ['Sadachbia', 'lively, a bit sharp'],
  ['Sadaltager', 'knowing and even'], ['Sulafat', 'warm and welcoming'],
]

const ABILITIES: { id: string; name: string; note: string }[] = [
  { id: 'vision', name: 'Screen vision', note: 'Circle something on screen to ask about it. Planned.' },
  { id: 'control', name: 'Computer control', note: 'Let the assistant click and type for you. Planned.' },
  { id: 'routines', name: 'Routines', note: 'Chain several actions behind one phrase. Planned.' },
  { id: 'research', name: 'Web research', note: 'Look things up and summarise sources. Planned.' },
  { id: 'memory', name: 'Clipboard memory', note: 'Recall things you copied earlier. Planned.' },
]

const TITLES: Record<SlotId, string> = { soul: 'Choose a soul', personality: 'Choose a personality', voice: 'Choose a voice', abilities: 'Abilities' }

function UseBtn({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return <button className="lk-use" data-on={on} onClick={e => { e.stopPropagation(); if (!on) onClick?.() }}>{on ? 'In use' : 'Use'}</button>
}

export function Picker({ slot, onClose }: { slot: SlotId; onClose: () => void }) {
  const lo = useData(s => s.settings.loadout)
  const meta = SLOTS.find(s => s.id === slot)!

  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: dur(0.18) }}
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(4,5,8,.62)' }}
    >
      <motion.div
        role="dialog" aria-label={TITLES[slot]}
        initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: dur(0.26), ease: EASE } }}
        exit={{ opacity: 0, y: 14, scale: 0.97, transition: { duration: dur(0.18), ease: EASE } }}
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(640px, 100%)', maxHeight: '100%', display: 'flex', flexDirection: 'column', borderRadius: 18, background: 'linear-gradient(rgb(var(--ov) / .047), rgb(var(--ov) / .047)), var(--s1)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px' }}>
          <meta.icon size={16} color={meta.color} />
          <div style={{ flex: 1, fontSize: 14, fontWeight: 650 }}>{TITLES[slot]}</div>
          <button onClick={onClose} aria-label="Close" className="icon-btn" style={{ width: 28, height: 28, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--fill-2)' }}><X size={14} /></button>
        </div>
        <div className="scroll-y" style={{ padding: '4px 16px 16px', minHeight: 0 }}>
          {slot === 'soul' && <SoulGrid lo={lo} />}
          {slot === 'personality' && <PersonalityList lo={lo} />}
          {slot === 'voice' && <VoiceGrid lo={lo} />}
          {slot === 'abilities' && <AbilityList lo={lo} />}
        </div>
      </motion.div>
    </motion.div>
  )
}

const grid = (min: number): React.CSSProperties => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 8 })
const optStyle: React.CSSProperties = { borderRadius: 12, background: 'var(--fill-1)', padding: 10 }

function SoulGrid({ lo }: { lo: Loadout }) {
  return (
    <div style={grid(170)}>
      {Object.entries(SOUL_SKINS).map(([id, s]) => (
        <div key={id} className="lk-opt" onClick={() => write({ soul: id })} style={{ ...optStyle, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <Soul width={96} height={96} mode="LISTENING" active quiet palette={s.palette} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
          <UseBtn on={lo.soul === id} onClick={() => write({ soul: id })} />
        </div>
      ))}
    </div>
  )
}

function VoiceGrid({ lo }: { lo: Loadout }) {
  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 8px' }}>Voice preview arrives with voice mode.</div>
      <div style={grid(250)}>
        {VOICES.map(([name, hint]) => (
          <div key={name} className="lk-opt" onClick={() => write({ voice: name })} style={{ ...optStyle, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hint}</div>
            </div>
            <UseBtn on={lo.voice === name} onClick={() => write({ voice: name })} />
          </div>
        ))}
      </div>
    </>
  )
}

function AbilityList({ lo }: { lo: Loadout }) {
  const toggle = (id: string, on: boolean) => write({ abilities: on ? [...lo.abilities, id] : lo.abilities.filter(a => a !== id) })
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Your choices are saved now and take effect when each ability ships.</div>
      {ABILITIES.map(a => (
        <div key={a.id} style={{ ...optStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{a.note}</div>
          </div>
          <Toggle on={lo.abilities.includes(a.id)} onChange={v => toggle(a.id, v)} label={a.name} />
        </div>
      ))}
    </div>
  )
}

function PersonalityList({ lo }: { lo: Loadout }) {
  const [form, setForm] = useState<{ id: string | null; name: string; prompt: string } | null>(null)
  const save = () => {
    if (!form) return
    const name = form.name.trim(), prompt = form.prompt.trim()
    if (!name) return
    if (form.id) write({ personalities: lo.personalities.map(p => p.id === form.id ? { ...p, name, prompt } : p) })
    else {
      const id = `p-${Date.now().toString(36)}`
      write({ personalities: [...lo.personalities, { id, name, prompt }], personality: id })
    }
    setForm(null)
  }
  const remove = (id: string) => {
    write({ personalities: lo.personalities.filter(p => p.id !== id), ...(lo.personality === id ? { personality: 'chad' } : {}) })
    if (form?.id === id) setForm(null)
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Prompts stay on this computer, in your settings file.</div>
      {lo.personalities.map(p => (
        <div key={p.id} className="lk-opt" onClick={() => write({ personality: p.id })} style={{ ...optStyle, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}{p.id === 'chad' && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--muted)', fontWeight: 500 }}>built in</span>}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.prompt || 'No prompt.'}</div>
          </div>
          {p.id !== 'chad' && (
            <>
              <IconBtn label={`Edit ${p.name}`} onClick={() => setForm({ id: p.id, name: p.name, prompt: p.prompt })}><Pencil size={13} /></IconBtn>
              <IconBtn label={`Delete ${p.name}`} onClick={() => remove(p.id)}><Trash2 size={13} /></IconBtn>
            </>
          )}
          <UseBtn on={lo.personality === p.id} onClick={() => write({ personality: p.id })} />
        </div>
      ))}
      {form ? (
        <div style={{ ...optStyle, display: 'grid', gap: 8 }}>
          <input className="lk-field" autoFocus placeholder="Name" maxLength={40} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <textarea className="lk-field" rows={5} placeholder="How should it talk and behave?" maxLength={2000} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="lk-use" onClick={() => setForm(null)}>Cancel</button>
            <button className="lk-use" data-on={false} disabled={!form.name.trim()} onClick={save} style={{ background: 'var(--accent)', color: 'var(--accent-ink)', opacity: form.name.trim() ? 1 : 0.5 }}>Save</button>
          </div>
        </div>
      ) : (
        <button className="lk-opt" onClick={() => setForm({ id: null, name: '', prompt: '' })} style={{ ...optStyle, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--soft)', border: '1px dashed rgb(var(--ov) / .14)' }}>
          <Plus size={14} /> New personality
        </button>
      )}
    </div>
  )
}

function IconBtn({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return <button aria-label={label} title={label} onClick={e => { e.stopPropagation(); onClick() }} className="icon-btn" style={{ width: 26, height: 26, borderRadius: 13, display: 'grid', placeItems: 'center', color: 'var(--soft)' }}>{children}</button>
}
