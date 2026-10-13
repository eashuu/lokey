import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Lock, RefreshCw } from 'lucide-react'
import type { WifiNetwork, WifiState } from '@shared/protocol'
import { bridge } from '@/bridge'
import { useIsland } from '@/island/store'
import { Toggle } from '@/ui'
import { Btn, Msg, Shell, Spinner, useBridgeEvent } from './parts'

const call = bridge.call.bind(bridge)

function Signal({ level, color }: { level: number; color: string }) {
  const n = Math.ceil(Math.min(100, Math.max(0, level)) / 25)
  return (
    <svg width={18} height={16} viewBox="0 0 18 16" style={{ flex: 'none' }}>
      {[0, 1, 2, 3].map(i => <rect key={i} x={i * 4.5} y={15 - (i + 1) * 3.6} width={3} height={(i + 1) * 3.6} rx={1} fill={i < n ? color : 'var(--fill-4)'} />)}
    </svg>
  )
}

function Row({ n, open, busy, err, onClick, children }: { n: WifiNetwork; open: boolean; busy: boolean; err?: string; onClick: () => void; children?: ReactNode }) {
  const [hover, setHover] = useState(false)
  const sub = busy ? 'Connecting…' : err ?? (n.connected ? 'Connected' : n.known ? 'Saved' : n.secured ? 'Secured' : 'Open')
  return (
    <div style={{ borderRadius: 12, marginBottom: 6, background: n.connected ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'var(--fill-0)' }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', height: 44, padding: '0 12px', borderRadius: 12, textAlign: 'left', background: hover ? 'var(--fill-2)' : 'transparent', transition: 'background-color .1s linear' }}
      >
        <Signal level={n.signal} color={n.connected ? 'var(--accent)' : 'var(--text)'} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', height: 18, lineHeight: '18px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.ssid}</span>
          <span style={{ display: 'block', height: 15, lineHeight: '15px', fontSize: 11, color: err ? 'var(--bad)' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
        </span>
        {busy ? <Spinner size={14} /> : n.secured && <Lock size={13} strokeWidth={1.8} color="var(--muted)" style={{ flex: 'none' }} />}
      </button>
      {children}
    </div>
  )
}

export function Wifi({ w, h }: { w: number; h: number }) {
  const [st, setSt] = useState<WifiState | null>(null)
  const [nets, setNets] = useState<WifiNetwork[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<{ ssid: string; msg: string } | null>(null)
  const alive = useRef(true)
  const scanning_ = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const focusT = useRef<ReturnType<typeof setTimeout>>(undefined)

  const scan = async () => {
    if (scanning_.current) return
    scanning_.current = true
    setScanning(true)
    const r = await call('wifi.scan', {}).catch(() => undefined)
    scanning_.current = false
    if (!alive.current) return
    if (r) setNets(r)
    setScanning(false)
  }

  useEffect(() => {
    alive.current = true
    void call('wifi.get', {}).then(s => { if (!alive.current) return; setSt(s); if (s.available && s.on && !s.accessDenied) void scan(); else setNets([]) }).catch(() => undefined)
    const t = setTimeout(() => { void scan() }, 10_000) // one follow-up scan, only if still open
    return () => { alive.current = false; clearTimeout(t); clearTimeout(focusT.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useBridgeEvent('wifi.changed', s => {
    setSt(s)
    setNets(l => l && l.map(n => ({ ...n, connected: s.connected?.ssid === n.ssid })))
  })

  const connect = async (ssid: string, password?: string) => {
    setBusy(ssid); setErr(null); setPw('')
    const r = await call('wifi.connect', { ssid, password }).catch(() => undefined)
    if (!alive.current) return
    setBusy(null)
    if (r?.ok) { setOpen(null); void scan() }
    else setErr({ ssid, msg: r ? r.reason ?? (password ? 'Wrong password' : 'Could not connect') : 'Could not connect' })
  }

  const click = (n: WifiNetwork) => {
    if (busy) return
    setErr(null); setPw('')
    if (open === n.ssid) { setOpen(null); return }
    if (n.connected) { setOpen(n.ssid); return }
    if (n.known || !n.secured) { setOpen(null); void connect(n.ssid); return }
    setOpen(n.ssid)
    useIsland.setState({ mode: 'pinned' })
    clearTimeout(focusT.current)
    focusT.current = setTimeout(() => input.current?.focus(), 80)
  }

  const submit = (ssid: string) => { if (pw) void connect(ssid, pw) }
  const setOn = (on: boolean) => {
    setSt(s => s && { ...s, on })
    void call('wifi.setOn', { on }).then(() => { if (on && alive.current) void scan() }).catch(() => undefined)
  }

  const right = (
    <>
      {st && st.available && !st.accessDenied && st.on && (
        <Btn title="Rescan" onClick={() => void scan()} style={{ width: 28, height: 28, borderRadius: 14 }}>
          {scanning ? <Spinner size={14} /> : <RefreshCw size={14} strokeWidth={1.8} />}
        </Btn>
      )}
      {st?.available && <Toggle on={st.on} onChange={setOn} label="Wi-Fi" />}
    </>
  )

  let body: ReactNode = null
  if (!st) body = null
  else if (!st.available) body = <Msg>No Wi-Fi adapter found</Msg>
  else if (st.accessDenied) body = <Msg action={<Btn onClick={() => void call('system.openSettings', { page: 'main' }).catch(() => undefined)} style={{ height: 28, padding: '0 14px', borderRadius: 14 }}>Open location settings</Btn>}>Windows needs Location services on to list Wi-Fi networks</Msg>
  else if (!st.on) body = <Msg>Wi-Fi is off</Msg>
  else if (!nets) body = [0, 1, 2, 3, 4].map(i => <div key={i} style={{ height: 44, borderRadius: 12, marginBottom: 6, background: 'var(--fill-0)', opacity: 1 - i * 0.15 }} />)
  else if (!nets.length) body = <Msg>No networks found</Msg>
  else body = nets.map(n => (
    <Row key={n.ssid} n={n} open={open === n.ssid} busy={busy === n.ssid} err={err?.ssid === n.ssid ? err.msg : undefined} onClick={() => click(n)}>
      {open === n.ssid && n.connected && (
        <div style={{ padding: '0 12px 10px' }}>
          <Btn onClick={() => { setOpen(null); void call('wifi.disconnect', {}).catch(() => undefined) }} style={{ height: 30, padding: '0 16px', borderRadius: 15 }}>Disconnect</Btn>
        </div>
      )}
      {open === n.ssid && !n.connected && (
        <form onSubmit={e => { e.preventDefault(); submit(n.ssid) }} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '0 12px 10px' }}>
          <input
            ref={input}
            className="field"
            type="password"
            autoComplete="off"
            placeholder="Password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); setPw('') } }}
            style={{ flex: 1, minWidth: 0, height: 32, padding: '0 12px', borderRadius: 16 }}
          />
          <Btn kind="accent" disabled={!pw} onClick={() => submit(n.ssid)} style={{ height: 32, padding: '0 14px', borderRadius: 16 }}>Connect</Btn>
          <Btn onClick={() => { setOpen(null); setPw('') }} style={{ height: 32, padding: '0 12px', borderRadius: 16 }}>Cancel</Btn>
        </form>
      )}
    </Row>
  ))

  return <Shell title="Wi-Fi" right={right} w={w} h={h}>{body}</Shell>
}
