import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Check, ClipboardPaste, ExternalLink, KeyRound, Link2, ShieldCheck } from 'lucide-react'
import { bridge } from '@/bridge'
import { dur } from '@/lib/motion'
import { haptic } from '@/lib/platform'
import { useData } from '@/lib/data'
import { Spirit } from './spirit'

export const ONBOARD_KEY = 'lokey.phone.onboarded'
export const hasOnboarded = () => { try { return localStorage.getItem(ONBOARD_KEY) === '1' } catch { return false } }
const markOnboarded = () => { try { localStorage.setItem(ONBOARD_KEY, '1') } catch { /* private mode */ } }
export const resetOnboarding = () => { try { localStorage.removeItem(ONBOARD_KEY) } catch { /* private mode */ } }

// ---- permissions -------------------------------------------------------------------------------------------
// The native plugin answers perm.status {} -> { <name>: boolean | { granted } } (or { granted } for { name }) and perm.request { name }.
// Methods the build does not have yet answer {} in the mock, which reads as "not granted".
type Any = (m: string, p: unknown) => Promise<unknown>
const call: Any = (m, p) => (bridge.call as unknown as Any)(m, p)

export const PERMS: { name: string; title: string; why: string }[] = [
  { name: 'microphone', title: 'Microphone', why: 'So I can hear you: hold to talk, conversation mode.' },
  { name: 'notifications', title: 'Notifications', why: 'Reminders, finished jobs, the always-there card.' },
  { name: 'overlay', title: 'Floating window', why: 'Show the island on top of other apps.' },
  { name: 'live_updates', title: 'Live updates', why: 'Timers, music and approvals as Android 16 live notifications.' },
  { name: 'accessibility', title: 'Accessibility service', why: 'Tap, type and read the screen for you; dictation into any app.' },
  { name: 'notification_listener', title: 'Notification access', why: 'See what music is playing (lyrics) and read notifications you ask about.' },
  { name: 'battery', title: 'Battery: no restrictions', why: 'Keeps the wake word and reminders alive in the background.' },
]

const pick = (r: unknown, name: string): boolean | undefined => {
  const o = r as Record<string, unknown> | null | undefined
  const v = o?.[name] ?? (o?.perms as Record<string, unknown> | undefined)?.[name] ?? (o?.granted as Record<string, unknown> | undefined)?.[name]
  if (typeof v === 'boolean') return v
  if (v && typeof v === 'object' && typeof (v as { granted?: unknown }).granted === 'boolean') return (v as { granted: boolean }).granted
  return undefined
}

export function usePerms() {
  const [state, setState] = useState<Record<string, boolean>>({})
  const refresh = useCallback(async () => {
    const all = await call('perm.status', {}).catch(() => ({}))
    const next: Record<string, boolean> = {}
    for (const p of PERMS) {
      let v = pick(all, p.name)
      if (v === undefined) { const one = await call('perm.status', { name: p.name }).catch(() => ({})); v = pick(one, p.name) ?? (one as { granted?: boolean }).granted }
      next[p.name] = !!v
    }
    setState(next)
  }, [])
  useEffect(() => {
    void refresh()
    const f = () => { if (document.visibilityState === 'visible') void refresh() } // back from a system settings screen
    document.addEventListener('visibilitychange', f)
    window.addEventListener('focus', f)
    return () => { document.removeEventListener('visibilitychange', f); window.removeEventListener('focus', f) }
  }, [refresh])
  const request = async (name: string) => { await call('perm.request', { name }).catch(() => undefined); setTimeout(() => void refresh(), 500) }
  return { state, request, refresh }
}

export function PermissionList() {
  const { state, request } = usePerms()
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {PERMS.map(p => {
        const on = state[p.name]
        return (
          <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 64, padding: '8px 8px 8px 14px', borderRadius: 18, background: 'var(--fill-1)' }}>
            <span style={{ width: 28, height: 28, borderRadius: 14, flex: 'none', display: 'grid', placeItems: 'center', background: on ? 'var(--accent)' : 'var(--fill-3)', color: on ? 'var(--accent-ink)' : 'var(--muted)' }}>{on ? <Check size={16} strokeWidth={3} /> : <ShieldCheck size={15} />}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{p.title}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', lineHeight: 1.35, marginTop: 1 }}>{p.why}</span>
            </span>
            <button disabled={on} onClick={() => { haptic(); void request(p.name) }} style={{ minWidth: 76, minHeight: 44, borderRadius: 22, fontSize: 14, fontWeight: 600, background: on ? 'transparent' : 'var(--accent)', color: on ? 'var(--muted)' : 'var(--accent-ink)' }}>{on ? 'On' : 'Allow'}</button>
          </div>
        )
      })}
    </div>
  )
}

