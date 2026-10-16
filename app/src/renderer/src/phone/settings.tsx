import { useCallback, useEffect, useState } from 'react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { Toggle } from '@/ui'
import { Group, Row, Select, textField } from '@/settings/SettingsApp'
import { KIND_LABEL, OPTIONAL, type Kind } from './activities'
import { native } from './native'
import { OriginTips, PermissionList, resetOnboarding } from './Onboarding'

// The phone-only settings pages of You: Island, Permissions & Android access, Privacy, OriginOS tips, About.
// (Voice, Wake-up, Brain and Appearance are the shared SettingsApp sections, embedded.)
const set = (p: Parameters<typeof bridge.settings.set>[0]) => { void bridge.settings.set(p) }

type Status = Record<string, unknown> | null
const yes = (v: unknown) => v === true
/** island.status: what the system-wide island needs and whether it has it. Plugin answers { ok, overlayPermission, liveUpdatesPermission, cutout, sdk, ... } (older names accepted) */
function SystemIsland() {
  const s = useData(d => d.settings)
  const [st, setSt] = useState<Status>(null)
  const load = useCallback(() => { void native('island.status').then(r => setSt(r && typeof r === 'object' ? r : {})) }, [])
  useEffect(() => {
    load()
    const f = () => { if (document.visibilityState === 'visible') load() } // back from a system settings screen
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [load])
  const overlay = yes(st?.overlayPermission ?? st?.overlay), live = yes(st?.liveUpdatesPermission ?? st?.liveUpdates ?? st?.promoted)
  const row = (label: string, ok: boolean | null, text: string, perm?: string) => (
    <Row key={label} title={label} hint={text}>
      {ok === null ? null : ok ? <span style={{ color: 'var(--ok)', fontWeight: 600, fontSize: '0.8125rem' }}>On</span> : perm ? <button className="ph-pill pri" onClick={() => { void native('perm.request', { name: perm }); setTimeout(load, 1200) }}>Allow</button> : <span style={{ color: 'var(--warn)', fontSize: '0.8125rem' }}>No</span>}
    </Row>
  )
  return (
    <>
      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: '0.25rem 0.25rem 0.5rem' }}>System island</div>
      <Group>
        <Row title="Pill over other apps" hint="When Lokey is not in front, a black pill is drawn around the camera. Hidden while the app is open."><Toggle on={s.phone.systemIsland} onChange={v => set({ phone: { systemIsland: v } })} /></Row>
        <Row title="Live Updates" hint="Timers, music, approvals and jobs as Android 16 live notifications."><Toggle on={s.phone.liveUpdates} onChange={v => set({ phone: { liveUpdates: v } })} /></Row>
        <Row title="vivo Origin Island (experimental)" hint="Also post activities the way vivo's own apps do, so OriginOS may show them in its island."><Toggle on={s.phone.vivoIsland} onChange={v => set({ phone: { vivoIsland: v } })} /></Row>
      </Group>
      <Group>
        {row('Draw over other apps', st ? overlay : null, 'Needed for the pill.', 'overlay')}
        {row('Live Updates permission', st ? live : null, 'Promoted notifications.', 'live_updates')}
        {row('Camera cutout', st ? yes(st.cutout ?? st.cutoutFound) : null, st && !yes(st.cutout ?? st.cutoutFound) ? 'Not found: the pill sits at the top centre.' : 'Found: the pill wraps it.')}
        {row('Android', st ? true : null, st?.sdk ? `SDK ${String(st.sdk)}${Number(st.sdk) >= 36 ? ' (Android 16)' : ': Live Updates need Android 16'}` : 'Unknown')}
        {row('Keep running in the background', null, 'Battery: no restrictions, or Android stops the pill.')}
        <Row title="Battery" hint="Open the battery exemption."><button className="ph-pill" onClick={() => void native('perm.request', { name: 'battery' })}>Open</button></Row>
      </Group>
      <VivoTest st={st} />
      <BackgroundHealth />
      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.5, padding: '0 0.25rem 1rem' }}>OriginOS controls its own island: Lokey cannot add itself to it. It uses Android 16 Live Updates for the system card, and draws its own pill around the camera while another app is in front.</div>
    </>
  )
}

