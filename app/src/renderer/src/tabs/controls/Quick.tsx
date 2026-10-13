import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Battery, BatteryCharging, BatteryLow, Bluetooth, BluetoothOff, Cable, Coffee, Keyboard, Mic, MicOff, Monitor, Sun, Volume1, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { Card, IconButton, Slider } from '@/ui'

const quiet = <T,>(p: Promise<T>) => void p.catch(() => undefined)

/** Local optimistic slider value while dragging; sends are throttled to ~20/s with a guaranteed trailing send. */
function useDragValue(remote: number, send: (v: number) => void) {
  const [drag, setDrag] = useState<number | null>(null)
  const last = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => () => clearTimeout(timer.current), [])
  const onChange = (v: number) => {
    setDrag(v)
    clearTimeout(timer.current)
    const wait = 50 - (Date.now() - last.current)
    if (wait <= 0) { last.current = Date.now(); sendRef.current(v) }
    else timer.current = setTimeout(() => { last.current = Date.now(); sendRef.current(v) }, wait)
  }
  const onCommit = (v: number) => { clearTimeout(timer.current); last.current = Date.now(); sendRef.current(v); setDrag(null) }
  return { value: drag ?? remote, onChange, onCommit }
}

const pctStyle: CSSProperties = { width: '2.25rem', textAlign: 'right', fontSize: '0.75rem' }

function Volume() {
  const audio = useData(s => s.audio)
  const v = useDragValue(audio?.volume ?? 0, level => quiet(bridge.call('audio.setVolume', { level })))
  const muted = !!audio?.muted
  const Icon = muted || v.value === 0 ? VolumeX : v.value < 0.5 ? Volume1 : Volume2
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <IconButton title={muted ? 'Unmute' : 'Mute'} size="1.75rem" active={muted} onClick={() => quiet(bridge.call('audio.setMuted', { muted: !muted }))}><Icon size={15} /></IconButton>
        <div style={{ flex: 1, opacity: muted ? 0.5 : 1, transition: 'opacity 140ms' }}><Slider label="Volume" {...v} /></div>
        <span className="num" style={pctStyle}>{Math.round(v.value * 100)}%</span>
      </div>
      <div style={{ marginTop: '0.125rem', paddingLeft: '2.25rem', fontSize: '0.6875rem', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{audio?.device ?? ' '}</div>
    </div>
  )
}

function Brightness({ level }: { level: number }) {
  const v = useDragValue(level, l => quiet(bridge.call('system.setBrightness', { level: l })))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ width: '1.75rem', height: '1.75rem', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}><Sun size={15} /></span>
      <div style={{ flex: 1 }}><Slider label="Brightness" {...v} /></div>
      <span className="num" style={pctStyle}>{Math.round(v.value * 100)}%</span>
    </div>
  )
}

const ellipsis: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

function Tile({ icon, label, sub, on, disabled, onClick }: { icon: ReactNode; label: string; sub: string; on?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className="active:scale-[0.97]"
      style={{
        minHeight: '2.75rem', minWidth: 0, padding: '0.5rem 0.625rem', borderRadius: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: 'left',
        background: on ? 'var(--accent)' : 'var(--s2)', color: on ? 'var(--accent-ink)' : 'var(--text)', opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer',
        transition: 'background-color 140ms, color 140ms, transform 120ms',
      }}
    >
      <span style={{ flex: 'none', display: 'grid' }}>{icon}</span>
      <span style={{ minWidth: 0, lineHeight: 1.2 }}>
        <span style={{ ...ellipsis, fontSize: '0.75rem', fontWeight: 600 }}>{label}</span>
        <span style={{ ...ellipsis, fontSize: '0.625rem', opacity: 0.7 }}>{sub}</span>
      </span>
    </button>
  )
}

function Tiles() {
  const system = useData(s => s.system)
  const audio = useData(s => s.audio)
  const bt = system?.bluetooth
  const net = system?.network
  const micMuted = !!audio?.micMuted
  const sz = 16
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
      <Tile icon={bt?.on ? <Bluetooth size={sz} /> : <BluetoothOff size={sz} />} label="Bluetooth" sub={bt?.available ? (bt.on ? 'On' : 'Off') : 'Unavailable'} on={!!bt?.available && bt.on} disabled={!bt?.available} onClick={() => bt && quiet(bridge.call('system.setBluetooth', { on: !bt.on }))} />
      <Tile icon={<Coffee size={sz} />} label="Keep awake" sub={system?.keepAwake ? 'On' : 'Off'} on={!!system?.keepAwake} onClick={() => quiet(bridge.call('system.setKeepAwake', { on: !system?.keepAwake }))} />
      <Tile icon={micMuted ? <MicOff size={sz} /> : <Mic size={sz} />} label="Microphone" sub={micMuted ? 'Muted' : 'Live'} on={micMuted} onClick={() => quiet(bridge.call('audio.setMicMuted', { muted: !micMuted }))} />
      <Tile
        icon={net?.kind === 'ethernet' ? <Cable size={sz} /> : net?.kind === 'wifi' ? <Wifi size={sz} /> : <WifiOff size={sz} />}
        label={!net || net.kind === 'none' ? 'Offline' : net.name || (net.kind === 'wifi' ? 'Wi-Fi' : 'Ethernet')}
        sub={net?.kind === 'wifi' ? `Wi-Fi${net.signal != null ? ` · ${Math.round(net.signal * 100)}%` : ''}` : net?.kind === 'ethernet' ? 'Ethernet' : 'No network'}
        onClick={() => quiet(bridge.call('system.openSettings', { page: 'network' }))}
      />
    </div>
  )
}

function Status() {
  const system = useData(s => s.system)
  const d = useData(s => s.desktops)
  const b = system?.battery
  const BatIcon = b?.charging ? BatteryCharging : b && b.pct <= 20 ? BatteryLow : Battery
  const item: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }
  return (
    <div className="num" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.6875rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
      {b?.present && <span style={{ ...item, color: b.charging ? 'var(--ok)' : b.pct <= 20 ? 'var(--bad)' : undefined }}><BatIcon size={14} />{Math.round(b.pct)}%</span>}
      {system?.keyboard && <span style={item}><Keyboard size={13} />{system.keyboard}</span>}
      {d && <span style={{ ...item, marginLeft: 'auto' }}><Monitor size={13} />Desktop {d.current + 1}/{d.count}</span>}
    </div>
  )
}

export function QuickSettings() {
  const brightness = useData(s => s.system?.brightness ?? null)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
      <Card style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', padding: '0.625rem 0.75rem' }}>
        <Volume />
        {brightness !== null && <Brightness level={brightness} />}
      </Card>
      <Tiles />
      <Status />
    </div>
  )
}
