import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Square } from 'lucide-react'
import type { AgentTask } from '@shared/voice'
import { bridge } from '@/bridge'
import { Group, Row } from '@/settings/SettingsApp'
import { native, onNativeName } from './native'

// Settings > You > Power tier (Shizuku): what the second screen needs, in three steps, and a test that runs it once and says plainly what happened.
// Plugin: shizuku.status / request / openGuide and bg.* (app/mobile/android/PLUGIN.md). Docs: docs/SHIZUKU-TIER.md. Nothing here runs on its own:
// the status is read when the page opens, the test only on the button.
interface Status { installed?: boolean; running?: boolean; permissionGranted?: boolean; version?: number | null; uid?: number | null; canCreateDisplay?: boolean | null; reason?: string; sdk?: number; model?: string; probe?: { ime?: string; displayId?: number } }
type Line = { ok: boolean | null; text: string }
interface Result { pass: boolean; verdict: string; lines: Line[]; image?: string }

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const soft = { fontSize: '0.75rem', color: 'var(--muted)', lineHeight: 1.5 } as const

function Step({ n, done, title, hint, children }: { n: number; done: boolean; title: string; hint: string; children?: React.ReactNode }) {
  return (
    <Row title={`${n}. ${title}`} hint={hint}>
      {done ? <span style={{ color: 'var(--ok)', fontWeight: 600, fontSize: '0.8125rem' }}>Done</span> : <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{children}</span>}
    </Row>
  )
}

/** one run of the whole chain on a small display: start, open Settings, one picture, the UI tree, stop. Always ends the display. */
async function runTest(): Promise<Result> {
  const lines: Line[] = []
  const add = (ok: boolean | null, text: string) => lines.push({ ok, text })
  const t0 = performance.now()
  let image: string | undefined
  try {
    const s = await native('bg.start', { width: 540, height: 1200, dpi: 280 })
    if (!s || s.ok === false) { add(false, `Could not create a second screen: ${String(s?.reason ?? 'no answer')}`); return { pass: false, verdict: 'No second screen can be created.', lines } }
    add(true, `Second screen created (display ${String(s.displayId)}, ${String(s.width)}x${String(s.height)}, keyboard ${String(s.ime ?? 'default')}).`)
    const l = await native('bg.launch', { package: 'com.android.settings' })
    if (!l || l.ok === false) { add(false, `Settings did not open on it: ${String(l?.reason ?? 'no answer')}`); return { pass: false, verdict: 'The second screen exists, but this phone does not let an app open on it.', lines } }
    add(true, 'Settings was started on the second screen.')
    await wait(1800)
    const ui = await native('bg.ui', { maxNodes: 60 })
    const nodes = ui && ui.ok !== false ? Number(ui.count ?? 0) : 0
    const pkg = ui && ui.ok !== false ? String(ui.pkg ?? '') : ''
    add(nodes > 0, nodes > 0 ? `The screen reader sees ${nodes} items (${ui.source === 'uiautomator' ? 'through uiautomator' : 'through Lokey accessibility'}).` : `The screen reader sees nothing there${ui?.reason ? `: ${String(ui.reason)}` : ''}.`)
    if (pkg && pkg !== 'com.android.settings') add(false, `The front app there is ${pkg}, not Settings: it may have opened on the main screen instead.`)
    const f = await native('bg.frame', { quality: 70, maxWidth: 540 })
    if (!f || f.ok === false || !f.jpegBase64) { add(false, `No picture: ${String(f?.reason ?? 'no answer')}`); return { pass: false, verdict: 'The second screen produced no picture.', lines } }
    image = `data:image/jpeg;base64,${String(f.jpegBase64)}`
    add(!f.black, f.black ? 'The picture is black.' : `Got a picture (${String(f.w)}x${String(f.h)}).`)
    if (f.black) {
      return { pass: false, image, lines, verdict: nodes > 0 ? 'Apps run on the second screen, but their picture comes back black (a secure window). Tasks can still work from the UI list, but not from pictures.' : 'Black picture and nothing readable: this phone probably blocks apps on a second display, or Settings is a secure window here. See docs/SHIZUKU-TIER.md.' }
    }
    if (pkg && pkg !== 'com.android.settings') return { pass: false, image, lines, verdict: 'A picture came back, but Settings seems to have opened elsewhere.' }
    return { pass: true, image, lines, verdict: `It works: a second screen ran Settings in ${Math.round((performance.now() - t0) / 100) / 10} s.` }
  } catch (e) {
    add(false, e instanceof Error ? e.message : String(e))
    return { pass: false, verdict: 'The test failed.', lines, image }
  } finally { void native('bg.stop', {}) }
}