type Diag = Record<string, unknown>
const ageText = (ms: unknown) => (typeof ms === 'number' ? (ms < 60_000 ? `${Math.round(ms / 1000)} s ago` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min ago` : `${Math.round(ms / 3_600_000)} h ago`) : 'never')
const since = (t: unknown) => (typeof t === 'number' ? ageText(Date.now() - t) : 'never')

/** Settings > Island > Background health: what the native layer says about running outside the app, in plain words, refreshed every 3 s while visible */
function BackgroundHealth() {
  const [d, setD] = useState<Diag | null>(null)
  useEffect(() => {
    let live = true
    const load = () => { if (document.visibilityState === 'visible') void native('diag.status').then(r => { if (live) setD(r && typeof r === 'object' ? r : {}) }) }
    load()
    const t = setInterval(load, 3000)
    return () => { live = false; clearInterval(t) }
  }, [])
  type Level = 'ok' | 'warn' | 'bad' | 'off'
  const dot = (l: Level) => ({ ok: '#8fd16a', warn: '#f5a524', bad: '#ff7373', off: 'rgba(128,128,128,.5)' })[l]
  const R = (title: string, level: Level, text: string, fix?: { label: string; perm: string }) => (
    <Row key={title} title={title} hint={text}>
      <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: dot(level), flex: 'none' }} />
      {fix && level !== 'ok' && <button className="ph-pill" onClick={() => void native('perm.request', { name: fix.perm })}>{fix.label}</button>}
    </Row>
  )
  if (!d) return null
  const vivo = /vivo|iqoo/i.test(String(d.manufacturer ?? d.brand ?? ''))
  const hb = d.jsHeartbeatAgeMs
  return (
    <>
      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: '0.25rem 0.25rem 0.5rem' }}>Background health</div>
      <Group>
        {R('Background service', d.serviceRunning ? 'ok' : 'bad', d.serviceRunning ? `Running${d.serviceMic ? ', microphone allowed' : ''}.` : 'Not running. Open Lokey once to start it.')}
        {R('Island over other apps', d.overlayGranted === false ? 'bad' : d.overlayShown ? 'ok' : d.appForeground ? 'off' : 'warn', d.overlayGranted === false ? 'Needs “draw over other apps”.' : d.overlayShown ? 'Showing.' : `Not showing: ${String(d.overlayReason ?? (d.appForeground ? 'Lokey is in front' : 'unknown'))}.`, { label: 'Allow', perm: 'overlay' })}
        {R('The app page', typeof hb === 'number' ? (hb < 45_000 ? 'ok' : 'warn') : 'warn', typeof hb === 'number' ? `Last heartbeat ${ageText(hb)}.` : 'No heartbeat yet (normal when the app was closed).')}
        {R('Wake-up', !d.wakeEnabled ? 'off' : d.wakeError ? 'bad' : d.wakeListening ? 'ok' : 'warn', !d.wakeEnabled ? 'Off in settings.' : d.wakeError ? String(d.wakeError) : d.wakeListening ? `Listening. Last heard ${since(d.wakeLastEventAt)}${d.wakeLastDecision ? `: ${String(d.wakeLastDecision)}` : ''}.` : d.wakePaused ? 'Paused.' : 'Not listening right now.')}
        {R('Link to your PC', !d.linkPaired ? 'off' : d.linkConnected ? 'ok' : 'warn', !d.linkPaired ? 'Not paired.' : d.linkConnected ? `Connected. Last news ${since(d.linkLastEventAt)}.` : `Not connected. Last news ${since(d.linkLastEventAt)}.`)}
        {R('Battery', d.batteryExempt ? 'ok' : 'warn', d.batteryExempt ? 'Not restricted.' : 'Android may stop Lokey in the background. Set it to no restrictions.', { label: 'Fix', perm: 'battery' })}
        {vivo && R('Autostart (vivo)', 'warn', 'Allow Lokey to start by itself, and in background power settings choose no restrictions.', { label: 'Open', perm: 'autostart' })}
        <Row title="Notification access" hint="Needed for music, lyrics and the Inbox."><button className="ph-pill" onClick={() => void native('perm.request', { name: 'notification_listener' })}>Open</button></Row>
      </Group>
      <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', padding: '0 0.25rem 0.75rem' }}>Android {String(d.sdk ?? '?')} · {String(d.manufacturer ?? d.brand ?? 'unknown')}</div>
    </>
  )
}

const NOTE_KEY = 'lokey.vivoIsland.notes'
const loadNotes = (): string[] => { try { const v: unknown = JSON.parse(localStorage.getItem(NOTE_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : [] } catch { return [] } }
const yn = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : 'unknown')

/** vivo's own Origin Island route: probe it, say in plain words what happened, and remember what the user saw */
function VivoTest({ st }: { st: Status }) {
  const [res, setRes] = useState<{ kind: string; r: Record<string, unknown> } | null>(null)
  const [notes, setNotes] = useState(loadNotes)
  const [busy, setBusy] = useState(false)
  const sx = (st?.vivoSuperx ?? null) as Record<string, unknown> | null
  const probe = async (kind: 'subset' | 'full' | 'both') => { setBusy(true); const r = await native('island.vivoProbe', { kind: 'approval', route: kind }); setRes({ kind, r: r && typeof r === 'object' ? r : {} }); setBusy(false) }
  const set = (k: string, v: unknown) => { void native('island.setEnabled', { [k]: v }) }
  const route = String(sx?.route ?? 'subset'); const style = String(sx?.style ?? 'overlay')
  const answer = (saw: boolean) => {
    if (!res) return
    set('vivoShowed', saw)
    const note = `${new Date().toLocaleString()}: ${res.kind} probe, posted ${yn(res.r.posted)}, extras kept ${yn(res.r.extrasKept)}, promotable ${yn(res.r.canPromote)}, island appeared: ${saw ? 'yes' : 'no'}`
    const next = [note, ...notes].slice(0, 8)
    setNotes(next); try { localStorage.setItem(NOTE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
    setRes(null)
  }
  const r = res?.r
  return (
    <>
      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: '0.25rem 0.25rem 0.5rem' }}>vivo Origin Island</div>
      <Group>
        <Row title="vivo device" hint={sx ? `Scenes: ${Array.isArray(sx.scenes) ? (sx.scenes as unknown[]).join(', ') || 'none' : String(sx.scenes ?? 'unknown')}. Scene status: ${String(sx.sceneStatus ?? 'unknown')}.` : 'No answer from the plugin yet.'}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: sx?.vivoDevice ? 'var(--ok)' : 'var(--muted)' }}>{sx ? (sx.vivoDevice ? 'Yes' : 'No') : '—'}</span>
        </Row>
        <Row title="Test full island" hint="Posts the full vivo schema (route vivo-full)."><button className="ph-pill" disabled={busy} onClick={() => void probe('full')}>Test</button></Row>
        <Row title="Test documented subset" hint="Posts only vivo's publicly documented fields."><button className="ph-pill" disabled={busy} onClick={() => void probe('subset')}>Test</button></Row>
        <Row title="Test both" hint="Subset now, the full one about 22 s later."><button className="ph-pill" disabled={busy} onClick={() => void probe('both')}>Test</button></Row>
        <Row title="Send with" hint="Which route real activities use."><button className="ph-pill" onClick={() => set('vivoRoute', route === 'full' ? 'subset' : 'full')}>{route === 'full' ? 'Full schema' : 'Documented subset'}</button></Row>
        <Row title="Island style" hint="System hides Lokey's own pill only after you answer Yes below."><button className="ph-pill" onClick={() => set('vivoStyle', style === 'overlay' ? 'system' : style === 'system' ? 'both' : 'overlay')}>{style === 'system' ? 'System (vivo)' : style === 'both' ? 'Both' : 'Overlay pill'}</button></Row>
      </Group>
      {r && (
        <div role="status" style={{ padding: '0.75rem 1rem', borderRadius: 20, background: 'var(--fill-2)', fontSize: '0.8125rem', lineHeight: 1.5, marginBottom: '0.75rem', display: 'grid', gap: '0.5rem' }}>
          <div>{r.ok === false ? `Could not post: ${String(r.reason ?? 'unknown reason')}.` : `${r.posted === false ? 'Not posted.' : 'Posted.'} System kept vivo's data: ${yn(r.extrasKept)}. Promotable: ${yn(r.canPromote)}.${r.scene ? ` Scene: ${String(r.scene)}.` : ''}${r.template ? ` Template: ${String(r.template)}.` : ''} Look at the top of the screen now: did the system island appear?`}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}><button className="ph-pill pri" onClick={() => answer(true)}>Yes</button><button className="ph-pill" onClick={() => answer(false)}>No</button></div>
        </div>
      )}
      {notes.length > 0 && <div style={{ fontSize: '0.6875rem', color: 'var(--muted)', lineHeight: 1.5, padding: '0 0.25rem 0.5rem', display: 'grid', gap: 2 }}>{notes.map(n => <div key={n}>{n}</div>)}</div>}
      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.5, padding: '0 0.25rem 1rem' }}>vivo only shows third-party apps that vivo approved; see docs/VIVO-ISLAND.md. If the test posts but nothing appears, that is expected until Lokey is approved.</div>
    </>
  )
}

