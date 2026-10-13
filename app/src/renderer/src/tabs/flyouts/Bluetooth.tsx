import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bluetooth as BtIcon, Headphones, Keyboard, Laptop, Smartphone, Trash2, type LucideIcon } from 'lucide-react'
import type { BtDevice, BtState } from '@shared/protocol'
import { bridge } from '@/bridge'
import { Toggle } from '@/ui'
import { Btn, Msg, Section, Shell, Spinner, useBridgeEvent } from './parts'

const call = bridge.call.bind(bridge)
const ICON: Record<BtDevice['kind'], LucideIcon> = { audio: Headphones, input: Keyboard, phone: Smartphone, computer: Laptop, other: BtIcon }

function Row({ d, sub, err, children }: { d: BtDevice; sub: string; err?: string; children: ReactNode }) {
  const Icon = ICON[d.kind]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 52, padding: '0 10px', marginBottom: 6, borderRadius: 14, background: d.connected ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--fill-0)' }}>
      <span style={{ width: 34, height: 34, borderRadius: 17, display: 'grid', placeItems: 'center', flex: 'none', background: 'var(--fill-1)', color: d.connected ? 'var(--accent)' : 'var(--text)' }}><Icon size={16} strokeWidth={1.8} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', height: 18, lineHeight: '18px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
        <span style={{ display: 'block', height: 15, lineHeight: '15px', fontSize: 11, color: err ? 'var(--bad)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{err ?? sub}</span>
      </span>
      {children}
    </div>
  )
}

const pill = { height: 28, padding: '0 14px', borderRadius: 14 } as const

export function Bluetooth({ w, h }: { w: number; h: number }) {
  const [st, setSt] = useState<BtState | null>(null)
  const [paired, setPaired] = useState<BtDevice[]>([])
  const [near, setNear] = useState<BtDevice[]>([])
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<Record<string, string>>({})
  const [armed, setArmed] = useState<string | null>(null)
  const alive = useRef(true)
  const armT = useRef<ReturnType<typeof setTimeout>>(undefined)

  const refresh = async () => {
    const [s, d] = await Promise.all([call('bt.get', {}).catch(() => undefined), call('bt.devices', {}).catch(() => undefined)])
    if (!alive.current) return
    if (s) setSt(s)
    if (d) setPaired(d.filter(x => x.paired !== false))
  }
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; clearTimeout(armT.current) } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useBridgeEvent('bt.changed', () => { void refresh() })

  const act = async (id: string, fn: () => Promise<{ ok: boolean; reason?: string } | undefined>, fail: string, after?: () => void) => {
    setBusy(id); setErr(e => { const { [id]: _, ...rest } = e; return rest })
    const r = await fn()
    if (!alive.current) return
    setBusy(null)
    if (r?.ok) after?.()
    else setErr(e => ({ ...e, [id]: r?.reason ?? fail }))
    void refresh()
  }

  const forget = (id: string) => {
    clearTimeout(armT.current)
    if (armed !== id) { setArmed(id); armT.current = setTimeout(() => setArmed(null), 2500); return }
    setArmed(null)
    setPaired(l => l.filter(d => d.id !== id))
    void call('bt.forget', { id }).catch(() => undefined).then(() => { if (alive.current) void refresh() })
  }

  const discover = async () => {
    setScanning(true)
    const r = await call('bt.discover', { seconds: 8 }).catch(() => undefined)
    if (!alive.current) return
    setScanning(false)
    if (r) setNear(r)
  }

  const setOn = (on: boolean) => {
    setSt(s => s && { ...s, on })
    void call('system.setBluetooth', { on }).catch(() => undefined).then(() => { if (alive.current) void refresh() })
  }

  const right = st?.available ? <Toggle on={st.on} onChange={setOn} label="Bluetooth" /> : null

  let body: ReactNode = null
  if (!st) body = null
  else if (!st.available) body = <Msg>No Bluetooth adapter found</Msg>
  else if (!st.on) body = <Msg>Bluetooth is off</Msg>
  else body = (
    <>
      <Section>Paired</Section>
      {!paired.length && <div style={{ height: 40, lineHeight: '40px', padding: '0 4px', fontSize: 12, color: 'var(--muted)' }}>No paired devices</div>}
      {paired.map(d => {
        const isBusy = busy === d.id
        const sub = d.connected ? `Connected${d.battery != null ? ` · ${d.battery}%` : ''}` : 'Not connected'
        return (
          <Row key={d.id} d={d} sub={sub} err={err[d.id]}>
            <Btn
              kind={d.connected ? 'soft' : 'accent'}
              disabled={isBusy}
              onClick={() => void act(d.id, () => call(d.connected ? 'bt.disconnect' : 'bt.connect', { id: d.id }).catch(() => undefined), 'Could not connect')}
              style={{ ...pill, minWidth: 84 }}
            >
              {isBusy ? <Spinner size={13} /> : d.connected ? 'Disconnect' : 'Connect'}
            </Btn>
            <Btn title={armed === d.id ? 'Confirm forget' : 'Forget'} kind={armed === d.id ? 'bad' : 'soft'} onClick={() => forget(d.id)} style={armed === d.id ? pill : { width: 28, height: 28, borderRadius: 14 }}>
              {armed === d.id ? 'Forget?' : <Trash2 size={13} strokeWidth={1.8} />}
            </Btn>
          </Row>
        )
      })}
      <Section right={<Btn onClick={() => void discover()} disabled={scanning} style={{ height: 24, padding: '0 12px', borderRadius: 12, fontSize: 11 }}>{scanning ? <><Spinner size={11} />Scanning</> : 'Scan'}</Btn>}>Nearby</Section>
      {!near.length && <div style={{ height: 40, lineHeight: '40px', padding: '0 4px', fontSize: 12, color: 'var(--muted)' }}>{scanning ? 'Looking for devices…' : 'Press Scan to look for devices'}</div>}
      {near.filter(d => !paired.some(p => p.id === d.id)).map(d => (
        <Row key={d.id} d={d} sub="Ready to pair" err={err[d.id]}>
          <Btn kind="accent" disabled={busy === d.id} onClick={() => void act(d.id, () => call('bt.pair', { id: d.id }).catch(() => undefined), 'Could not pair', () => setNear(l => l.filter(x => x.id !== d.id)))} style={{ ...pill, minWidth: 64 }}>
            {busy === d.id ? <Spinner size={13} /> : 'Pair'}
          </Btn>
        </Row>
      ))}
    </>
  )

  return <Shell title="Bluetooth" right={right} w={w} h={h}>{body}</Shell>
}
