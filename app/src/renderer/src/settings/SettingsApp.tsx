import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, FolderOpen, Info, Keyboard, LayoutPanelTop, Mic, Palette, Settings2, Image as ImageIcon } from 'lucide-react'
import type { DeepPartial, Settings, TabId } from '@shared/bridge'
import { bridge } from '@/bridge'
import { applyTheme, accentFromHex, FALLBACK_ACCENT } from '@/lib/theme'
import { cn } from '@/lib/format'
import { Slider, Toggle } from '@/ui'
import { Mascot } from '@/island/Mascot'

const ALL_TABS: { id: TabId; label: string }[] = [
  { id: 'controls', label: 'Controls' }, { id: 'today', label: 'Today' }, { id: 'stats', label: 'Stats' },
  { id: 'clipboard', label: 'Clipboard' }, { id: 'apps', label: 'Apps' }, { id: 'wallpaper', label: 'Wallpaper' }, { id: 'power', label: 'Power' },
]
const SECTIONS = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'island', label: 'Island', icon: LayoutPanelTop },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'wallpaper', label: 'Wallpaper', icon: ImageIcon },
  { id: 'about', label: 'About', icon: Info },
] as const
type SectionId = (typeof SECTIONS)[number]['id']

export function SettingsApp() {
  const [s, setS] = useState<Settings | null>(null)
  const [section, setSection] = useState<SectionId>(() => (new URLSearchParams(location.hash.split('?')[1] ?? '').get('section') as SectionId | null) ?? 'general')

  useEffect(() => {
    void bridge.settings.get().then(setS)
    return bridge.settings.onChange(setS)
  }, [])
  useEffect(() => {
    if (!s) return
    applyTheme(s.appearance.theme, 1) // settings window ignores UI scale
    if (s.appearance.accent !== 'wallpaper') accentFromHex(s.appearance.accent)
    else accentFromHex(FALLBACK_ACCENT)
  }, [s?.appearance.theme, s?.appearance.accent]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return null
  const set = (p: DeepPartial<Settings>) => { void bridge.settings.set(p) }

  return (
    <div style={{ display: 'flex', height: '100%', background: 'color-mix(in srgb, var(--bg) 55%, transparent)' }}>
      <nav style={{ width: '13rem', padding: '3rem 0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.125rem', flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.75rem 1rem' }}>
          <Mascot size={24} />
          <span style={{ fontWeight: 650, fontSize: '0.9375rem' }}>lokey</span>
        </div>
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setSection(id)} className="row-hover" data-sel={section === id}
            style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.5rem 0.75rem', fontSize: '0.8125rem', fontWeight: section === id ? 600 : 500, color: section === id ? 'var(--text)' : 'var(--muted)', textAlign: 'left' }}>
            <Icon size={16} color={section === id ? 'var(--accent)' : 'currentColor'} />
            {label}
          </button>
        ))}
      </nav>
      <main className="scroll-y" style={{ flex: 1, padding: '3rem 2rem 2rem 1rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 650, margin: '0 0 1.25rem' }}>{SECTIONS.find(x => x.id === section)!.label}</h1>
        {section === 'general' && <General s={s} set={set} />}
        {section === 'island' && <Island s={s} set={set} />}
        {section === 'appearance' && <Appearance s={s} set={set} />}
        {section === 'voice' && <Voice s={s} set={set} />}
        {section === 'shortcuts' && <Shortcuts s={s} set={set} />}
        {section === 'wallpaper' && <Wallpaper s={s} set={set} />}
        {section === 'about' && <About />}
      </main>
    </div>
  )
}

type P = { s: Settings; set: (p: DeepPartial<Settings>) => void }

function Group({ children }: { children: ReactNode }) {
  return <div className="card" style={{ padding: '0.25rem 0', marginBottom: '1rem', background: 'color-mix(in srgb, var(--s1) 80%, transparent)' }}>{children}</div>
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', borderTop: '1px solid var(--line)' }} className="first:border-t-0">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 550 }}>{title}</div>
        {hint && <div style={{ fontSize: '0.6875rem', color: 'var(--dim)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>{children}</div>
    </div>
  )
}

function Select<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as T)} style={{ background: 'var(--s2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '0.5rem', padding: '0.375rem 0.625rem', fontSize: '0.8125rem' }}>
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  )
}

function NumberSlider({ value, min, max, step = 0.05, onChange, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const [drag, setDrag] = useState<number | null>(null)
  const snap = (f: number) => Math.round((min + f * (max - min)) / step) * step
  const shown = drag ?? value
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '13rem' }}>
      <div style={{ flex: 1 }}>
        <Slider value={(shown - min) / (max - min)} onChange={f => setDrag(snap(f))} onCommit={f => { onChange(snap(f)); setDrag(null) }} />
      </div>
      <span className="num" style={{ fontSize: '0.75rem', width: '3rem', textAlign: 'right' }}>{format ? format(shown) : shown.toFixed(2)}</span>
    </div>
  )
}

function HotkeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [rec, setRec] = useState(false)
  return (
    <button
      onClick={() => setRec(true)}
      onBlur={() => setRec(false)}
      onKeyDown={e => {
        if (!rec) return
        e.preventDefault()
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
        const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean) as string[]
        if (e.key === 'Escape') { setRec(false); return }
        const key = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
        if (mods.length === 0) return
        onChange([...mods, key].join('+'))
        setRec(false)
      }}
      className={cn('num')}
      style={{ minWidth: '9rem', padding: '0.375rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.75rem', background: 'var(--s2)', border: `1px solid ${rec ? 'var(--accent)' : 'var(--line)'}`, color: rec ? 'var(--accent)' : 'var(--text)' }}
    >
      {rec ? 'Press keys…' : value}
    </button>
  )
}

function General({ s, set }: P) {
  return (
    <Group>
      <Row title="Island" hint="The pill at the top of the screen."><Toggle on={s.island.enabled} onChange={v => set({ island: { enabled: v } })} /></Row>
      <Row title="Start with Windows"><Toggle on={s.startWithWindows} onChange={v => set({ startWithWindows: v })} /></Row>
      <Row title="Focus timer length" hint="Used by the Today tab."><NumberSlider value={s.focusTimerMinutes} min={5} max={90} step={5} onChange={v => set({ focusTimerMinutes: v })} format={v => `${v} min`} /></Row>
    </Group>
  )
}

function Island({ s, set }: P) {
  const order = s.island.tabs
  const hidden = ALL_TABS.filter(t => !order.includes(t.id))
  const move = (i: number, d: number) => {
    const next = [...order]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    set({ island: { tabs: next } })
  }
  return (
    <>
      <Group>
        <Row title="Size" hint="Scales the island. 100% matches the design."><NumberSlider value={s.island.size} min={0.7} max={1.2} step={0.05} onChange={v => set({ island: { size: v } })} format={v => `${Math.round(v * 100)}%`} /></Row>
        <Row title="How it opens" hint="Scroll: scroll down on the island (music first, then the menu). Hover wakes it.">
          <Select value={s.island.trigger} options={[{ v: 'both', l: 'Scroll and hover' }, { v: 'scroll', l: 'Scroll only' }, { v: 'hover', l: 'Hover only' }]} onChange={v => set({ island: { trigger: v } })} />
        </Row>
        <Row title="Resting shape" hint="What you see when the menu is closed.">
          <Select value={s.island.rest} options={[{ v: 'sleep', l: 'Sleeping (thin sliver)' }, { v: 'awake', l: 'Awake (flame)' }]} onChange={v => set({ island: { rest: v } })} />
        </Row>
        <Row title="Open on hover"><Toggle on={s.island.openOnHover} onChange={v => set({ island: { openOnHover: v } })} /></Row>
        <Row title="Hover delay"><NumberSlider value={s.island.hoverDelayMs} min={0} max={600} step={20} onChange={v => set({ island: { hoverDelayMs: v } })} format={v => `${v} ms`} /></Row>
        <Row title="Close delay" hint="How long the island waits after the pointer leaves."><NumberSlider value={s.island.closeDelayMs} min={100} max={1500} step={50} onChange={v => set({ island: { closeDelayMs: v } })} format={v => `${v} ms`} /></Row>
        <Row title="Scroll down to open"><Toggle on={s.island.scrollToOpen} onChange={v => set({ island: { scrollToOpen: v } })} /></Row>
        <Row title="Start tab">
          <Select value={s.island.startTab} options={order.map(id => ({ v: id, l: ALL_TABS.find(t => t.id === id)!.label }))} onChange={v => set({ island: { startTab: v } })} />
        </Row>
      </Group>
      <Group>
        {order.map((id, i) => (
          <Row key={id} title={ALL_TABS.find(t => t.id === id)!.label}>
            <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" style={{ opacity: i === 0 ? 0.3 : 1 }}><ArrowUp size={16} /></button>
            <button onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="Move down" style={{ opacity: i === order.length - 1 ? 0.3 : 1 }}><ArrowDown size={16} /></button>
            <Toggle on onChange={() => order.length > 1 && set({ island: { tabs: order.filter(t => t !== id) } })} />
          </Row>
        ))}
        {hidden.map(t => (
          <Row key={t.id} title={t.label} hint="Hidden">
            <Toggle on={false} onChange={() => set({ island: { tabs: [...order, t.id] } })} />
          </Row>
        ))}
      </Group>
    </>
  )
}