export function ShizukuSettings() {
  const [st, setSt] = useState<Status | null>(null)
  const [busy, setBusy] = useState<'' | 'status' | 'request' | 'test'>('')
  const [res, setRes] = useState<Result | null>(null)
  const [note, setNote] = useState('')
  const load = useCallback(async () => {
    setBusy(b => b || 'status')
    const r = await native('shizuku.status', { probe: true })
    setSt(r && typeof r === 'object' && r.ok !== false ? r : { reason: String(r?.reason ?? 'The phone did not answer. Is this the Android app with the power tier?') })
    setBusy(b => (b === 'status' ? '' : b))
  }, [])
  useEffect(() => {
    void load()
    const f = () => { if (document.visibilityState === 'visible') void load() } // back from the Shizuku app or developer options
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [load])

  const guide = (page: string) => void native('shizuku.openGuide', { page }).then(r => setNote(r?.ok === false ? String(r.reason ?? '') : ''))
  const allow = async () => { setBusy('request'); const r = await native('shizuku.request'); setNote(r?.ok === false ? String(r.reason ?? 'Not allowed') : ''); setBusy(''); void load() }
  const test = async () => { setBusy('test'); setRes(null); setRes(await runTest()); setBusy(''); void load() }
  const btn = (label: string, on: () => void, pri = false) => <button key={label} className={`ph-pill${pri ? ' pri' : ''}`} disabled={busy !== '' && busy !== 'status'} onClick={on}>{label}</button>
  const ready = !!st?.permissionGranted

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={soft}>Optional. Lets Lokey run a task in another app on a hidden second screen while you keep using the phone. It needs Shizuku (a free app that gives Lokey shell-level access, no root) and it must be started again after every reboot.</div>
      <Group>
        <Row title="Status" hint={st ? (st.reason ?? (st.canCreateDisplay === false ? 'Shizuku works, but a second screen could not be created.' : 'Ready.')) : 'Checking…'}>
          {busy === 'status' && !st ? <Loader2 size={16} className="ph-spin" /> : <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: st?.canCreateDisplay ? 'var(--ok)' : ready ? 'var(--warn)' : 'var(--muted)' }}>{st?.canCreateDisplay ? 'Ready' : ready ? 'Check' : 'Not set up'}</span>}
        </Row>
        {st && (st.installed !== undefined) && <Row title="Shizuku" hint={st.running ? `Running${st.version ? `, API ${st.version}` : ''}${st.uid === 0 ? ', as root' : st.uid === 2000 ? ', as adb shell' : ''}` : st.installed ? 'Installed, not running' : 'Not installed'}><span /></Row>}
      </Group>

      <Group>
        <Step n={1} done={!!st?.installed} title="Install Shizuku" hint="From shizuku.rikka.app or its GitHub releases (it is not on Play Store).">{btn('Get Shizuku', () => guide('get'), true)}</Step>
        <Step n={2} done={!!st?.running} title="Start it" hint="Developer options > turn on Wireless debugging. In Shizuku: Start via wireless debugging > Pairing, then Start. Needs Wi-Fi once; repeat after each reboot.">
          {btn('Open Shizuku', () => guide('app'), true)}{btn('Developer options', () => guide('dev'))}{btn('Guide', () => guide('web'))}
        </Step>
        <Step n={3} done={ready} title="Allow Lokey" hint="Shizuku asks once whether Lokey may use it.">{btn(busy === 'request' ? 'Asking…' : 'Allow', () => void allow(), true)}</Step>
      </Group>
      {note && <div role="status" style={{ ...soft, color: 'var(--warn)' }}>{note}</div>}

      <Group>
        <Row title="Test second screen" hint="Creates a small hidden screen, opens Settings on it, takes one picture and closes it. Nothing is shown on your main screen."><button className="ph-pill pri" disabled={!ready || busy === 'test'} onClick={() => void test()}>{busy === 'test' ? 'Testing…' : 'Test'}</button></Row>
      </Group>
      {res && (
        <div role="status" style={{ padding: '0.75rem 1rem', borderRadius: 20, background: 'var(--fill-2)', display: 'grid', gap: '0.5rem', fontSize: '0.8125rem', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 650, color: res.pass ? 'var(--ok)' : 'var(--warn)' }}>{res.pass ? 'Pass' : 'Fail'}: {res.verdict}</div>
          {res.lines.map((l, i) => <div key={i} style={{ color: l.ok === false ? 'var(--warn)' : 'var(--soft)' }}>{l.ok === false ? '✕ ' : '✓ '}{l.text}</div>)}
          {res.image && <img src={res.image} alt="What the second screen showed" style={{ maxHeight: 280, maxWidth: '100%', borderRadius: 14, justifySelf: 'center', background: '#000' }} />}
        </div>
      )}
      <div style={{ ...soft, paddingBottom: '1rem' }}>Tasks never open banking, payment, wallet, password or authenticator apps, never type passwords or codes, and ask you (with a picture) before they buy, pay, send, post or delete. A phone maker can block apps on virtual displays: the test tells you if yours does. Details: docs/SHIZUKU-TIER.md.</div>
    </div>
  )
}

