import { useCallback, useEffect, useMemo, useState } from 'react'
import { BellOff, Check, ChevronDown, ChevronRight, Reply, Sparkles, X } from 'lucide-react'
import { ago } from '@/lib/format'
import { haptic } from '@/lib/platform'
import { askText, sendText } from './chat'
import { native, needsPerm, onNativeName } from './native'
import { usePage } from './nav'
import { PageHead } from './ui'

// Inbox: what the notification listener sees, grouped by app. Summarise and "reply as me" go through the assistant
// (the draft is shown for confirmation; only the Send button sends, via notifications.reply, a RemoteInput reply).
// Plugin: notifications.list { limit }, notifications.reply { key, text }, notifications.dismiss { key }, perm.request notification_listener.
interface Notif { key: string; package: string; app: string; title: string; text: string; time: number; canReply?: boolean }

function useNotifs() {
  const [items, setItems] = useState<Notif[] | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await native('notifications.list', { limit: 80 })
    if (Array.isArray(r)) { setItems(r); setBlocked(null) }
    else { setItems([]); setBlocked(needsPerm(r) ?? (/listener/i.test(r?.reason ?? '') ? 'notification-listener' : null) ?? (r?.reason ? 'other:' + r.reason : null)) }
  }, [])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 8000)
    const offs = [onNativeName(['notification.posted', 'notification.removed'], () => void load())]
    const vis = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); offs.forEach(f => f?.()); document.removeEventListener('visibilitychange', vis) }
  }, [load])
  return { items, blocked, load, remove: (key: string) => setItems(p => p?.filter(n => n.key !== key) ?? p) }
}

