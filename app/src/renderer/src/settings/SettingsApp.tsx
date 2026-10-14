import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, BrainCircuit, FolderOpen, Info, Keyboard, LayoutPanelTop, Mic, Palette, Settings2, Smartphone, Image as ImageIcon } from 'lucide-react'
import type { BrainRole, DeepPartial, ProviderConfig, Settings, TabId } from '@shared/bridge'
import { bridge } from '@/bridge'
import { applyTheme, accentFromHex, FALLBACK_ACCENT } from '@/lib/theme'
import { cn } from '@/lib/format'
import { Slider, Toggle } from '@/ui'
import { Mascot } from '@/island/Mascot'
import { isPhone } from '@/lib/platform'
import { DevicesSection } from './DevicesSection'
import { PermissionsSection } from './PermissionsSection'

const ALL_TABS: { id: TabId; label: string }[] = [
  { id: 'controls', label: 'Controls' }, { id: 'today', label: 'Today' }, { id: 'stats', label: 'Stats' },
  { id: 'clipboard', label: 'Clipboard' }, { id: 'apps', label: 'Apps' }, { id: 'wallpaper', label: 'Wallpaper' }, { id: 'power', label: 'Power' },
]
const SECTIONS = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'island', label: 'Island', icon: LayoutPanelTop },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'brain', label: 'Brain', icon: BrainCircuit },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'wallpaper', label: 'Wallpaper', icon: ImageIcon },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'permissions', label: 'Permissions', icon: Info },
  { id: 'about', label: 'About', icon: Info },
] as const
const PHONE_HIDDEN: string[] = ['shortcuts', 'wallpaper', 'devices']
const SECTION_LIST: readonly { id: string; label: string; icon: typeof Settings2 }[] = isPhone
  ? [...SECTIONS.filter(x => !PHONE_HIDDEN.includes(x.id)), { id: 'wake', label: 'Wake-up', icon: Mic }]
  : SECTIONS
type SectionId = string

/** `embedded` (the phone's You page): one section, no section list, the page supplies its own title */
export function SettingsApp({ section: want, embedded }: { section?: string; embedded?: boolean } = {}) {
  const [s, setS] = useState<Settings | null>(null)
  const known = (v: string | null | undefined): v is SectionId => SECTION_LIST.some(x => x.id === v)
  const [section, setSection] = useState<SectionId>(() => { const q = want ?? new URLSearchParams(location.hash.split('?')[1] ?? '').get('section'); return known(q) ? q : 'general' })
  useEffect(() => { if (known(want)) setSection(want) }, [want]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isPhone) document.querySelector('.lk-set-nav [data-sel="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }) }, [section, s === null])

  useEffect(() => {
    void bridge.settings.get().then(setS)
    return bridge.settings.onChange(setS)
  }, [])
  useEffect(() => {
    if (!s || isPhone) return // the phone shell (App) owns theme, text size and accent
    applyTheme(s.appearance.theme, 1) // settings window ignores UI scale
    if (s.appearance.accent !== 'wallpaper') accentFromHex(s.appearance.accent)
    else accentFromHex(FALLBACK_ACCENT)
  }, [s?.appearance.theme, s?.appearance.accent]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return null
  const set = (p: DeepPartial<Settings>) => { void bridge.settings.set(p) }

  return (
    <div className={embedded ? 'lk-set lk-set-embedded' : 'lk-set'} style={{ display: 'flex', height: '100%', background: 'color-mix(in srgb, var(--bg) 55%, transparent)' }}>
      <nav className="lk-set-nav" style={{ width: '13rem', padding: '3rem 0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.125rem', flex: 'none' }}>
        <div className="lk-set-brand" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 0.75rem 1rem' }}>
          <Mascot size={24} />
          <span style={{ fontWeight: 650, fontSize: '0.9375rem' }}>lokey</span>
        </div>
        {SECTION_LIST.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setSection(id)} className="row-hover" data-sel={section === id}
            style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '0.5rem 0.75rem', fontSize: '0.8125rem', fontWeight: section === id ? 600 : 500, color: section === id ? 'var(--text)' : 'var(--muted)', textAlign: 'left' }}>
            <Icon size={16} color={section === id ? 'var(--accent)' : 'currentColor'} />
            {label}
          </button>
        ))}
      </nav>
      <main className="scroll-y lk-set-main" style={{ flex: 1, minHeight: 0, padding: '3rem 2rem 2rem 1rem' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 650, margin: '0 0 1.25rem' }}>{SECTION_LIST.find(x => x.id === section)!.label}</h1>
        {section === 'general' && <General s={s} set={set} />}
        {section === 'island' && <Island s={s} set={set} />}
        {section === 'appearance' && <Appearance s={s} set={set} />}
        {section === 'voice' && <Voice s={s} set={set} />}
        {section === 'brain' && <BrainSettings s={s} set={set} />}
        {section === 'shortcuts' && <Shortcuts s={s} set={set} />}
        {section === 'wallpaper' && <Wallpaper s={s} set={set} />}
        {section === 'devices' && <DevicesSection />}
        {section === 'permissions' && <PermissionsSection />}
        {section === 'about' && <About />}
        {section === 'wake' && <WakeSettings s={s} set={set} />}
      </main>
    </div>
  )
}

