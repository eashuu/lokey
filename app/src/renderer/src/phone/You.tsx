import { useEffect, useState, type ReactNode } from 'react'
import { BrainCircuit, Info, KeyRound, LayoutPanelTop, Link2, Mic, Palette, ShieldCheck, Smartphone, Sparkles, Waves, Zap } from 'lucide-react'
import { bridge } from '@/bridge'
import { BrainView } from '@/mainwin/BrainView'
import { SettingsApp } from '@/settings/SettingsApp'
import { useData } from '@/lib/data'
import { Loadout } from './Loadout'
import { AboutPage, AccessSettings, IslandSettings, PrivacySettings, TipsPage } from './settings'
import { ShizukuSettings } from './ShizukuSettings'
import { usePage } from './nav'
import { Spirit } from './spirit'
import { Card, ListRow, PageHead, SubHead } from './ui'

// You: the profile and everything about how Lokey is set up. Bond (memory) and the phone-relevant settings, one sub page each.
type Sec = { id: string; title: string; sub: string; icon: ReactNode }
const LIST: { head: string; items: Sec[] }[] = [
  { head: 'Your spirit', items: [
    { id: 'spirit', title: 'Spirit', sub: 'Skin, personality, voice, poses', icon: <Sparkles size={18} /> },
    { id: 'bond', title: 'Bond', sub: 'What I remember about you', icon: <Link2 size={18} /> },
  ] },
  { head: 'How I listen and think', items: [
    { id: 'voice', title: 'Voice and language', sub: 'Gemini key, English, Tamil, Tanglish', icon: <Mic size={18} /> },
    { id: 'wake', title: 'Wake-up', sub: 'Claps and phrases', icon: <Waves size={18} /> },
    { id: 'brain', title: 'Brain and providers', sub: 'Models, limits, memory search', icon: <BrainCircuit size={18} /> },
  ] },
  { head: 'On this phone', items: [
    { id: 'island', title: 'Island', sub: 'What it shows, haptics, spirit animations', icon: <LayoutPanelTop size={18} /> },
    { id: 'appearance', title: 'Appearance', sub: 'Theme, accent, text size, motion', icon: <Palette size={18} /> },
    { id: 'access', title: 'Permissions and Android access', sub: 'Microphone, notifications, accessibility', icon: <KeyRound size={18} /> },
    { id: 'privacy', title: 'Privacy', sub: 'Learning, screen access, approvals', icon: <ShieldCheck size={18} /> },
    { id: 'shizuku', title: 'Power tier (Shizuku)', sub: 'Optional: tasks on a hidden second screen', icon: <Zap size={18} /> },
    { id: 'tips', title: 'OriginOS tips', sub: 'Keep Lokey alive in the background', icon: <Smartphone size={18} /> },
    { id: 'about', title: 'About', sub: 'lokey for Android', icon: <Info size={18} /> },
  ] },
]
const TITLE: Record<string, string> = Object.fromEntries(LIST.flatMap(g => g.items.map(i => [i.id, i.title])))

function Sub({ id }: { id: string }) {
  switch (id) {
    case 'spirit': return <Loadout />
    case 'bond': return <BrainView />
    case 'voice': case 'wake': case 'brain': case 'appearance': return <SettingsApp section={id} embedded />
    case 'island': return <IslandSettings />
    case 'access': return <AccessSettings />
    case 'privacy': return <PrivacySettings />
    case 'shizuku': return <ShizukuSettings />
    case 'tips': return <TipsPage />
    default: return <AboutPage />
  }
}

export function You() {
  const section = usePage(s => s.section)
  const go = usePage(s => s.go)
  const name = useData(s => s.user?.name)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  useEffect(() => { void bridge.voice.info().then(i => setHasKey(i.hasKey)).catch(() => undefined) }, [section])

  if (section && TITLE[section]) {
    return (
      <div className="scroll-y" style={{ position: 'absolute', inset: 0, padding: '0 16px 24px', touchAction: 'pan-y' }}>
        <SubHead title={TITLE[section]} onBack={() => go('you')} />
        <div style={{ paddingTop: 4 }}><Sub id={section} /></div>
      </div>
    )
  }
  return (
    <div className="scroll-y" style={{ position: 'absolute', inset: 0, padding: '0 16px 24px', touchAction: 'pan-y' }}>
      <PageHead title="You" />
      <Card style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Spirit size={64} face emotes />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 650 }}>{name || 'Lokey'}</div>
            <div style={{ fontSize: 13, color: hasKey === false ? 'var(--warn)' : 'var(--muted)' }}>{hasKey === null ? ' ' : hasKey ? 'Gemini key saved. Hold to talk.' : 'No Gemini key yet'}</div>
          </div>
          {hasKey === false && <button className="ph-pill pri" onClick={() => go('you', 'voice')}>Add key</button>}
        </div>
      </Card>
      {LIST.map(g => (
        <div key={g.head} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.04em', padding: '0 8px 6px', textTransform: 'uppercase' }}>{g.head}</div>
          <div style={{ background: 'var(--fill-1)', borderRadius: 28, overflow: 'hidden' }}>
            {g.items.map((i, n) => <div key={i.id} style={{ borderTop: n ? '1px solid var(--line)' : 'none' }}><ListRow icon={i.icon} title={i.title} sub={i.sub} onClick={() => go('you', i.id)} /></div>)}
          </div>
        </div>
      ))}
    </div>
  )
}
