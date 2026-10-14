import { useEffect, useMemo, useRef } from 'react'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { useFocus } from '@/lib/focus'
import { mediaControl } from '@/lib/media'
import { clamp } from '@/lib/format'
import { PRIO, clearDue, focusPlusMinute, snoozeLater, useActivities, useIsl, type Kind } from './activities'
import { answerConfirm, useChat } from './chat'
import { native, onNativeName } from './native'
import { usePage } from './nav'
import { onSnapshot, snap } from './spirit'

// The island outside the app. The same activities and priority as the in-app capsule are published to the native plugin
// (island.update: the system-wide pill at the camera cutout and the Android 16 Live Update notifications); what the user presses there
// comes back as island.action / tap / hold / double and runs the same handlers as the capsule. While the app is in front the overlay
// is hidden natively (IslandPolicy), so there is only one island on screen. Faces expire natively after 2 min: active faces are re-published every 60 s.
//
// island.update  { faces: [{ id, kind, title, subtitle, progress?, endAt?, icon?, actions?: [{ id, label, primary? }], priority }], primary, spirit }
//   id = kind (one face per kind); primary = id of the face the pill shows; spirit = 96x96 PNG data URL of the live 3D spirit; faces [] = idle
// island.setEnabled { systemIsland, liveUpdates, vivo }  (native decides by itself when the overlay shows; the page only sends the user's switches: at boot and when Settings change)
// events: island.action { face, action } (also accepted: id / kind), island.tap { face }, island.hold { down }, island.double

interface Face { id: string; kind: Kind; title: string; subtitle: string; progress?: number; endAt?: number; icon?: string; actions?: { id: string; label: string; primary?: boolean }[]; priority: number }
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

/** the one place that runs what a face's button means (the native pill and the notification both end up here) */
export function runFaceAction(face: string, action: string) {
  const chat = useChat.getState(), isl = useIsl.getState(), f = useFocus.getState()
  if (face === 'approval') {
    const c = chat.confirms[0], pcAsk = isl.pcAsks[0]
    const ok = action === 'allow'
    if (c) answerConfirm(c.id, ok)
    else if (pcAsk) { void bridge.link.approve?.(pcAsk.id, ok).catch(() => false); useIsl.setState(s => ({ pcAsks: s.pcAsks.filter(x => x.id !== pcAsk.id) })) }
  } else if (face === 'music') mediaControl(action === 'prev' ? 'prev' : action === 'next' ? 'next' : 'toggle')
  else if (face === 'timer') { if (action === 'plus1') focusPlusMinute(); else if (action === 'stop') f.reset(); else if (f.status === 'running') f.pause(); else f.start(Math.max(1, Math.round(f.totalMs / 60000))) }
  else if (face === 'job') { const j = isl.jobs.find(x => x.status === 'running'); if (action === 'stopAll') bridge.agents.stop('all'); else if (j) bridge.agents.stop(j.id) }
  else if (face === 'voice') { if (action === 'conversation') bridge.voice.toggleConversation(); else bridge.agents.stop('all') }
  else if (face === 'reminder') {
    const d = isl.due[0]
    if (!d) return
    if (action === 'snooze') { snoozeLater(d, 10 * 60_000); if (d.loopId) void bridge.voice.loopSet(d.loopId, 'snooze'); else void native('reminder.set', { inMs: 600_000, title: d.title, text: d.text ?? d.title }) }
    else { clearDue(d.id); if (d.loopId) void bridge.voice.loopSet(d.loopId, 'done') }
  }
}