const OUTSIDE: { perm: string; title: string; why: string }[] = [
  { perm: 'overlay', title: 'Draw over other apps', why: 'The black pill at the camera, on top of any app.' },
  { perm: 'battery', title: 'Battery: no restrictions', why: 'Keeps wake-up and the PC link alive in the background.' },
  { perm: 'autostart', title: 'Autostart', why: 'Lets Lokey start by itself after a restart (vivo and iQOO: also set background power to no restrictions).' },
  { perm: 'notification_listener', title: 'Notification access', why: 'Music on the island, lyrics and your Inbox.' },
]
function Outside() {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {OUTSIDE.map((o, i) => (
        <div key={o.perm} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 64, padding: '8px 8px 8px 14px', borderRadius: 24, background: 'var(--fill-1)' }}>
          <span style={{ width: 26, height: 26, borderRadius: 13, flex: 'none', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: 'var(--accent)', color: 'var(--accent-ink)' }}>{i + 1}</span>
          <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{o.title}</span><span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', lineHeight: 1.35, marginTop: 1 }}>{o.why}</span></span>
          <button onClick={() => { haptic(); void call('perm.request', { name: o.perm }) }} style={{ minWidth: 76, minHeight: 44, borderRadius: 22, fontSize: 14, fontWeight: 600, background: 'var(--accent)', color: 'var(--accent-ink)' }}>Open</button>
        </div>
      ))}
    </div>
  )
}

export function OriginTips() {
  const tip = (n: number, title: string, body: string) => (
    <div key={n} style={{ display: 'flex', gap: 12 }}>
      <span style={{ width: 24, height: 24, borderRadius: 12, flex: 'none', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: 'var(--accent)', color: 'var(--accent-ink)', marginTop: 1 }}>{n}</span>
      <span style={{ fontSize: 14, lineHeight: 1.45 }}><b>{title}</b><br /><span style={{ color: 'var(--muted)' }}>{body}</span></span>
    </div>
  )
  return (
    <div style={{ display: 'grid', gap: 14, padding: 16, borderRadius: 20, background: 'var(--fill-1)' }}>
      <div style={{ fontSize: 15, fontWeight: 650 }}>Keep me alive on OriginOS</div>
      {tip(1, 'Battery: no restrictions', 'Settings → Battery → Background power consumption → Lokey → No restrictions.')}
      {tip(2, 'Allow autostart', 'Settings → Apps → Autostart → turn Lokey on.')}
      {tip(3, 'Lock me in Recents', 'Open Recents, pull the Lokey card down (or tap its lock) so the cleaner leaves it alone.')}
      {tip(4, 'Notifications and floating windows', 'Settings → Notifications & status bar → Lokey: allow. Apps → Lokey → Permissions → Floating windows / Display over other apps: allow.')}
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Menu names move a little between OriginOS versions; search Settings for “autostart” or “background power”.</div>
    </div>
  )
}

/** pair this phone with a PC running Lokey (bridge.link.pair / connect when the build has it); resolves to a message for the user */
export async function pairWith(address: string, code: string): Promise<string> {
  const link = bridge.link as unknown as Record<string, ((a: { address: string; code: string }) => Promise<unknown>) | undefined>
  const fn = link.pair ?? link.connect
  if (!fn) return 'Pairing is not in this build yet. You can do it later in Settings → Phone.'
  try { await fn.call(bridge.link, { address: address.trim(), code: code.trim() }); return 'Paired.' } catch (e) { return e instanceof Error && e.message ? e.message : 'Could not pair. Check the address and code.' }
}

/** address + code form (onboarding step and Settings → Phone) */
export function PairForm() {
  const [addr, setAddr] = useState('')
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <input value={addr} onChange={e => setAddr(e.target.value)} placeholder="192.168.1.20:47831" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="PC address" style={field} />
      <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="6-digit code" inputMode="numeric" autoComplete="off" aria-label="Pairing code" style={{ ...field, letterSpacing: '.3em', textAlign: 'center', fontSize: 22 }} />
      <button className="ob-btn" disabled={busy || addr.trim().length < 7 || code.trim().length < 4} onClick={() => { setBusy(true); void pairWith(addr, code).then(m => { setMsg(m); setBusy(false) }) }}>Pair</button>
      {msg && <div role="status" style={{ fontSize: 13, color: msg === 'Paired.' ? 'var(--ok)' : 'var(--muted)', lineHeight: 1.4 }}>{msg}</div>}
    </div>
  )
}