const textField: React.CSSProperties = { background: 'var(--s2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '0.5rem', padding: '0.375rem 0.625rem', fontSize: '0.8125rem', width: '15rem', userSelect: 'text' }
const smallBtn: React.CSSProperties = { padding: '0.375rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.75rem', fontWeight: 600, background: 'var(--s2)', border: '1px solid var(--line)' }

function Voice({ s, set }: P) {
  const [has, setHas] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  const [ask, setAsk] = useState('')
  useEffect(() => { void bridge.voice.info().then(i => setHas(i.hasKey)) }, [])
  const save = async () => {
    const ok = await bridge.voice.setKey(key)
    setMsg(ok ? 'Saved (encrypted on this PC).' : 'That does not look like an AI Studio key.')
    if (ok) { setHas(true); setKey('') }
  }
  const v = s.voice
  return (
    <>
      <Group>
        <Row title="Voice assistant" hint="Hold the talk key, speak, let go."><Toggle on={v.enabled} onChange={x => set({ voice: { enabled: x } })} /></Row>
        <Row title="Google AI Studio key" hint={has ? 'A key is saved. Paste a new one to replace it.' : 'Free from aistudio.google.com. Stored encrypted; only ever sent to Google.'}>
          <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={has ? '••••••••••••' : 'AIza…'} style={textField} autoComplete="off" spellCheck={false} />
          <button onClick={() => void save()} disabled={!key} style={{ ...smallBtn, opacity: key ? 1 : 0.4 }}>Save</button>
          {has && <button onClick={() => { void bridge.voice.clearKey(); setHas(false); setMsg('Key removed.') }} style={smallBtn}>Remove</button>}
        </Row>
        {msg && <div style={{ padding: '0 1rem 0.75rem', fontSize: '0.6875rem', color: 'var(--dim)' }}>{msg}</div>}
        <Row title="Speak replies aloud" hint="Off = captions only."><Toggle on={v.speakReplies} onChange={x => set({ voice: { speakReplies: x } })} /></Row>
        <Row title="Model" hint="Gemini Live model id."><input value={v.model} onChange={e => set({ voice: { model: e.target.value.trim() } })} style={textField} spellCheck={false} /></Row>
      </Group>
      <Group>
        <Row title="Dictation" hint="Hold the key anywhere, talk, let go: the cleaned-up sentence is typed into the focused field."><Toggle on={v.dictation} onChange={x => set({ voice: { dictation: x } })} /></Row>
        <Row title="Circle to ask" hint="Hold the key, draw a loop around anything on screen, ask about it out loud."><Toggle on={v.lasso} onChange={x => set({ voice: { lasso: x } })} /></Row>
      </Group>
      <Group>
        <Row title="Try it by typing" hint="Same as speaking, without the microphone.">
          <input value={ask} onChange={e => setAsk(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ask.trim()) { bridge.voice.say(ask); setAsk('') } }} placeholder="Open Netflix in 10 minutes" style={textField} spellCheck={false} />
          <button onClick={() => { if (ask.trim()) { bridge.voice.say(ask); setAsk('') } }} style={smallBtn}>Send</button>
        </Row>
      </Group>
    </>
  )
}