export function NativeIsland() {
  const { list, face } = useActivities()
  const media = useData(s => s.media)
  const sysOn = useData(s => s.settings.phone?.systemIsland) !== false
  const liveOn = useData(s => s.settings.phone?.liveUpdates) !== false
  const vivoOn = useData(s => s.settings.phone?.vivoIsland) !== false
  const f = useFocus()
  const { jobs, due, pcAsks, pc, flash } = useIsl()
  const confirms = useChat(s => s.confirms)
  const state = useChat(s => s.state)
  const msgs = useChat(s => s.msgs)

  const faces = useMemo<Face[]>(() => list.filter(k => k !== 'idle').map((kind): Face => {
    const base = { id: kind, kind, priority: PRIO[kind] }
    switch (kind) {
      case 'approval': { const c = confirms[0] ?? pcAsks[0]; return { ...base, title: c?.title ?? 'Approval needed', subtitle: (c?.detail || (pcAsks.length && !confirms.length ? 'Your PC asks' : 'Lokey wants to')).slice(0, 120), icon: 'approval', actions: [{ id: 'deny', label: 'Deny' }, { id: 'allow', label: 'Allow', primary: true }] } }
      case 'voice': { const last = [...msgs].reverse().find(m => m.kind === 'said' || m.kind === 'reply'); return { ...base, title: state === 'thinking' ? 'Thinking…' : state === 'speaking' ? 'Speaking…' : 'Listening…', subtitle: (last?.text ?? '').slice(0, 100), icon: 'voice', actions: [{ id: 'stop', label: 'Stop' }] } }
      case 'timer': { const run = f.status === 'running'; return { ...base, title: f.status === 'done' ? 'Timer done' : f.status === 'paused' ? mmss(f.remainingMs) : 'Timer', subtitle: f.status === 'paused' ? 'Paused' : f.status === 'done' ? 'Focus' : 'Focus (counts down on its own)', progress: f.totalMs ? clamp(1 - f.remainingMs / f.totalMs, 0, 1) : 0, endAt: run ? Date.now() + f.remainingMs : undefined, icon: 'timer', actions: [{ id: 'toggle', label: run ? 'Pause' : 'Resume', primary: true }, { id: 'plus1', label: '+1 min' }, { id: 'stop', label: 'Stop' }] } }
      case 'job': { const j = jobs.find(x => x.status === 'running'); return { ...base, title: j?.title ?? 'Working', subtitle: (j?.line ?? '').slice(0, 100), icon: 'job', actions: [{ id: 'stop', label: 'Stop' }] } }
      case 'music': { const dur = media?.durationMs ?? 0; const pos = (media?.positionMs ?? 0) + (media?.playing ? Date.now() - (media?.sampledAt ?? Date.now()) : 0); return { ...base, title: media?.title || 'Playing', subtitle: media?.artist || media?.app || '', progress: dur ? clamp(pos / dur, 0, 1) : undefined, endAt: media?.playing && dur ? Date.now() + (dur - pos) : undefined, icon: media?.playing ? 'music' : 'music-paused', actions: [{ id: 'prev', label: 'Previous' }, { id: 'toggle', label: media?.playing ? 'Pause' : 'Play', primary: true }, { id: 'next', label: 'Next' }] } }
      case 'reminder': return { ...base, title: due[0]?.title ?? 'Reminder', subtitle: due[0]?.text ?? (due[0]?.kind === 'loop' ? 'You said you would' : due[0]?.kind === 'nudge' ? 'From your PC' : 'Reminder'), icon: 'reminder', actions: [{ id: 'snooze', label: 'Snooze 10 min' }, { id: 'done', label: 'Done', primary: true }] }
      case 'charging': return { ...base, title: flash?.text ?? '', subtitle: flash?.icon === 'low' ? 'Low battery' : 'Charging', icon: flash?.icon === 'low' ? 'battery-low' : 'charging' }
      case 'pc': return { ...base, title: pc.name || 'Your PC', subtitle: pc.connected ? 'Connected' : 'Not reachable', icon: 'pc' }
      default: return { ...base, title: kind, subtitle: '' }
    }
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [list, confirms, pcAsks, state, msgs, f.status, f.endsAt, f.totalMs, jobs, due, pc, flash, media?.title, media?.playing, media?.artist, Math.round((media?.positionMs ?? 0) / 5000)])

  // ---- publish (debounced, only when something changed) ----
  const last = useRef('')
  const lastSent = useRef(0)
  const want = sysOn || liveOn
  useEffect(() => { snap.want = want; return () => { snap.want = false } }, [want])
  useEffect(() => {
    const primary = face === 'idle' ? null : face
    const key = JSON.stringify({ faces: faces.map(x => ({ ...x, endAt: x.endAt ? Math.round(x.endAt / 2000) : undefined, progress: x.progress !== undefined ? Math.round(x.progress * 50) : undefined })), primary })
    const send = (spirit: boolean) => {
      lastSent.current = performance.now()
      void native('island.update', { faces, primary, spirit: snap.url || undefined })
      void spirit
    }
    // the native side forgets faces after 2 minutes without an update: keep the active ones alive
    const keep = setInterval(() => { if (faces.length) send(false) }, 60_000)
    let t: ReturnType<typeof setTimeout> | undefined
    if (key !== last.current) { last.current = key; t = setTimeout(() => send(false), 100) }
    // the spirit changes all the time: it is only worth sending while the overlay can be seen (the app is in the background), at most ~8 per second
    const off = onSnapshot(() => { if (document.hidden && want && performance.now() - lastSent.current > 125 && faces.length) send(true) })
    return () => { clearTimeout(t); clearInterval(keep); off() }
  }, [faces, face, want])

  // ---- the user's switches (never visibility: the native layer shows the overlay whenever Lokey is not in front) ----
  useEffect(() => { void native('island.setEnabled', { systemIsland: sysOn, liveUpdates: liveOn, vivo: vivoOn }) }, [sysOn, liveOn, vivoOn])

  // wake-up config is sent by the core only (src/mobile Wake + NativeSidecar.extra adds the phrase list): one sender, so a partial update can't overwrite it

  // ---- what the user pressed there ----
  useEffect(() => onNativeName(['island.action', 'island.tap', 'island.hold', 'island.double'], (name, d) => {
    const faceId = String(d.face ?? d.kind ?? useIsl.getState().pick ?? '')
    if (name === 'island.action') runFaceAction(faceId || face, String(d.action ?? d.id ?? ''))
    else if (name === 'island.hold') bridge.voice.hold(d.down !== false)
    else if (name === 'island.double') { bridge.voice.toggleConversation(); useChat.setState(s => ({ convo: !s.convo })) }
    else if (name === 'island.tap') {
      const k = (faceId || face) as Kind
      if (k === 'pc') usePage.getState().go('pc')
      else if (k && k !== 'idle') { useIsl.setState({ pick: k, expanded: true }) }
    }
  }), [face])
  return null
}
