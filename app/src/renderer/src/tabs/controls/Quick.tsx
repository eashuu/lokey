import { useEffect, useRef, useState } from 'react'
import { Bluetooth, BluetoothOff, Cable, MoonStar, Sun, SunMoon, Volume1, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { Tile } from '@/ui'
import { Pill } from './Pill'
import { SplitTile } from './SplitTile'

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

function Volume({ width }: { width: number }) {
  const audio = useData(s => s.audio)
  const v = useDragValue(audio?.volume ?? 0, level => quiet(bridge.call('audio.setVolume', { level })))
  const muted = !!audio?.muted
  const Icon = muted || v.value === 0 ? VolumeX : v.value < 0.5 ? Volume1 : Volume2
  return (
    <Pill {...v} width={width} label="Volume" dim={muted} icon={<Icon size={17} strokeWidth={1.8} />} onIcon={() => quiet(bridge.call('audio.setMuted', { muted: !muted }))} iconLabel={muted ? 'Unmute' : 'Mute'} text={`${Math.round(v.value * 100)}%`} />
  )
}

function Brightness({ level, width }: { level: number; width: number }) {
  const v = useDragValue(level, l => quiet(bridge.call('system.setBrightness', { level: l })))
  return <Pill {...v} width={width} label="Brightness" icon={<Sun size={17} strokeWidth={1.8} />} text={`${Math.round(v.value * 100)}%`} />
}

const open = (page: 'network' | 'bluetooth' | 'sound') => () => quiet(bridge.call('system.openSettings', { page }))
const sz = 17

/** Row 1 (y=0): Wi-Fi, Bluetooth, Audio, each with a chevron zone that opens the matching settings page. */
function Row1() {
  const system = useData(s => s.system)
  const audio = useData(s => s.audio)
  const bt = system?.bluetooth
  const net = system?.network
  const online = !!net && net.kind !== 'none'
  const muted = !!audio?.muted
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
      <SplitTile
        icon={net?.kind === 'ethernet' ? <Cable size={sz} /> : online ? <Wifi size={sz} /> : <WifiOff size={sz} />}
        title={net?.kind === 'ethernet' ? 'Ethernet' : 'Wi-Fi'}
        sub={online ? net.name || 'Connected' : 'Not connected'}
        on={online}
        onClick={open('network')}
        onMore={open('network')}
        moreLabel="Network settings"
      />
      <SplitTile
        icon={bt?.on ? <Bluetooth size={sz} /> : <BluetoothOff size={sz} />}
        title="Bluetooth"
        sub={bt?.available ? (bt.on ? 'On' : 'Off') : 'Unavailable'}
        on={!!bt?.available && bt.on}
        onClick={() => bt?.available && quiet(bridge.call('system.setBluetooth', { on: !bt.on }))}
        onMore={open('bluetooth')}
        moreLabel="Bluetooth settings"
      />
      <SplitTile
        icon={muted ? <VolumeX size={sz} /> : <Volume2 size={sz} />}
        title="Audio"
        sub={audio?.device ?? 'No output'}
        on={!muted && !!audio}
        onClick={() => quiet(bridge.call('audio.setMuted', { muted: !muted }))}
        onMore={open('sound')}
        moreLabel="Sound settings"
      />
    </div>
  )
}

/** Row 2 (y=68): Night Light (~1/3, unavailable until the sidecar supports it) and Dark mode (rest). */
function Row2() {
  const system = useData(s => s.system)
  const night = system?.nightLight
  const dark = !!system?.darkMode
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2.05fr', gap: 10 }}>
      <Tile icon={<MoonStar size={sz} />} title="Night Light" sub={night == null ? 'Unavailable' : night ? 'On' : 'Off'} on={!!night} disabled />
      <Tile icon={<SunMoon size={sz} />} title="Dark mode" sub={dark ? 'On' : 'Off'} on={dark} onClick={() => quiet(bridge.call('system.setDarkMode', { on: !dark }))} />
    </div>
  )
}

/** Above the media card (which sits at y=188): tiles at 0 and 68, volume at 136 (shares the row with brightness when present). */
export function Quick() {
  const brightness = useData(s => s.system?.brightness ?? null)
  const has = brightness !== null
  const w = has ? 297 : 604
  return (
    <>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0 }}><Row1 /></div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 68 }}><Row2 /></div>
      <div style={{ position: 'absolute', left: 0, top: 136 }}><Volume width={w} /></div>
      {has && <div style={{ position: 'absolute', left: 307, top: 136 }}><Brightness level={brightness} width={w} /></div>}
    </>
  )
}