export function IslandSettings() {
  const s = useData(d => d.settings)
  const on = s.phone.activities
  const toggle = (k: Kind, v: boolean) => set({ phone: { activities: v ? [...on, k] : on.filter(x => x !== k) } })
  return (
    <>
      <Group>
        <Row title="Island" hint="The black capsule over the camera."><Toggle on={s.island.enabled} onChange={v => set({ island: { enabled: v } })} /></Row>
        <Row title="Haptics" hint="A short buzz for taps, swipes, hold-to-talk and approvals."><Toggle on={s.phone.haptics} onChange={v => set({ phone: { haptics: v } })} /></Row>
        <Row title="Spirit animations" hint="Full: every pose, emote and idle fidget at up to 60 fps. Calm: fewer fidgets, 30 fps, easier on the battery.">
          <Select value={s.phone.spirit} options={[{ v: 'full', l: 'Full' }, { v: 'calm', l: 'Calm' }]} onChange={v => set({ phone: { spirit: v } })} />
        </Row>
      </Group>
      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', margin: '0.25rem 0.25rem 0.5rem' }}>Show on the island (approvals always show)</div>
      <Group>
        {OPTIONAL.map(k => <Row key={k} title={KIND_LABEL[k]}><Toggle on={on.includes(k)} onChange={v => toggle(k, v)} label={KIND_LABEL[k]} /></Row>)}
      </Group>
      <SystemIsland />
    </>
  )
}

