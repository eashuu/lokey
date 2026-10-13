import type { CSSProperties, ReactNode } from 'react'
import { Music2 } from 'lucide-react'
import { useData, useStatsStream } from '@/lib/data'
import { useClock } from '@/lib/clock'
import { bytes } from '@/lib/format'
import { Bar, Kbd } from '@/ui'
import { Mascot } from '@/island/Mascot'
import { SettingsApp } from '@/settings/SettingsApp'

const pageBox: CSSProperties = { position: 'absolute', inset: 0 }

export function Placeholder({ title, line }: { title: string; line: string }) {
  return (
    <div style={{ ...pageBox, display: 'grid', placeContent: 'center', justifyItems: 'center', gap: 6, textAlign: 'center', padding: 24 }}>
      <Mascot size={64} />
      <h1 style={{ margin: '10px 0 0', fontSize: 20, fontWeight: 650 }}>{title}</h1>
      <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 360 }}>{line}</div>
    </div>
  )
}

/** SettingsApp assumes a full window with room for the OS title bar; trim its top padding for ours. */
export function SettingsPage() {
  return (
    <div style={{ ...pageBox, overflow: 'hidden' }}>
      <div style={{ height: 'calc(100% + 36px)', marginTop: -36 }}><SettingsApp /></div>
    </div>
  )
}

function Tile({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: 'var(--fill-1)', borderRadius: 14, padding: 14, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="label">{title}</div>
      {children}
    </div>
  )
}

function Media() {
  const m = useData(s => s.media)
  if (!m?.hasSession) return <div style={{ fontSize: 13, color: 'var(--muted)' }}>Nothing playing.</div>
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
      <div style={{ width: 52, height: 52, borderRadius: 10, flex: 'none', background: 'var(--fill-2)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        {m.art ? <img src={m.art} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Music2 size={20} color="var(--muted)" />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.artist}</div>
        <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 3 }}>{m.playing ? 'Playing' : 'Paused'} · {m.app}</div>
      </div>
    </div>
  )
}

function Meter({ label, pct, text }: { label: string; pct: number; text: string }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
        <span style={{ color: 'var(--soft)' }}>{label}</span><span className="num">{text}</span>
      </div>
      <Bar value={pct} height={5} />
    </div>
  )
}

function System() {
  useStatsStream(true, 2000) // Home is only mounted while visible, so the stream stops when you leave
  const st = useData(s => s.stats)
  if (!st) return <div style={{ fontSize: 13, color: 'var(--muted)' }}>Reading…</div>
  const ram = (st.ram.used / st.ram.total) * 100
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Meter label="CPU" pct={st.cpu.pct} text={`${Math.round(st.cpu.pct)}%`} />
      <Meter label="Memory" pct={ram} text={`${bytes(st.ram.used)} / ${bytes(st.ram.total)}`} />
    </div>
  )
}

export function Home() {
  const now = useClock()
  const name = useData(s => s.user?.name)
  const hotkey = useData(s => s.settings.island.hotkey)
  const h = now.getHours()
  const hello = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  return (
    <div style={{ ...pageBox, padding: '12px 28px 0', overflow: 'auto' }} className="scroll-y">
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 650 }}>{hello}{name ? `, ${name}` : ''}</h1>
      <div style={{ marginTop: 4, fontSize: 13, color: 'var(--muted)' }}>
        {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · <span className="num">{now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Tile title="Now playing"><Media /></Tile>
        <Tile title="System"><System /></Tile>
        <Tile title="Try the island">
          <div style={{ fontSize: 13, color: 'var(--soft)', lineHeight: 1.5 }}>
            Press <span style={{ whiteSpace: 'nowrap' }}>{hotkey.split('+').map(k => <Kbd key={k}>{k}</Kbd>)}</span> or scroll down on the notch at the top of your screen.
          </div>
        </Tile>
      </div>
    </div>
  )
}