const HOLD_PRESETS = [
  { v: 'Ctrl+Win', l: 'Ctrl + Win' }, { v: 'Ctrl+Shift', l: 'Ctrl + Shift' }, { v: 'Ctrl+Alt', l: 'Ctrl + Alt' }, { v: 'Win+Shift', l: 'Win + Shift' }, { v: 'Ctrl+Alt+V', l: 'Ctrl + Alt + V' },
  { v: 'Ctrl+Alt+D', l: 'Ctrl + Alt + D' }, { v: 'Ctrl+Alt+L', l: 'Ctrl + Alt + L' },
]

function ShortcutRow({ title, hint, value, onChange, status, clash, presets, clearable }: {
  title: string; hint?: string; value: string; onChange: (v: string) => void; status?: string; clash?: boolean
  presets?: { v: string; l: string }[]; clearable?: boolean
}) {
  const problem = clash ? 'Used twice: only one of them will work.' : status
  return (
    <Row title={title} hint={problem ? undefined : hint}>
      {problem && <span style={{ fontSize: '0.6875rem', color: '#e8a04a', maxWidth: '14rem', textAlign: 'right' }}>{problem === 'already registered by another application' ? 'Taken by another app' : problem}</span>}
      {presets && (
        <Select value={presets.some(p => p.v === value) ? value : ''} options={[{ v: '', l: 'Presets…' }, ...presets]} onChange={v => { if (v) onChange(v) }} />
      )}
      <HotkeyInput value={value || 'None'} onChange={onChange} />
      {clearable && value && <button onClick={() => onChange('')} style={{ ...smallBtn, padding: '0.375rem 0.625rem' }}>Clear</button>}
    </Row>
  )
}

function Shortcuts({ s, set }: P) {
  const [status, setStatus] = useState<Record<string, string>>({})
  const sig = JSON.stringify([s.island.hotkey, s.island.tabHotkeys, s.voice.pushToTalk, s.voice.dictationKey, s.voice.lassoKey, s.voice.enabled, s.voice.dictation, s.voice.lasso])
  useEffect(() => {
    const t = setTimeout(() => { void bridge.hotkeyStatus().then(setStatus) }, 700) // main re-registers after a change
    return () => clearTimeout(t)
  }, [sig])
  const all = [s.island.hotkey, s.voice.pushToTalk, s.voice.dictationKey, s.voice.lassoKey, ...Object.values(s.island.tabHotkeys)].filter(Boolean).map(x => x.toLowerCase())
  const clash = (v: string) => !!v && all.filter(x => x === v.toLowerCase()).length > 1
  const th = s.island.tabHotkeys
  return (
    <>
      <div style={{ fontSize: '0.75rem', color: 'var(--dim)', margin: '-0.5rem 0 1rem', lineHeight: 1.5 }}>
        Click a shortcut, then press the new keys. Windows already uses some combinations (Win+A, Win+V, Win+S...): if one is taken you will see it here. Hold shortcuts (voice) can also be a bare modifier pair: pick one from Presets.
      </div>
      <Group>
        <ShortcutRow title="Open or close the island" value={s.island.hotkey} onChange={v => set({ island: { hotkey: v } })} status={status.island} clash={clash(s.island.hotkey)} />
      </Group>
      <Group>
        {ALL_TABS.map(t => (
          <ShortcutRow key={t.id} title={`Open ${t.label}`} hint="Opens the island on this tab; press again to close." value={th[t.id] ?? ''} onChange={v => set({ island: { tabHotkeys: { [t.id]: v } as Record<TabId, string> } })}
            status={status[`tab:${t.id}`]} clash={clash(th[t.id] ?? '')} clearable />
        ))}
      </Group>
      <Group>
        <ShortcutRow title="Hold to talk" hint="Hold, speak, release." value={s.voice.pushToTalk} onChange={v => set({ voice: { pushToTalk: v } })} status={s.voice.enabled ? status.talk : undefined} clash={clash(s.voice.pushToTalk)} presets={HOLD_PRESETS} />
        <ShortcutRow title="Dictation" hint="Hold in any text field, talk, release." value={s.voice.dictationKey} onChange={v => set({ voice: { dictationKey: v } })} status={s.voice.dictation ? status.dictation : undefined} clash={clash(s.voice.dictationKey)} presets={HOLD_PRESETS} />
        <ShortcutRow title="Circle to ask" hint="Hold, draw a loop, ask." value={s.voice.lassoKey} onChange={v => set({ voice: { lassoKey: v } })} status={s.voice.lasso ? status.lasso : undefined} clash={clash(s.voice.lassoKey)} presets={HOLD_PRESETS} />
      </Group>
      <Group>
        <Row title="Reset shortcuts" hint="Back to the defaults.">
          <button style={smallBtn} onClick={() => set({
            island: { hotkey: 'Ctrl+Alt+Space', tabHotkeys: { controls: '', today: '', stats: '', clipboard: 'Ctrl+Alt+C', apps: 'Ctrl+Alt+A', wallpaper: '', power: '' } },
            voice: { pushToTalk: 'Ctrl+Alt+V', dictationKey: 'Ctrl+Win', lassoKey: 'Ctrl+Shift' },
          })}>Reset</button>
        </Row>
      </Group>
    </>
  )
}