const LINKS: { name: string; title: string; sub: string }[] = [
  { name: 'notifications', title: 'Notification settings', sub: 'Let Lokey post cards and reminders' },
  { name: 'overlay', title: 'Floating windows', sub: 'Draw the island over other apps' },
  { name: 'accessibility', title: 'Accessibility service', sub: 'Tap, type and read the screen for you' },
  { name: 'notification_listener', title: 'Notification access', sub: 'Inbox, music and lyrics' },
  { name: 'battery', title: 'Battery', sub: 'Background power consumption: no restrictions' },
  { name: 'app-info', title: 'App info', sub: 'Autostart, permissions, "allow restricted settings"' },
]

export function AccessSettings() {
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <PermissionList />
      <div>
        <div style={{ fontSize: '0.8125rem', fontWeight: 650, margin: '0 0.25rem 0.5rem' }}>Open Android settings</div>
        <Group>
          {LINKS.map(l => (
            <button key={l.name} onClick={() => void native('perm.request', { name: l.name })} className="lk-set-row" style={{ display: 'flex', width: '100%', textAlign: 'left', gap: '1rem', padding: '0.75rem 1rem', borderTop: '1px solid var(--line)' }}>
              <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: 'block', fontSize: '0.875rem' }}>{l.title}</b><span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{l.sub}</span></span>
              <span style={{ color: 'var(--muted)' }}>›</span>
            </button>
          ))}
        </Group>
      </div>
    </div>
  )
}

export function PrivacySettings() {
  const s = useData(d => d.settings)
  return (
    <>
      <Group>
        <Row title="Learn from our conversations" hint="Builds your memory (Bond). Passwords and codes are never kept."><Toggle on={s.brain.learn} onChange={v => set({ brain: { learn: v } })} /></Row>
        <Row title="Look at the app in front" hint="Lets me use what is on screen when you say this."><Toggle on={s.agent.context} onChange={v => set({ agent: { context: v } })} /></Row>
        <Row title="Ask before acting" hint="Risky: sending messages, calls, unknown links. Always: every action.">
          <Select value={s.agent.confirmMode} options={[{ v: 'risky', l: 'Only risky actions' }, { v: 'always', l: 'Every action' }, { v: 'full', l: 'Full control (never ask)' }]} onChange={v => set({ agent: { confirmMode: v } })} />
        </Row>
        <Row title="Never learn from these apps" hint="Comma separated, part of the app name."><input value={s.brain.excludeApps.join(', ')} onChange={e => set({ brain: { excludeApps: e.target.value.split(',').map(x => x.trim()).filter(Boolean) } })} style={textField} spellCheck={false} /></Row>
      </Group>
      <Group>
        <Row title="Forget the recent conversation" hint="The saved memory stays."><button className="ph-pill" onClick={() => void bridge.voice.clearConversation()}>Clear</button></Row>
      </Group>
      <div style={{ fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.5, padding: '0 0.25rem' }}>Everything stays on this phone, except what you say to Gemini and what you send to a paired PC. Keys live in the Android Keystore.</div>
    </>
  )
}

export function TipsPage() {
  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <OriginTips />
      <button className="ob-btn" onClick={() => { resetOnboarding(); location.href = location.pathname + '?onboard=1' }}>Run setup again</button>
    </div>
  )
}

export function AboutPage() {
  return (
    <div style={{ color: 'var(--muted)', fontSize: '0.8125rem', lineHeight: 1.6, padding: '0 0.25rem' }}>
      <p style={{ margin: 0 }}><b style={{ color: 'var(--text)' }}>lokey</b> — a voice-first spirit for your phone.</p>
      <p>Open source (GPL-3.0). The same assistant, memory and spirit as on the PC; pair them to share memory and work.</p>
    </div>
  )
}