type P = { s: Settings; set: (p: DeepPartial<Settings>) => void }

export function Group({ children }: { children: ReactNode }) {
  return <div className="card" style={{ padding: '0.25rem 0', marginBottom: '1rem', background: 'color-mix(in srgb, var(--s1) 80%, transparent)' }}>{children}</div>
}

/** `desktop`: only meaningful on a PC (hotkeys, hover, window placement...), hidden on the phone */
export function Row({ title, hint, children, desktop }: { title: string; hint?: string; children: ReactNode; desktop?: boolean }) {
  if (desktop && isPhone) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', borderTop: '1px solid var(--line)' }} className="first:border-t-0 lk-set-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 550 }}>{title}</div>
        {hint && <div style={{ fontSize: '0.6875rem', color: 'var(--dim)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>{children}</div>
    </div>
  )
}

export function Select<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as T)} style={{ background: 'var(--s2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '0.5rem', padding: '0.375rem 0.625rem', fontSize: '0.8125rem' }}>
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  )
}

export function NumberSlider({ value, min, max, step = 0.05, onChange, format }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
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
      <Row title="Start with Windows" desktop><Toggle on={s.startWithWindows} onChange={v => set({ startWithWindows: v })} /></Row>
      <Row title="Focus timer length" hint="Used by the Today tab."><NumberSlider value={s.focusTimerMinutes} min={5} max={90} step={5} onChange={v => set({ focusTimerMinutes: v })} format={v => `${v} min`} /></Row>
    </Group>
  )
}

