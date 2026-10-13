import { useEffect, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import type { AudioDevice } from '@shared/protocol'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { PillSlider } from '@/ui'
import { Btn, Msg, Shell, useBridgeEvent } from './parts'

const call = bridge.call.bind(bridge)

function Seg({ value, onChange }: { value: AudioDevice['kind']; onChange: (v: AudioDevice['kind']) => void }) {
  return (
    <div style={{ display: 'flex', height: 28, padding: 2, borderRadius: 14, background: 'var(--fill-1)' }}>
      {(['output', 'input'] as const).map(k => (
        <button key={k} onClick={() => onChange(k)} style={{ padding: '0 12px', borderRadius: 12, fontSize: 12, fontWeight: 500, background: value === k ? 'var(--accent)' : 'transparent', color: value === k ? 'var(--accent-ink)' : 'var(--muted)', transition: 'background-color .1s linear, color .1s linear' }}>
          {k === 'output' ? 'Output' : 'Input'}
        </button>
      ))}
    </div>
  )
}

function DeviceRow({ d, onClick }: { d: AudioDevice; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', height: 44, padding: '0 14px', marginBottom: 6, borderRadius: 12, textAlign: 'left', background: d.isDefault ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : hover ? 'var(--fill-2)' : 'var(--fill-0)', transition: 'background-color .1s linear' }}
    >
      <span style={{ width: 16, height: 16, borderRadius: 8, flex: 'none', display: 'grid', placeItems: 'center', border: `2px solid ${d.isDefault ? 'var(--accent)' : 'var(--muted)'}`, transition: 'border-color .1s linear' }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)', opacity: d.isDefault ? 1 : 0, transform: `scale(${d.isDefault ? 1 : 0.4})`, transition: 'opacity .12s linear, transform .12s linear' }} />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
    </button>
  )
}

export function Audio({ w, h }: { w: number; h: number }) {
  const [tab, setTab] = useState<AudioDevice['kind']>('output')
  const [devs, setDevs] = useState<AudioDevice[] | null>(null)
  const audio = useData(s => s.audio)
  const [vol, setVol] = useState(audio?.volume ?? 0)
  const dragging = useRef(false)
  const last = useRef(0)
  const alive = useRef(true)

  const refresh = () => { void call('audio.devices', {}).then(d => { if (alive.current) setDevs(d) }).catch(() => undefined) }
  useEffect(() => {
    alive.current = true
    refresh()
    void call('audio.get', {}).then(a => useData.setState({ audio: a })).catch(() => undefined)
    return () => { alive.current = false }
  }, [])
  useBridgeEvent('audio.devices.changed', refresh)
  useEffect(() => { if (!dragging.current && audio) setVol(audio.volume) }, [audio?.volume]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (d: AudioDevice) => {
    setDevs(l => l && l.map(x => (x.kind === d.kind ? { ...x, isDefault: x.id === d.id } : x)))
    void call('audio.setDefault', { id: d.id }).catch(() => undefined).then(refresh)
  }
  const send = (v: number) => void call('audio.setVolume', { level: v }).catch(() => undefined)
  const onVol = (v: number) => {
    dragging.current = true
    setVol(v)
    const now = performance.now()
    if (now - last.current >= 50) { last.current = now; send(v) }
  }
  const onCommit = (v: number) => { dragging.current = false; setVol(v); send(v) }

  const list = devs?.filter(d => d.kind === tab) ?? []
  const out = tab === 'output'
  const muted = !!audio?.muted

  return (
    <>
      <Shell title="Sound" right={<Seg value={tab} onChange={setTab} />} w={w} h={h} bottom={out ? 56 : 0}>
        {devs && !list.length ? <Msg>{out ? 'No output devices found' : 'No input devices found'}</Msg> : list.map(d => <DeviceRow key={d.id} d={d} onClick={() => pick(d)} />)}
      </Shell>
      {out && (
        <div style={{ position: 'absolute', left: 14, right: 14, bottom: 18, height: 38, display: 'flex', gap: 8 }}>
          <Btn title={muted ? 'Unmute' : 'Mute'} kind={muted ? 'bad' : 'soft'} onClick={() => void call('audio.setMuted', { muted: !muted }).catch(() => undefined)} style={{ width: 38, height: 38, borderRadius: 19 }}>
            {muted ? <VolumeX size={16} strokeWidth={1.8} /> : <Volume2 size={16} strokeWidth={1.8} />}
          </Btn>
          <div style={{ flex: 1, minWidth: 0 }}><PillSlider value={vol} onChange={onVol} onCommit={onCommit} label="Volume" /></div>
        </div>
      )}
    </>
  )
}