function Appearance({ s, set }: P) {
  const custom = s.appearance.accent !== 'wallpaper'
  return (
    <Group>
      <Row title="Theme"><Select value={s.appearance.theme} options={[{ v: 'dark', l: 'Dark' }, { v: 'light', l: 'Light' }, { v: 'auto', l: 'Follow Windows' }]} onChange={v => set({ appearance: { theme: v } })} /></Row>
      <Row title="Accent colour" hint="Follow the wallpaper, or pick a fixed colour.">
        <Select value={custom ? 'custom' : 'wallpaper'} options={[{ v: 'wallpaper', l: 'From wallpaper' }, { v: 'custom', l: 'Custom' }]} onChange={v => set({ appearance: { accent: v === 'wallpaper' ? 'wallpaper' : FALLBACK_ACCENT } })} />
        {custom && <input type="color" value={s.appearance.accent} onChange={e => set({ appearance: { accent: e.target.value } })} style={{ width: '2rem', height: '2rem', background: 'none', border: 0 }} />}
      </Row>
      <Row title="UI scale" hint="Resizes the island and its content. Restart for the overlay window to resize."><NumberSlider value={s.appearance.scale} min={0.75} max={1.5} step={0.05} onChange={v => set({ appearance: { scale: v } })} format={v => `${Math.round(v * 100)}%`} /></Row>
      <Row title="Animation speed"><NumberSlider value={s.appearance.animSpeed} min={0.5} max={2} step={0.1} onChange={v => set({ appearance: { animSpeed: v } })} format={v => `${v.toFixed(1)}×`} /></Row>
      <Row title="Reduce motion" hint="Turns animations off."><Toggle on={s.appearance.reduceMotion} onChange={v => set({ appearance: { reduceMotion: v } })} /></Row>
      <Row title="Preview screen glow" hint="The edge glow shown while the assistant thinks or speaks.">
        {(['thinking', 'speaking', 'off'] as const).map(g => (
          <button key={g} className="field" style={{ width: 'auto', cursor: 'pointer', padding: '0.375rem 0.75rem', textTransform: 'capitalize' }} onClick={() => { bridge.effects.glow(g); if (g !== 'off') setTimeout(() => bridge.effects.glow('off'), 4000) }}>{g}</button>
        ))}
      </Row>
    </Group>
  )
}

function Wallpaper({ s, set }: P) {
  return (
    <Group>
      <Row title="My folder" hint={s.wallpaper.folder ?? 'Pictures'}>
        <button onClick={async () => { const f = await bridge.app.pickFolder(); if (f) set({ wallpaper: { folder: f } }) }} className="row-hover" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.375rem 0.75rem', background: 'var(--s2)', borderRadius: '0.5rem', fontSize: '0.8125rem' }}>
          <FolderOpen size={14} /> Choose…
        </button>
      </Row>
    </Group>
  )
}

function About() {
  return (
    <div style={{ color: 'var(--muted)', fontSize: '0.8125rem', lineHeight: 1.6, maxWidth: '30rem' }}>
      <p style={{ margin: 0 }}><b style={{ color: 'var(--text)' }}>lokey</b> — a voice-first island for Windows.</p>
      <p>Open source (GPL-3.0). Island design inspired by Caelestia; feature set inspired by the idea of a voice-driven desktop companion.</p>
      <p style={{ color: 'var(--dim)' }}>Settings file: %LocalAppData%\Lokey\settings.json</p>
    </div>
  )
}