export function Inbox() {
  const { items, blocked, load, remove } = useNotifs()
  const go = usePage(s => s.go)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [reply, setReply] = useState<Notif | null>(null)
  const groups = useMemo(() => {
    const m = new Map<string, Notif[]>()
    for (const n of [...(items ?? [])].sort((a, b) => b.time - a.time)) m.set(n.app || n.package, [...(m.get(n.app || n.package) ?? []), n])
    return [...m.entries()]
  }, [items])

  const summarise = (app: string, list: Notif[]) => {
    haptic()
    const body = list.slice(0, 12).map(n => `- ${n.title}: ${n.text}`).join('\n')
    sendText(`Summarise my ${app} notifications in two or three lines and say if anything needs a reply:\n${body}`)
    go('home')
  }
  const dismiss = (n: Notif) => { haptic(); remove(n.key); void native('notifications.dismiss', { key: n.key }) }

  return (
    <div className="scroll-y" style={{ position: 'absolute', inset: 0, padding: '0 16px 16px', touchAction: 'pan-y' }}>
      <PageHead title="Inbox" line="Your notifications, grouped by app. I can summarise them or answer for you." />
      {blocked && (
        <div style={{ padding: 16, borderRadius: 28, background: 'var(--fill-1)', display: 'grid', gap: 10, justifyItems: 'start' }}>
          <BellOff size={22} color="var(--muted)" />
          <div style={{ fontSize: 14, lineHeight: 1.45 }}>{blocked.startsWith('other:') ? blocked.slice(6) : 'Lokey needs notification access to show your notifications.'}</div>
          {!blocked.startsWith('other:') && <button className="ph-pill pri" onClick={() => { void native('perm.request', { name: 'notification_listener' }); setTimeout(() => void load(), 1500) }}>Allow notification access</button>}
        </div>
      )}
      {items && !blocked && groups.length === 0 && <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>No notifications right now.</div>}
      <div style={{ display: 'grid', gap: 10 }}>
        {groups.map(([app, list]) => {
          const isOpen = open[app] ?? list.length <= 3
          return (
            <section key={app} style={{ borderRadius: 28, background: 'var(--fill-1)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 60, padding: '0 8px 0 6px' }}>
                <button aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [app]: !isOpen }))} style={{ flex: 1, minWidth: 0, minHeight: 60, display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '0 8px' }}>
                  <span style={{ width: 36, height: 36, borderRadius: 18, flex: 'none', display: 'grid', placeItems: 'center', fontWeight: 700, background: 'color-mix(in srgb, var(--accent) 22%, transparent)', color: 'var(--accent)' }}>{(app[0] ?? '?').toUpperCase()}</span>
                  <span style={{ minWidth: 0 }}><b style={{ display: 'block', fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app}</b><span style={{ fontSize: 12, color: 'var(--muted)' }}>{list.length} new</span></span>
                  {isOpen ? <ChevronDown size={16} color="var(--muted)" /> : <ChevronRight size={16} color="var(--muted)" />}
                </button>
                <button onClick={() => summarise(app, list)} aria-label={`Summarise ${app}`} style={{ minHeight: 44, padding: '0 14px', borderRadius: 22, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, background: 'var(--fill-3)' }}><Sparkles size={14} />Summarise</button>
              </div>
              {isOpen && list.map(n => (
                <div key={n.key} style={{ padding: '8px 8px 10px 14px', borderTop: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <b style={{ flex: 1, minWidth: 0, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</b>
                    <span style={{ fontSize: 11, color: 'var(--muted)', flex: 'none' }}>{ago(n.time)}</span>
                    <button aria-label="Dismiss" onClick={() => dismiss(n)} style={{ width: 44, height: 36, margin: '-6px 0 -6px', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}><X size={16} /></button>
                  </div>
                  <div style={{ fontSize: 14, lineHeight: 1.4, color: 'var(--soft)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{n.text}</div>
                  {n.canReply && <button onClick={() => { haptic(); setReply(n) }} style={{ marginTop: 8, minHeight: 44, padding: '0 16px', borderRadius: 22, fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--fill-3)' }}><Reply size={14} />Reply as me</button>}
                </div>
              ))}
            </section>
          )
        })}
      </div>
      {reply && <ReplySheet n={reply} close={() => setReply(null)} onSent={() => { remove(reply.key); setReply(null) }} />}
    </div>
  )
}

function ReplySheet({ n, close, onSent }: { n: Notif; close: () => void; onSent: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(true)
  const [msg, setMsg] = useState('')
  const draft = useCallback(async () => {
    setBusy(true); setMsg('')
    const t = await askText(`Draft a short reply, in my own voice and style, to this ${n.app} message from "${n.title}": "${n.text}". Answer with ONLY the reply text, nothing else.`)
    setBusy(false)
    if (t) setText(t); else setMsg('No draft came back. Write it yourself, or try again.')
  }, [n])
  useEffect(() => { void draft() }, [draft])
  const send = async () => {
    if (!text.trim()) return
    setBusy(true)
    const r = await native('notifications.reply', { key: n.key, text: text.trim() })
    setBusy(false)
    if (r?.ok === false) { setMsg(r.reason ?? 'Could not send the reply'); return }
    haptic('heavy'); onSent()
  }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80 }}>
      <div onPointerDown={close} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)' }} />
      <div role="dialog" aria-label="Reply as me" style={{ position: 'absolute', left: 8, right: 8, bottom: 8, padding: 16, borderRadius: 28, background: 'var(--s1)', boxShadow: 'inset 0 0 0 1px var(--line)', display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{n.app} · {n.title}</div>
        <div style={{ fontSize: 14, color: 'var(--soft)', lineHeight: 1.4, maxHeight: 72, overflow: 'hidden' }}>“{n.text}”</div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder={busy ? 'Drafting in your style…' : 'Your reply'} style={{ width: '100%', boxSizing: 'border-box', padding: '12px 16px', borderRadius: 20, background: 'var(--fill-2)', border: 0, outline: 'none', color: 'var(--text)', font: 'inherit', fontSize: 16, resize: 'none', userSelect: 'text' }} />
        {msg && <div role="status" style={{ fontSize: 12, color: 'var(--warn)' }}>{msg}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.3fr', gap: 8 }}>
          <button className="ph-pill" onClick={close}>Cancel</button>
          <button className="ph-pill" onClick={() => void draft()} disabled={busy}>Redraft</button>
          <button className="ph-pill pri" onClick={() => void send()} disabled={busy || !text.trim()}><Check size={16} />Send</button>
        </div>
      </div>
    </div>
  )
}
