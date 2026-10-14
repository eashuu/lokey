import { useState } from 'react'
import { Check, Monitor, RefreshCw, Unplug } from 'lucide-react'
import { bridge } from '@/bridge'
import { haptic } from '@/lib/platform'
import { useIsl } from './activities'
import { AskPc, batteryText, usePcStatus } from './cards'
import { PairForm } from './Onboarding'
import { Card, PageHead } from './ui'

// PC: the paired Lokey on your computer. bridge.link.pcStatus / approve / sync / pair / setEnabled(false) = unpair, onEvent for approvals and nudges.
export function PcPage() {
  const pc = useIsl(s => s.pc)
  const asks = useIsl(s => s.pcAsks)
  const st = usePcStatus()
  const [sync, setSync] = useState('')
  const [busy, setBusy] = useState(false)
  const bat = batteryText(st?.battery)
  const paired = pc.paired

  const doSync = async () => {
    haptic(); setBusy(true); setSync('Syncing memory…')
    try { const r = await bridge.link.sync?.(); setSync(r ? `Memory synced: ${r.pulled} from the PC, ${r.pushed} sent` : 'Sync is not available in this build') } catch (e) { setSync(e instanceof Error ? e.message : 'Could not sync') }
    setBusy(false)
  }
  const answer = async (id: string, ok: boolean) => { haptic(ok ? 'heavy' : 'tick'); await bridge.link.approve?.(id, ok).catch(() => false); useIsl.setState(s => ({ pcAsks: s.pcAsks.filter(x => x.id !== id) })) }

  return (
    <div className="scroll-y" style={{ position: 'absolute', inset: 0, padding: '0 16px 16px', touchAction: 'pan-y' }}>
      <PageHead title="PC" line={paired ? 'Your computer, over your own Wi-Fi.' : 'Pair Lokey on your PC with this phone.'} />
      {!paired ? (
        <Card title="Pair with my PC">
          <div style={{ fontSize: 14, color: 'var(--soft)', lineHeight: 1.5 }}>On the PC open Lokey, Settings, Devices, Pair a phone. It shows an address and a 6-digit code. Same Wi-Fi.</div>
          <PairForm />
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 18, background: 'var(--fill-2)', display: 'grid', placeItems: 'center' }}><Monitor size={26} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st?.pc || pc.name || 'Your PC'}</div>
                <div style={{ fontSize: 13, color: st ? 'var(--ok)' : 'var(--muted)' }}>{st === undefined ? 'Checking…' : st ? `Connected${st.agent ? ` · ${st.agent}` : ''}` : 'Not reachable. Is it on, on the same Wi-Fi?'}</div>
              </div>
            </div>
            {st && (bat || st.nowPlaying || st.jobs?.length) ? (
              <div style={{ display: 'grid', gap: 6, fontSize: 14 }}>
                {bat && <div style={{ color: 'var(--soft)' }}>Battery <b style={{ color: 'var(--text)' }}>{bat}</b></div>}
                {st.nowPlaying && <div style={{ color: 'var(--soft)' }}>Playing <b style={{ color: 'var(--text)' }}>{st.nowPlaying.title}</b> · {st.nowPlaying.artist}</div>}
                {st.jobs?.length ? <div style={{ color: 'var(--soft)' }}>Working on <b style={{ color: 'var(--text)' }}>{st.jobs.join(', ')}</b></div> : null}
              </div>
            ) : null}
          </Card>

          {asks.length > 0 && (
            <Card title={`Waiting for your approval · ${asks.length}`}>
              {asks.map(a => (
                <div key={a.id} style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 22, background: '#000' }}>
                  <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: '#f5a524' }}>Your PC asks</div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{a.title}</div>
                  {a.detail && <div style={{ fontSize: 13, color: 'rgba(255,255,255,.62)', whiteSpace: 'pre-wrap' }}>{a.detail}</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}><button className="ph-pill" onClick={() => void answer(a.id, false)}>Deny</button><button className="ph-pill" onClick={() => void answer(a.id, true)} style={{ background: '#f5a524', color: '#2a1800' }}><Check size={16} />Allow</button></div>
                </div>
              ))}
            </Card>
          )}

          <Card title="Ask or send"><AskPc /></Card>

          <Card title="Memory">
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>What each Lokey learns is merged into the other, both ways.</div>
            <button className="ph-pill pri" disabled={busy} onClick={() => void doSync()}><RefreshCw size={16} className={busy ? 'ph-spin' : undefined} />Sync memory now</button>
            {sync && <div role="status" style={{ fontSize: 12, color: 'var(--muted)' }}>{sync}</div>}
          </Card>

          <button className="ph-pill" onClick={() => { if (confirm('Unpair this phone from the PC?')) void bridge.link.setEnabled(false).then(() => useIsl.setState(s => ({ pc: { ...s.pc, paired: false, connected: false } }))) }} style={{ color: 'var(--bad)' }}><Unplug size={16} />Unpair</button>
        </div>
      )}
    </div>
  )
}
