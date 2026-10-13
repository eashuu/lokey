import { useEffect, useRef, useState } from 'react'
import { Bluetooth, BluetoothOff, MoonStar, Sun, SunMoon, Volume1, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { useIsland } from '@/island/store'
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
    <Pill {...v} width={width} label="Volume" dim={muted} icon={<Icon size={16} strokeWidth={1.8} />} onIcon={() => quiet(bridge.call('audio.setMuted', { muted: !muted }))} iconLabel={muted ? 'Unmute' : 'Mute'} text={`${Math.round(v.value * 100)}%`} />
  )
}

function Brightness({ level, width }: { level: number; width: number }) {
  const v = useDragValue(level, l => quiet(bridge.call('system.setBrightness', { level: l })))
  return <Pill {...v} width={width} label="Brightness" icon={<Sun size={16} strokeWidth={1.8} />} text={`${Math.round(v.value * 100)}%`} />
}

const sz = 16
const flyout = (v: 'wifi' | 'bluetooth' | 'audio') => () => useIsland.getState().setView(v)
const A = 584 / 3

/** Row 1 (y=0): Wi-Fi, Bluetooth, Audio; the chevron of each opens its in-app flyout. */
function Row1() {
  const system = useData(s => s.system)
  const audio = useData(s => s.audio)
  const bt = system?.bluetooth
  const wifi = useData(s => s.wifi)
  const online = !!wifi?.on && !!wifi.connected
  const muted = !!audio?.muted
  return (
    <>
      <SplitTile
        left={0} width={A}
        icon={wifi?.on === false || wifi?.available === false ? <WifiOff size={sz} /> : <Wifi size={sz} />}
        title="Wi-Fi"
        sub={!wifi || !wifi.available ? 'Unavailable' : !wifi.on ? 'Off' : wifi.connected ? wifi.connected.ssid : 'Not connected'}
        on={online}
        onClick={flyout('wifi')}
        onMore={flyout('wifi')}
        moreLabel="Wi-Fi networks"
      />
      <SplitTile
        left={A + 10} width={A}
        icon={bt?.on ? <Bluetooth size={sz} /> : <BluetoothOff size={sz} />}
        title="Bluetooth"
        sub={bt?.available ? (bt.on ? 'On' : 'Off') : 'Unavailable'}
        on={!!bt?.available && bt.on}
        onClick={() => bt?.available && quiet(bridge.call('system.setBluetooth', { on: !bt.on }))}
        onMore={flyout('bluetooth')}
        moreLabel="Bluetooth devices"
      />
      <SplitTile
        left={2 * (A + 10)} width={A}
        icon={muted ? <VolumeX size={sz} /> : <Volume2 size={sz} />}
        title="Audio"
        sub={audio?.device ?? 'No output'}
        on={!muted && !!audio}
        onClick={() => quiet(bridge.call('audio.setMuted', { muted: !muted }))}
        onMore={flyout('audio')}
        moreLabel="Audio devices"
      />
    </>
  )
}

/** Row 2 (y=68): Night Light (unavailable until the sidecar supports it) and Dark mode, 297 wide each, no chevrons. */
function Row2() {
  const system = useData(s => s.system)
  const night = system?.nightLight
  const dark = !!system?.darkMode
  return (
    <>
      <SplitTile left={0} width={297} icon={<MoonStar size={sz} />} title="Night Light" sub={night == null ? 'Unavailable' : night ? 'On' : 'Off'} on={!!night} disabled={night == null} onClick={() => night != null && quiet(bridge.call('system.setNightLight', { on: !night }))} />
      <SplitTile left={307} width={297} icon={<SunMoon size={sz} />} title="Dark mode" sub={dark ? 'On' : 'Off'} on={dark} onClick={() => { quiet(bridge.call('system.setDarkMode', { on: !dark })); void bridge.settings.get().then(st => { if (st.appearance.theme !== 'auto') void bridge.settings.set({ appearance: { theme: 'auto' } }) }) }} />
    </>
  )
}

/** Above the media card (y=184): tiles at 0 and 68, volume at 136 (shares the row with brightness when present). */
export function Quick() {
  const brightness = useData(s => s.system?.brightness ?? null)
  const has = brightness !== null
  const w = has ? 297 : 604
  return (
    <>
      <Row1 />
      <div style={{ position: 'absolute', left: 0, top: 68 }}><Row2 /></div>
      <div style={{ position: 'absolute', left: 0, top: 136 }}><Volume width={w} /></div>
      {has && <div style={{ position: 'absolute', left: 307, top: 136 }}><Brightness level={brightness} width={w} /></div>}
    </>
  )
}