/** Home: a live mini preview while a second-screen task runs (a picture about every half second at most, only while a task is running) */
export function BgPreviewCard() {
  const [job, setJob] = useState<AgentTask | null>(null)
  const [shot, setShot] = useState<{ src: string; black: boolean } | null>(null)
  const last = useRef(0)
  useEffect(() => {
    const pick = (l: AgentTask[]) => setJob(l.find(t => t.role === 'second_screen' && t.status === 'running') ?? null)
    void bridge.agents.list().then(pick).catch(() => undefined)
    const off = bridge.agents.onChange(pick)
    const offEv = onNativeName(['bg.frame', 'bg.state'], (name, d) => {
      if (name === 'bg.state' && d.active === false) { setShot(null); return }
      if (name === 'bg.frame' && typeof d.jpegBase64 === 'string' && performance.now() - last.current > 450) { last.current = performance.now(); setShot({ src: `data:image/jpeg;base64,${d.jpegBase64}`, black: d.black === true }) }
    })
    return () => { off(); offEv() }
  }, [])
  if (!job) return null
  return (
    <div style={{ flex: 'none', margin: '0 16px 8px', display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderRadius: 24, background: 'var(--fill-2)' }}>
      <div style={{ width: 62, height: 110, borderRadius: 12, overflow: 'hidden', background: '#000', flex: 'none', display: 'grid', placeItems: 'center' }}>
        {shot && !shot.black ? <img src={shot.src} alt="The second screen" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Loader2 size={16} className="ph-spin" color="var(--muted)" />}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Second screen</div>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shot?.black ? 'The app shows a black picture (secure window?)' : job.line || `step ${job.steps}`}</div>
      </div>
      <button aria-label="Stop the second-screen task" onClick={() => bridge.agents.stop(job.id)} style={{ width: 48, height: 48, borderRadius: 24, display: 'grid', placeItems: 'center', flex: 'none', background: 'var(--fill-1)' }}><Square size={16} fill="currentColor" /></button>
    </div>
  )
}