function Island({ s, set }: P) {
  const tabsHere = isPhone ? ALL_TABS.filter(t => t.id !== 'wallpaper' && t.id !== 'power') : ALL_TABS // those two act on a PC
  const order = s.island.tabs.filter(id => tabsHere.some(t => t.id === id))
  const hidden = tabsHere.filter(t => !order.includes(t.id))
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
        <Row desktop title="How it opens" hint="Scroll: scroll down on the island (music first, then the menu). Hover wakes it.">
          <Select value={s.island.trigger} options={[{ v: 'both', l: 'Scroll and hover' }, { v: 'scroll', l: 'Scroll only' }, { v: 'hover', l: 'Hover only' }]} onChange={v => set({ island: { trigger: v } })} />
        </Row>
        <Row title="Resting shape" hint="What you see when the menu is closed.">
          <Select value={s.island.rest} options={[{ v: 'sleep', l: 'Sleeping (thin sliver)' }, { v: 'awake', l: 'Awake (flame)' }]} onChange={v => set({ island: { rest: v } })} />
        </Row>
        <Row desktop title="Position" hint="Hold the move shortcut (Settings > Shortcuts) and put the pointer on any edge or corner, or click Move island. Esc cancels.">
          <Select value={s.island.edge} options={[{ v: 'top', l: 'Top' }, { v: 'bottom', l: 'Bottom' }, { v: 'left', l: 'Left' }, { v: 'right', l: 'Right' }]} onChange={v => set({ island: { edge: v } })} />
          <button onClick={() => bridge.place.start('pick')} style={smallBtn}>Move island…</button>
          <button onClick={() => bridge.lyrics.openWindow()} style={smallBtn} title="Open the lyrics window">Lyrics window</button>
        </Row>
        <Row title="Sleeping look" hint="Hairline leaves almost the whole top edge free for browser tabs and title bars.">
          <Select value={s.island.sleepLook} options={[{ v: 'sliver', l: 'Small notch' }, { v: 'hairline', l: 'Hairline' }]} onChange={v => set({ island: { sleepLook: v } })} />
        </Row>
        <Row title="Lyrics" hint="Synced lyrics in a pop-up window (the lyrics button on the player, the tray, or the shortcut). Looked up on lrclib.net: only the title, artist and length are sent."><Toggle on={s.island.lyrics !== 'off'} onChange={v => set({ island: { lyrics: v ? 'on' : 'off' } })} /></Row>
        <Row desktop title="Open on hover"><Toggle on={s.island.openOnHover} onChange={v => set({ island: { openOnHover: v } })} /></Row>
        <Row desktop title="Hover delay"><NumberSlider value={s.island.hoverDelayMs} min={0} max={600} step={20} onChange={v => set({ island: { hoverDelayMs: v } })} format={v => `${v} ms`} /></Row>
        <Row desktop title="Close delay" hint="How long the island waits after the pointer leaves."><NumberSlider value={s.island.closeDelayMs} min={100} max={1500} step={50} onChange={v => set({ island: { closeDelayMs: v } })} format={v => `${v} ms`} /></Row>
        <Row desktop title="Scroll down to open"><Toggle on={s.island.scrollToOpen} onChange={v => set({ island: { scrollToOpen: v } })} /></Row>
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

export const textField: React.CSSProperties = { background: 'var(--s2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: '0.5rem', padding: '0.375rem 0.625rem', fontSize: '0.8125rem', width: '15rem', userSelect: 'text' }
export const smallBtn: React.CSSProperties = { padding: '0.375rem 0.75rem', borderRadius: '0.5rem', fontSize: '0.75rem', fontWeight: 600, background: 'var(--s2)', border: '1px solid var(--line)' }

const ROLE_LABEL: Record<BrainRole, string> = { fast: 'fast', main: 'main', heavy: 'heavy' }
const ROLE_HINT: Record<BrainRole, string> = { fast: 'cheap jobs: summaries, quick questions', main: 'the agent loop that does multi-step work', heavy: 'hard problems' }

/** Language-model backends, autonomy, coding agents, and today's usage */
function BrainSettings({ s, set }: P) {
  const list = s.brain.providers
  const [usage, setUsage] = useState<Record<string, { requests: number; in: number; out: number; errors: number }>>({})
  const [keys, setKeys] = useState<Record<string, boolean>>({})
  const [typed, setTyped] = useState<Record<string, string>>({})
  const [test, setTest] = useState<Record<string, string>>({})
  const [cli, setCli] = useState<{ claude: boolean; codex: boolean } | null>(null)
  const [adding, setAdding] = useState({ name: '', url: '', model: '' })
  const [now, setNow] = useState(Date.now())
  const refs = [...new Set(list.map(p => p.keyRef))]
  const load = () => { void bridge.brain.usage().then(setUsage); for (const r of refs) void bridge.brain.hasSecret(r).then(h => setKeys(k => ({ ...k, [r]: h }))) }
  useEffect(() => { load(); void bridge.brain.cli().then(setCli); const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const patch = (id: string, p: Partial<ProviderConfig>) => set({ brain: { providers: list.map(x => (x.id === id ? { ...x, ...p } : x)) } })
  const move = (i: number, d: number) => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; set({ brain: { providers: n } }) }
  const toggleRole = (p: ProviderConfig, r: BrainRole) => patch(p.id, { roles: p.roles.includes(r) ? p.roles.filter(x => x !== r) : [...p.roles, r] })
  const saveKey = async (ref: string) => { const ok = await bridge.brain.setSecret(ref, typed[ref] ?? ''); setTest(t => ({ ...t, [ref]: ok ? 'Key saved (encrypted on this PC).' : 'That key was not accepted.' })); if (ok) { setTyped(t => ({ ...t, [ref]: '' })); load() } }
  const runTest = async (id: string) => { setTest(t => ({ ...t, [id]: 'Testing…' })); const r = await bridge.brain.test(id); setTest(t => ({ ...t, [id]: r.ok ? `Working (${r.ms} ms)` : `Failed: ${r.error}` })); load() }
  const add = () => {
    if (!adding.name.trim() || !adding.url.trim()) return
    const id = 'custom-' + Math.random().toString(36).slice(2, 7)
    set({ brain: { providers: [...list, { id, name: adding.name.trim(), kind: 'openai', baseUrl: adding.url.trim(), model: adding.model.trim(), enabled: true, keyRef: id, roles: ['main'], dailyLimit: 0 }] } })
    setAdding({ name: '', url: '', model: '' })
  }
  const full = s.agent.fullUntil && s.agent.fullUntil > now ? Math.ceil((s.agent.fullUntil - now) / 60_000) : 0
  const stock = new Set(['gemini-flash', 'gemini-lite', 'freellmapi', 'openrouter'])
  return (
    <>
      <Group>
        <div style={{ padding: '0.75rem 1rem 0.25rem', fontSize: '0.8125rem', fontWeight: 600 }}>Models</div>
        <div style={{ padding: '0 1rem 0.5rem', fontSize: '0.6875rem', color: 'var(--dim)', lineHeight: 1.5 }}>The voice always uses Google's free Live model. Thinking and doing (multi-step jobs, helpers, computer control) use these, in this order: if one is rate limited or down the next is tried. Free tiers vary in how well they call tools, so test each one. <b>FreeLLMAPI</b> is a separate free app that pools many providers' free tiers behind one address: install it, start it, and paste its key here.</div>
        {list.map((p, i) => (
          <div key={p.id} style={{ padding: '0.625rem 1rem', borderTop: '1px solid var(--line)', display: 'grid', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Toggle on={p.enabled} onChange={v => patch(p.id, { enabled: v })} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--dim)' }}>{usage[p.id] ? `today: ${usage[p.id].requests} requests, ${usage[p.id].in + usage[p.id].out} tokens${usage[p.id].errors ? `, ${usage[p.id].errors} errors` : ''}` : 'not used today'}</div>
              </div>
              <button onClick={() => move(i, -1)} disabled={i === 0} style={{ ...smallBtn, opacity: i === 0 ? 0.3 : 1 }} aria-label="Try earlier"><ArrowUp size={12} /></button>
              <button onClick={() => move(i, 1)} disabled={i === list.length - 1} style={{ ...smallBtn, opacity: i === list.length - 1 ? 0.3 : 1 }} aria-label="Try later"><ArrowDown size={12} /></button>
              <button onClick={() => void runTest(p.id)} style={smallBtn}>Test</button>
              {!stock.has(p.id) && <button onClick={() => set({ brain: { providers: list.filter(x => x.id !== p.id) } })} style={smallBtn}>Remove</button>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input value={p.model} onChange={e => patch(p.id, { model: e.target.value.trim() })} placeholder="model name" style={{ ...textField, width: '12rem' }} spellCheck={false} />
              {p.kind === 'openai' && <input value={p.baseUrl} onChange={e => patch(p.id, { baseUrl: e.target.value.trim() })} placeholder="http://localhost:3001/v1" style={{ ...textField, width: '14rem' }} spellCheck={false} />}
              {p.keyRef === 'gemini' ? <span style={{ fontSize: '0.6875rem', color: 'var(--dim)' }}>{keys.gemini ? 'uses your Google key from Settings > Voice' : 'needs your Google key (Settings > Voice)'}</span> : (
                <>
                  <input type="password" value={typed[p.keyRef] ?? ''} onChange={e => setTyped(t => ({ ...t, [p.keyRef]: e.target.value }))} placeholder={keys[p.keyRef] ? '•••• saved' : 'API key (optional for local)'} style={{ ...textField, width: '11rem' }} autoComplete="off" spellCheck={false} />
                  <button onClick={() => void saveKey(p.keyRef)} disabled={!typed[p.keyRef]} style={{ ...smallBtn, opacity: typed[p.keyRef] ? 1 : 0.4 }}>Save key</button>
                  {keys[p.keyRef] && <button onClick={() => void bridge.brain.clearSecret(p.keyRef).then(load)} style={smallBtn}>Remove key</button>}
                </>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '0.6875rem', color: 'var(--muted)' }}>
              used for:
              {(['fast', 'main', 'heavy'] as BrainRole[]).map(r => (
                <label key={r} title={ROLE_HINT[r]} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0.125rem 0.5rem', borderRadius: '0.75rem', background: p.roles.includes(r) ? 'color-mix(in srgb, var(--accent) 22%, transparent)' : 'var(--s2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={p.roles.includes(r)} onChange={() => toggleRole(p, r)} style={{ display: 'none' }} />{ROLE_LABEL[r]}
                </label>
              ))}
              {test[p.id] && <span style={{ marginLeft: 8, color: test[p.id].startsWith('Failed') ? '#e8a04a' : 'var(--dim)' }}>{test[p.id]}</span>}
              {test[p.keyRef] && <span style={{ marginLeft: 8, color: 'var(--dim)' }}>{test[p.keyRef]}</span>}
            </div>
          </div>
        ))}
        <Row title="Add another provider" hint="Any OpenAI-compatible address: Groq, Cerebras, Ollama, LM Studio...">
          <input value={adding.name} onChange={e => setAdding({ ...adding, name: e.target.value })} placeholder="Name" style={{ ...textField, width: '6rem' }} spellCheck={false} />
          <input value={adding.url} onChange={e => setAdding({ ...adding, url: e.target.value })} placeholder="https://…/v1" style={{ ...textField, width: '11rem' }} spellCheck={false} />
          <input value={adding.model} onChange={e => setAdding({ ...adding, model: e.target.value })} placeholder="model" style={{ ...textField, width: '8rem' }} spellCheck={false} />
          <button onClick={add} disabled={!adding.name.trim() || !adding.url.trim()} style={{ ...smallBtn, opacity: adding.name.trim() && adding.url.trim() ? 1 : 0.4 }}>Add</button>
        </Row>
        <Row title="Instructions" hint="How Lokey is told to behave is a set of small text files you can edit (tone, language, rules). Changes apply to the next conversation.">
          <button onClick={() => bridge.brain.prompts('open')} style={smallBtn}>Open folder</button>
          <button onClick={() => bridge.brain.prompts('reset')} style={smallBtn}>Reset to defaults</button>
        </Row>
        <Row title="Learn from conversations" hint="Lokey writes down what matters (preferences, people, projects) and what you correct, on this PC. See and edit it on the Bond page."><Toggle on={s.brain.learn} onChange={v => set({ brain: { learn: v } })} /></Row>
        <Row title="Search memory by meaning" hint="Uses Google's free embedding model to find related memories even with different words. Off = word matching only."><Toggle on={s.brain.embed} onChange={v => set({ brain: { embed: v } })} /></Row>
        <Row title="Never learn from these apps" hint="Comma separated, part of the program name."><input value={s.brain.excludeApps.join(', ')} onChange={e => set({ brain: { excludeApps: e.target.value.split(',').map(x => x.trim()).filter(Boolean) } })} style={{ ...textField, width: '16rem' }} spellCheck={false} /></Row>
        <Row title="Most steps per job" hint="How many model calls one background job may make."><NumberSlider value={s.brain.maxSteps} min={4} max={30} step={1} onChange={v => set({ brain: { maxSteps: v } })} format={v => String(v)} /></Row>
      </Group>

      <Group>
        <div style={{ padding: '0.75rem 1rem 0.25rem', fontSize: '0.8125rem', fontWeight: 600 }}>What Lokey may do on its own</div>
        <Row title="Autonomy" hint="Only risky: asks before typing for you, changing files, running commands, unknown links, power. Every action: asks for everything. Full control: never asks (a short protected list, like formatting drives or reading saved passwords, is refused regardless).">
          <Select value={s.agent.confirmMode} options={[{ v: 'risky', l: 'Only risky actions' }, { v: 'always', l: 'Every action' }, { v: 'full', l: 'Full control (never ask)' }]} onChange={x => set({ agent: { confirmMode: x } })} />
        </Row>
        <Row title="Full control for a while" hint={full ? `On: ${full} min left. It never asks until then.` : 'Lets Lokey work through a big job without a card for every step, then turns itself off.'}>
          {full > 0 ? <button onClick={() => set({ agent: { fullUntil: null } })} style={smallBtn}>Turn off now</button> : [15, 60, 180].map(m => <button key={m} onClick={() => set({ agent: { fullUntil: Date.now() + m * 60_000 } })} style={smallBtn}>{m < 60 ? `${m} min` : `${m / 60} h`}</button>)}
        </Row>
        <Row desktop title="Stop everything" hint="Ends every job, helper, conversation and full-control grant at once. Also in the tray menu."><HotkeyInput value={s.agent.stopKey || 'None'} onChange={v => set({ agent: { stopKey: v } })} /></Row>
      </Group>

      {!isPhone && <Group>
        <div style={{ padding: '0.75rem 1rem 0.25rem', fontSize: '0.8125rem', fontWeight: 600 }}>Coding agents</div>
        <div style={{ padding: '0 1rem 0.5rem', fontSize: '0.6875rem', color: 'var(--dim)', lineHeight: 1.5 }}>Lokey can hand a programming job to Claude Code or Codex if you have them installed and signed in. It runs your own copy of the command (it never touches your login) and asks first.</div>
        <Row title="Claude Code" hint={cli ? (cli.claude ? 'Found on this PC.' : 'Not found (npm install -g @anthropic-ai/claude-code, then sign in once).') : 'Looking…'}><Toggle on={s.brain.cli.claude} onChange={v => set({ brain: { cli: { claude: v } } })} /></Row>
        <Row title="Codex" hint={cli ? (cli.codex ? 'Found on this PC.' : 'Not found (npm install -g @openai/codex, then sign in once).') : 'Looking…'}><Toggle on={s.brain.cli.codex} onChange={v => set({ brain: { cli: { codex: v } } })} /></Row>
        <Row title="Default project folder" hint="Used when no folder is named."><input value={s.brain.cli.folder} onChange={e => set({ brain: { cli: { folder: e.target.value } } })} placeholder="C:\\Users\\you\\Projects" style={{ ...textField, width: '16rem' }} spellCheck={false} /></Row>
        <Row title="Let them change files" hint="Off: they can only read and explain. On: they may edit files and run commands in the project folder."><Toggle on={s.brain.cli.allowEdits} onChange={v => set({ brain: { cli: { allowEdits: v } } })} /></Row>
      </Group>}
    </>
  )
}

/** Wake-up: claps and spoken phrases, analysed on this PC */
function WakeSettings({ s, set }: P) {
  const w = s.wake
  const [st, setSt] = useState<{ listening: boolean; recogniser: string | null; error: string | null; available: boolean } | null>(null)
  useEffect(() => { const load = () => void bridge.wake.status().then(setSt); load(); const t = setInterval(load, 4000); return () => clearInterval(t) }, [w.enabled, w.claps, w.phrases, w.list.length])
  const setList = (list: typeof w.list) => set({ wake: { list } })
  return (
    <Group>
      <div style={{ padding: '0.75rem 1rem 0.25rem', fontSize: '0.8125rem', fontWeight: 600 }}>Wake-up</div>
      <div style={{ padding: '0 1rem 0.5rem', fontSize: '0.6875rem', color: 'var(--dim)', lineHeight: 1.5 }}>{isPhone ? 'Wake Lokey without touching the phone: clap twice, or say a phrase. The microphone stays on through a notification while this is on; the audio is analysed on this phone, never stored and never sent anywhere until Lokey is awake. Allow Lokey in the battery and autostart settings or Android will stop it (You > OriginOS tips).' : <>Wake Lokey without touching the keyboard: clap twice, or say a phrase. Needs the microphone to stay on: the audio is analysed here on this PC (Windows' own speech engine for phrases), never stored and never sent anywhere until Lokey is awake. Turn it off from the tray any time. Phrases are English; Tamil wake phrases are not supported yet.</>}</div>
      <Row title="Listen for wake-up" hint={st ? (w.enabled ? (st.error ? st.error : st.listening ? `Listening${st.recogniser ? ` (${st.recogniser} speech engine)` : ''}.` : 'Starting…') : 'Off.') : ''}><Toggle on={w.enabled} onChange={v => set({ wake: { enabled: v } })} /></Row>
      <Row title="Double clap" hint="Two sharp claps start a conversation."><Toggle on={w.claps} onChange={v => set({ wake: { claps: v } })} /></Row>
      <Row title="Clap sensitivity" hint="Higher picks up softer claps (and more false alarms)."><NumberSlider value={w.clapSensitivity} min={0.5} max={2} step={0.1} onChange={v => set({ wake: { clapSensitivity: v } })} format={v => `${Math.round(v * 100)}%`} /></Row>
      <Row title="Spoken phrases" hint={st && !st.available ? 'No English speech recogniser is installed in Windows.' : 'The phrases below.'}><Toggle on={w.phrases} onChange={v => set({ wake: { phrases: v } })} /></Row>
      <Row title="How sure it must be" hint="Higher = fewer false wake-ups, but you may have to say it twice."><NumberSlider value={w.confidence} min={0.5} max={0.95} step={0.01} onChange={v => set({ wake: { confidence: v } })} format={v => `${Math.round(v * 100)}%`} /></Row>
      {w.list.map((p, i) => (
        <Row key={i} title={`“${p.text}”`} hint={p.action === 'listen' ? 'Starts listening.' : p.action === 'greet' ? 'Greets you, then listens.' : 'Welcomes you, gives your briefing, picks up where you left off.'}>
          <Select value={p.action} options={[{ v: 'listen', l: 'Just listen' }, { v: 'greet', l: 'Greet me' }, { v: 'welcome', l: 'Welcome home' }]} onChange={v => setList(w.list.map((x, j) => (j === i ? { ...x, action: v } : x)))} />
          <button onClick={() => setList(w.list.filter((_, j) => j !== i))} style={smallBtn}>Remove</button>
        </Row>
      ))}
      <Row title="Add a phrase" hint="Two to four words work best.">
        <AddPhrase onAdd={t => setList([...w.list, { text: t, action: 'listen' }])} />
      </Row>
    </Group>
  )
}

function AddPhrase({ onAdd }: { onAdd: (t: string) => void }) {
  const [t, setT] = useState('')
  const go = () => { const v = t.trim().toLowerCase(); if (v.length > 2 && v.length < 40) { onAdd(v); setT('') } }
  return (<><input value={t} onChange={e => setT(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="hey buddy" style={textField} spellCheck={false} /><button onClick={go} disabled={t.trim().length < 3} style={{ ...smallBtn, opacity: t.trim().length < 3 ? 0.4 : 1 }}>Add</button></>)
}

/** MCP servers: extra abilities (files, GitHub, Notion, browser...) as local tool processes */
function Connectors({ s, set }: P) {
  const [status, setStatus] = useState<{ id: string; name: string; ok: boolean; tools: number; error?: string }[]>([])
  const [name, setName] = useState('')
  const [cmd, setCmd] = useState('')
  const list = s.agent.mcp
  useEffect(() => { const t = setTimeout(() => { void bridge.voice.mcpStatus().then(setStatus) }, 1500); return () => clearTimeout(t) }, [list])
  const add = () => {
    const parts = cmd.trim().match(/"[^"]*"|\S+/g)?.map(x => x.replace(/^"|"$/g, ''))
    if (!name.trim() || !parts?.length) return
    set({ agent: { mcp: [...list, { id: Math.random().toString(36).slice(2, 8), name: name.trim(), command: parts[0], args: parts.slice(1), enabled: true, trusted: false }] } })
    setName(''); setCmd('')
  }
  return (
    <Group>
      <div style={{ padding: '0.75rem 1rem 0.25rem', fontSize: '0.8125rem', fontWeight: 600 }}>Connectors (MCP)</div>
      <div style={{ padding: '0 1rem 0.5rem', fontSize: '0.6875rem', color: 'var(--dim)', lineHeight: 1.5 }}>Give the assistant more abilities with any MCP tool server, e.g. <code>npx -y @modelcontextprotocol/server-filesystem C:\Users\you\Documents</code>. Each call asks first unless you mark the connector trusted. Applies from the next conversation.</div>
      {list.map(m => {
        const st = status.find(x => x.id === m.id)
        return (
          <Row key={m.id} title={m.name} hint={m.enabled ? (st ? (st.ok ? `${st.tools} tools ready` : st.error ?? 'not running') : 'starting…') : 'off'}>
            <label style={{ fontSize: '0.6875rem', color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>Trusted <Toggle on={m.trusted} onChange={x => set({ agent: { mcp: list.map(y => (y.id === m.id ? { ...y, trusted: x } : y)) } })} /></label>
            <Toggle on={m.enabled} onChange={x => set({ agent: { mcp: list.map(y => (y.id === m.id ? { ...y, enabled: x } : y)) } })} />
            <button onClick={() => set({ agent: { mcp: list.filter(y => y.id !== m.id) } })} style={smallBtn}>Remove</button>
          </Row>
        )
      })}
      <Row title="Add a connector" hint="A name, and the command that starts the server.">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Files" style={{ ...textField, width: '6rem' }} spellCheck={false} />
        <input value={cmd} onChange={e => setCmd(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="npx -y @modelcontextprotocol/server-…" style={textField} spellCheck={false} />
        <button onClick={add} disabled={!name.trim() || !cmd.trim()} style={{ ...smallBtn, opacity: name.trim() && cmd.trim() ? 1 : 0.4 }}>Add</button>
      </Row>
    </Group>
  )
}

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
        <Row title="Answer after I let go" hint="Recommended: the assistant waits for you to release the key. Turn off only if answers never arrive."><Toggle on={v.holdToAnswer} onChange={x => set({ voice: { holdToAnswer: x } })} /></Row>
        <Row title="Pause listening while it speaks" hint="Conversation mode: stops the speakers feeding back into the microphone. Turn off with headphones to interrupt by voice."><Toggle on={v.halfDuplex} onChange={x => set({ voice: { halfDuplex: x } })} /></Row>
        <Row title="Reply language" hint="Auto follows you: Tamil, English or a mix (Tanglish) in, the same style out.">
          <Select value={v.language} options={[{ v: 'auto', l: 'Match me' }, { v: 'ta', l: 'Always Tamil' }, { v: 'en', l: 'Always English' }]} onChange={x => set({ voice: { language: x } })} />
        </Row>
        <Row title="Dictation writing" hint="How speech is typed when you mix Tamil and English.">
          <Select value={v.dictationScript} options={[{ v: 'mixed', l: 'Tamil letters + English' }, { v: 'roman', l: 'Tanglish (English letters)' }, { v: 'english', l: 'Translate to English' }]} onChange={x => set({ voice: { dictationScript: x } })} />
        </Row>
        <Row title="Dictation model" hint="Plain Gemini model that listens to the recording."><input value={v.cleanupModel} onChange={e => set({ voice: { cleanupModel: e.target.value.trim() } })} style={textField} spellCheck={false} /></Row>
      </Group>
      <Group>
        <Row title="Ask before acting" hint="Risky = typing for you, closing windows, unknown links, power, unknown tools. Always = every action.">
          <Select value={s.agent.confirmMode} options={[{ v: 'risky', l: 'Only risky actions' }, { v: 'always', l: 'Every action' }, { v: 'full', l: 'Full control (never ask)' }]} onChange={x => set({ agent: { confirmMode: x } })} />
        </Row>
        <Row title="See what is on screen" hint="Lets me look at the app in front, the clipboard and your selection when you say “this”."><Toggle on={s.agent.context} onChange={x => set({ agent: { context: x } })} /></Row>
      </Group>
      {!isPhone && <WakeSettings s={s} set={set} />}
      {!isPhone && <Connectors s={s} set={set} />}
      <Group>
        <Row title="Dictation" hint="Hold the key anywhere, talk, let go: the cleaned-up sentence is typed into the focused field."><Toggle on={v.dictation} onChange={x => set({ voice: { dictation: x } })} /></Row>
        <Row desktop title="Circle to ask" hint="Tap the shortcut, draw around anything on screen with the mouse, then ask about it out loud."><Toggle on={v.lasso} onChange={x => set({ voice: { lasso: x } })} /></Row>
      </Group>
      <Group>
        <Row title="Conversation memory" hint="The last exchanges are kept so follow-ups work, even after a reconnect."><button onClick={() => void bridge.voice.clearConversation()} style={smallBtn}>Clear</button></Row>
        <Row title="Try it by typing" hint="Same as speaking, without the microphone.">
          <input value={ask} onChange={e => setAsk(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && ask.trim()) { bridge.voice.say(ask); setAsk('') } }} placeholder="Open Netflix in 10 minutes" style={textField} spellCheck={false} />
          <button onClick={() => { if (ask.trim()) { bridge.voice.say(ask); setAsk('') } }} style={smallBtn}>Send</button>
        </Row>
      </Group>
    </>
  )
}

const MOVE_PRESETS = [{ v: 'Win+Shift', l: 'Win + Shift' }, { v: 'Ctrl+Alt+Shift', l: 'Ctrl + Alt + Shift' }, { v: 'Ctrl+Win+Shift', l: 'Ctrl + Win + Shift' }]
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
  const sig = JSON.stringify([s.island.hotkey, s.island.tabHotkeys, s.voice.pushToTalk, s.voice.dictationKey, s.voice.lassoKey, s.voice.conversationKey, s.island.moveKey, s.island.lyricsKey, s.voice.enabled, s.voice.dictation, s.voice.lasso])
  useEffect(() => {
    const t = setTimeout(() => { void bridge.hotkeyStatus().then(setStatus) }, 700) // main re-registers after a change
    return () => clearTimeout(t)
  }, [sig])
  const all = [s.island.hotkey, s.voice.pushToTalk, s.voice.dictationKey, s.voice.lassoKey, s.voice.conversationKey, s.island.moveKey, s.island.lyricsKey, ...Object.values(s.island.tabHotkeys)].filter(Boolean).map(x => x.toLowerCase())
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
        <ShortcutRow title="Move the island" hint="Hold, move the pointer to any edge or corner, let go." value={s.island.moveKey} onChange={v => set({ island: { moveKey: v } })} status={status.move} clash={clash(s.island.moveKey)} presets={MOVE_PRESETS} clearable />
        <ShortcutRow title="Lyrics window" hint="Opens or closes the lyrics pop-up." value={s.island.lyricsKey} onChange={v => set({ island: { lyricsKey: v } })} status={status.lyrics} clash={clash(s.island.lyricsKey)} clearable />
        <ShortcutRow title="Conversation mode" hint="Press to start talking hands-free; say “bye” to end." value={s.voice.conversationKey} onChange={v => set({ voice: { conversationKey: v } })} status={s.voice.enabled ? status.conversation : undefined} clash={clash(s.voice.conversationKey)} clearable />
        <ShortcutRow title="Circle to ask" hint="Tap, draw around something with the mouse, then speak. Holding the keys works too." value={s.voice.lassoKey} onChange={v => set({ voice: { lassoKey: v } })} status={s.voice.lasso ? status.lasso : undefined} clash={clash(s.voice.lassoKey)} presets={HOLD_PRESETS} />
      </Group>
      <Group>
        <Row title="Reset shortcuts" hint="Back to the defaults.">
          <button style={smallBtn} onClick={() => set({
            island: { hotkey: 'Ctrl+Alt+Space', tabHotkeys: { controls: '', today: '', stats: '', clipboard: 'Ctrl+Alt+C', apps: 'Ctrl+Alt+A', wallpaper: '', power: '' } },
            voice: { pushToTalk: 'Ctrl+Alt+V', dictationKey: 'Ctrl+Win', lassoKey: 'Ctrl+Alt+L' },
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
      <Row title="Theme"><Select value={s.appearance.theme} options={[{ v: 'dark', l: 'Dark' }, { v: 'light', l: 'Light' }, { v: 'auto', l: isPhone ? 'Follow system' : 'Follow Windows' }]} onChange={v => set({ appearance: { theme: v } })} /></Row>
      <Row title="Accent colour" hint="Follow the wallpaper, or pick a fixed colour.">
        <Select value={custom ? 'custom' : 'wallpaper'} options={[{ v: 'wallpaper', l: 'From wallpaper' }, { v: 'custom', l: 'Custom' }]} onChange={v => set({ appearance: { accent: v === 'wallpaper' ? 'wallpaper' : FALLBACK_ACCENT } })} />
        {custom && <input type="color" value={s.appearance.accent} onChange={e => set({ appearance: { accent: e.target.value } })} style={{ width: '2rem', height: '2rem', background: 'none', border: 0 }} />}
      </Row>
      <Row title={isPhone ? 'Text size' : 'UI scale'} hint={isPhone ? 'Scales the text in settings and pages. The system font size applies on top.' : 'Resizes the island and its content. Restart for the overlay window to resize.'}><NumberSlider value={s.appearance.scale} min={0.75} max={1.5} step={0.05} onChange={v => set({ appearance: { scale: v } })} format={v => `${Math.round(v * 100)}%`} /></Row>
      <Row title="Animation speed"><NumberSlider value={s.appearance.animSpeed} min={0.5} max={2} step={0.1} onChange={v => set({ appearance: { animSpeed: v } })} format={v => `${v.toFixed(1)}×`} /></Row>
      <Row title="Reduce motion" hint="Turns animations off."><Toggle on={s.appearance.reduceMotion} onChange={v => set({ appearance: { reduceMotion: v } })} /></Row>
      <Row desktop title="Preview screen glow" hint="The edge glow shown while the assistant thinks or speaks.">
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
  if (isPhone) return (
    <div style={{ color: 'var(--muted)', fontSize: '0.8125rem', lineHeight: 1.6 }}>
      <p style={{ margin: 0 }}><b style={{ color: 'var(--text)' }}>lokey</b> — a voice-first island for your phone.</p>
      <p>Open source (GPL-3.0). The same assistant, memory and island as on the PC; pair them to share memory and work.</p>
    </div>
  )
  return (
    <div style={{ color: 'var(--muted)', fontSize: '0.8125rem', lineHeight: 1.6, maxWidth: '30rem' }}>
      <p style={{ margin: 0 }}><b style={{ color: 'var(--text)' }}>lokey</b> — a voice-first island for Windows.</p>
      <p>Open source (GPL-3.0). A Dynamic-Island-style launcher and voice assistant for the Windows desktop.</p>
      <p style={{ color: 'var(--dim)' }}>Settings file: %LocalAppData%\Lokey\settings.json</p>
    </div>
  )
}