// ---- the flow ----------------------------------------------------------------------------------------------
type Step = 'welcome' | 'key' | 'language' | 'perms' | 'outside' | 'pair' | 'tips'
const STEPS: Step[] = ['welcome', 'key', 'language', 'perms', 'outside', 'pair', 'tips']
export const field: CSSProperties = { width: '100%', boxSizing: 'border-box', height: 52, padding: '0 16px', borderRadius: 16, background: 'var(--fill-2)', border: '1px solid transparent', color: 'var(--text)', font: 'inherit', fontSize: 16, outline: 'none', userSelect: 'text' }

const LANGS = [
  { id: 'en', title: 'English', sub: 'Answers in English; dictation is translated to English.', voice: { language: 'en', dictationScript: 'english' } },
  { id: 'ta', title: 'தமிழ் (Tamil)', sub: 'Answers in Tamil; dictation in Tamil letters, English words kept.', voice: { language: 'ta', dictationScript: 'mixed' } },
  { id: 'tanglish', title: 'Tanglish', sub: 'Tamil in English letters, the way you text.', voice: { language: 'ta', dictationScript: 'roman' } },
] as const

function Frame({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: dur(0.22), ease: [0.33, 1, 0.68, 1] }} style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
      <div><h1 style={{ margin: 0, fontSize: 26, fontWeight: 650, lineHeight: 1.2 }}>{title}</h1>{sub && <div style={{ marginTop: 8, fontSize: 15, color: 'var(--muted)', lineHeight: 1.5 }}>{sub}</div>}</div>
      {children}
    </motion.div>
  )
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0)
  const step = STEPS[i]
  const lang = useData(s => s.settings.voice.language)
  const script = useData(s => s.settings.voice.dictationScript)
  const [hasKey, setHasKey] = useState(false)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  const [addr, setAddr] = useState('')
  const [code, setCode] = useState('')
  const [pairMsg, setPairMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void bridge.voice.info().then(v => setHasKey(v.hasKey)).catch(() => undefined) }, [])

  const next = () => { haptic(); if (i < STEPS.length - 1) setI(i + 1); else { markOnboarded(); onDone() } }
  const back = () => setI(Math.max(0, i - 1))
  const langId = lang === 'en' ? 'en' : script === 'roman' ? 'tanglish' : lang === 'ta' ? 'ta' : 'en'

  const saveKey = async () => {
    setBusy(true)
    const ok = await bridge.voice.setKey(key.trim()).catch(() => false)
    setBusy(false)
    if (ok) { setHasKey(true); setKey(''); setMsg('Saved on this phone.'); setTimeout(next, 500) } else setMsg('That does not look like an AI Studio key (it starts with AIza).')
  }
  const paste = async () => { try { setKey((await navigator.clipboard.readText()).trim()) } catch { setMsg('Paste is blocked here: long-press the box and choose Paste.') } }

  const pair = async () => {
    setBusy(true)
    setPairMsg(await pairWith(addr, code))
    setBusy(false)
  }

  const primary = step === 'welcome' ? 'Get started' : step === 'key' ? (hasKey ? 'Continue' : 'Save key') : step === 'pair' ? 'Pair' : step === 'tips' ? 'Finish' : 'Continue'
  const onPrimary = step === 'key' && !hasKey ? () => void saveKey() : step === 'pair' ? () => void pair() : next
  const disabled = busy || (step === 'key' && !hasKey && key.trim().length < 20) || (step === 'pair' && (addr.trim().length < 7 || code.trim().length < 4))
  const optional = step === 'key' || step === 'perms' || step === 'outside' || step === 'pair'

  return (
    <div role="dialog" aria-label="Set up Lokey" style={{ position: 'absolute', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column', background: 'var(--bg)', paddingTop: 'var(--sat)' }}>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', height: 56, padding: '0 8px' }}>
        <button aria-label="Back" onClick={back} disabled={i === 0} style={{ width: 48, height: 48, display: 'grid', placeItems: 'center', opacity: i === 0 ? 0 : 1 }}><ArrowLeft size={22} /></button>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 6 }}>{STEPS.map((s, n) => <span key={s} style={{ width: n === i ? 22 : 7, height: 7, borderRadius: 4, background: n <= i ? 'var(--accent)' : 'var(--fill-4)', transition: 'width .2s, background-color .2s' }} />)}</div>
        <button onClick={next} style={{ minWidth: 56, height: 48, padding: '0 10px', fontSize: 14, color: 'var(--muted)', visibility: optional ? 'visible' : 'hidden' }}>Skip</button>
      </div>

      <div className="scroll-y" style={{ flex: 1, minHeight: 0, padding: '8px 20px 16px', touchAction: 'pan-y' }}>
        <AnimatePresence mode="wait" initial={false}>
          {step === 'welcome' && (
            <Frame key="welcome" title="Meet your spirit" sub="Lokey lives at the top of your screen. Talk to it, ask it for things, and it gets better the more you use it.">
              <div style={{ display: 'grid', placeItems: 'center', height: 230 }}><Spirit size={220} poke emotes /></div>
              <div style={{ display: 'grid', gap: 6, fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
                <span>Tap the island to open it, swipe down to peek.</span><span>Long-press to talk, double-tap for conversation mode.</span>
              </div>
            </Frame>
          )}
          {step === 'key' && (
            <Frame key="key" title="Add your Gemini key" sub="The voice runs on Google’s Gemini. A free key takes a minute, and it never leaves this phone except to talk to Google.">
              <button onClick={() => bridge.app.openExternal('https://aistudio.google.com/apikey')} style={{ minHeight: 52, borderRadius: 16, background: 'var(--fill-2)', fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--accent)' }}><ExternalLink size={16} />Get a free key (aistudio.google.com/apikey)</button>
              {hasKey ? <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, color: 'var(--ok)' }}><Check size={18} />A key is already saved.</div> : (
                <>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ position: 'relative', flex: 1 }}><KeyRound size={16} color="var(--muted)" style={{ position: 'absolute', left: 14, top: 18 }} /><input value={key} onChange={e => setKey(e.target.value)} placeholder="AIza…" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="Gemini API key" style={{ ...field, paddingLeft: 40 }} /></div>
                    <button aria-label="Paste" onClick={() => void paste()} style={{ width: 52, height: 52, borderRadius: 16, background: 'var(--fill-2)', display: 'grid', placeItems: 'center', flex: 'none' }}><ClipboardPaste size={20} /></button>
                  </div>
                  {msg && <div role="status" style={{ fontSize: 13, color: msg.startsWith('Saved') ? 'var(--ok)' : 'var(--warn)' }}>{msg}</div>}
                </>
              )}
            </Frame>
          )}
          {step === 'language' && (
            <Frame key="language" title="How do you talk?" sub="Pick how I answer and how dictation writes. You can change it any time in Settings → Voice.">
              <div style={{ display: 'grid', gap: 10 }}>
                {LANGS.map(l => {
                  const on = l.id === langId
                  return (
                    <button key={l.id} aria-pressed={on} onClick={() => { haptic(); void bridge.settings.set({ voice: l.voice }) }} style={{ textAlign: 'left', minHeight: 72, padding: '12px 16px', borderRadius: 20, background: on ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'var(--fill-1)', boxShadow: on ? 'inset 0 0 0 2px var(--accent)' : 'none' }}>
                      <span style={{ display: 'block', fontSize: 17, fontWeight: 650 }}>{l.title}</span><span style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginTop: 3, lineHeight: 1.35 }}>{l.sub}</span>
                    </button>
                  )
                })}
              </div>
            </Frame>
          )}
          {step === 'perms' && <Frame key="perms" title="Let me work" sub="Each one opens an Android screen; come back here when you are done. Only the microphone is needed to talk."><PermissionList /></Frame>}
          {step === 'outside' && <Frame key="outside" title="Works outside the app" sub="The island, wake-up and your PC link keep running when Lokey is closed, if Android lets them. Four switches decide that."><Outside /></Frame>}
          {step === 'pair' && (
            <Frame key="pair" title="Pair with my PC" sub="Optional. On the PC open Lokey → Settings → Devices → Pair a phone, then type what it shows. Needs the same Wi-Fi.">
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ position: 'relative' }}><Link2 size={16} color="var(--muted)" style={{ position: 'absolute', left: 14, top: 18 }} /><input value={addr} onChange={e => setAddr(e.target.value)} placeholder="192.168.1.20:47831" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="PC address" style={{ ...field, paddingLeft: 40 }} /></div>
                <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="6-digit code" inputMode="numeric" autoComplete="off" aria-label="Pairing code" style={{ ...field, letterSpacing: '.3em', textAlign: 'center', fontSize: 22 }} />
                {pairMsg && <div role="status" style={{ fontSize: 13, color: pairMsg === 'Paired.' ? 'var(--ok)' : 'var(--muted)', lineHeight: 1.4 }}>{pairMsg}</div>}
              </div>
            </Frame>
          )}
          {step === 'tips' && <Frame key="tips" title="One last thing" sub="Phones stop background apps aggressively. Four switches keep Lokey listening."><OriginTips /></Frame>}
        </AnimatePresence>
      </div>

      <div style={{ flex: 'none', padding: '8px 20px calc(var(--sab) + 16px)', display: 'grid' }}>
        <button className="ob-btn pri" onClick={onPrimary} disabled={disabled}>{primary}</button>
      </div>
    </div>
  )
}
