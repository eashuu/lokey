import { useMemo } from 'react'
import { create } from 'zustand'
import type { AgentTask } from '@shared/voice'
import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { useFocus } from '@/lib/focus'
import { haptic } from '@/lib/platform'
import { useChat } from './chat'
import { onNativeName } from './native'

// What the island is showing: every live thing on the phone is an "activity". One of them is the compact face (by priority:
// approval > voice > timer > job > music > reminder > idle), the others show as small dots; swipe left/right cycles them.

export type Kind = 'approval' | 'voice' | 'timer' | 'job' | 'music' | 'reminder' | 'charging' | 'pc' | 'idle'
export const PRIO: Record<Kind, number> = { charging: 110, approval: 100, voice: 90, timer: 80, job: 70, music: 60, reminder: 50, pc: 20, idle: 0 }
export const KIND_LABEL: Record<Kind, string> = { approval: 'Approvals', voice: 'Voice', timer: 'Timer', job: 'Background jobs', music: 'Now playing', reminder: 'Reminders and nudges', charging: 'Charging and battery', pc: 'PC link', idle: 'Quick card' }
/** the ones the user can switch off in Settings > Island (approvals are never hidden) */
export const OPTIONAL: Kind[] = ['voice', 'timer', 'job', 'music', 'reminder', 'charging', 'pc']

export interface Due { id: string; title: string; text?: string; kind: 'reminder' | 'loop' | 'nudge'; loopId?: string }
export interface PcAsk { id: string; title: string; detail: string; timeoutMs?: number; from: 'pc' }
export interface Flash { text: string; icon: 'bolt' | 'low' }
export interface Activity { kind: Kind; prio: number }

interface Isl {
  expanded: boolean
  pick: Kind | null
  due: Due[]
  pcAsks: PcAsk[]
  pc: { paired: boolean; connected: boolean; name: string }
  jobs: AgentTask[]
  flash: Flash | null
  setExpanded: (b: boolean) => void
  setPick: (k: Kind | null) => void
}
export const useIsl = create<Isl>(set => ({
  expanded: false, pick: null, due: [], pcAsks: [], pc: { paired: false, connected: false, name: '' }, jobs: [], flash: null,
  setExpanded: expanded => set({ expanded }), setPick: pick => set({ pick }),
}))

const set = useIsl.setState
const dismissed = new Set<string>()
export const addDue = (d: Due) => { if (!dismissed.has(d.id)) set(s => ({ due: [...s.due.filter(x => x.id !== d.id), d] })) }
export const clearDue = (id: string) => { dismissed.add(id); set(s => ({ due: s.due.filter(x => x.id !== id) })) }
export const snoozeLater = (d: Due, ms: number) => { clearDue(d.id); setTimeout(() => { dismissed.delete(d.id); addDue(d) }, ms) }

let flashTimer: ReturnType<typeof setTimeout> | undefined
export function flash(f: Flash, ms = 2800) { set({ flash: f }); clearTimeout(flashTimer); flashTimer = setTimeout(() => set({ flash: null }), ms) }

/** +1 minute on the running or paused focus timer (the lib itself only starts, pauses and resets) */
export function focusPlusMinute() {
  const f = useFocus.getState()
  if (f.status === 'running') useFocus.setState({ endsAt: f.endsAt + 60_000, totalMs: f.totalMs + 60_000, remainingMs: f.remainingMs + 60_000 })
  else if (f.status === 'paused') useFocus.setState({ totalMs: f.totalMs + 60_000, remainingMs: f.remainingMs + 60_000 })
  else if (f.status === 'done') f.start(1)
}

/** wiring of everything the island watches; call once */
export function initActivities() {
  const offs: (() => void)[] = []
  // background jobs
  void bridge.agents.list().then(jobs => set({ jobs })).catch(() => undefined)
  offs.push(bridge.agents.onChange(jobs => set({ jobs })))

  // reminders that fired (the plugin's alarm), nudges
  offs.push(onNativeName(['reminder.fired'], (_n, d) => { const r = d as { id?: string; title?: string; text?: string }; addDue({ id: 'rem:' + (r.id ?? Date.now()), title: r.title || r.text || 'Reminder', text: r.title ? r.text : undefined, kind: 'reminder' }); haptic('heavy') }))

  // open loops that came due
  const loops = async () => {
    const rows = await bridge.voice.loops().catch(() => [])
    const now = Date.now()
    for (const l of rows) if (l.due && Date.parse(l.due) <= now) addDue({ id: 'loop:' + l.id, title: l.what, text: l.who ? `with ${l.who}` : undefined, kind: 'loop', loopId: l.id })
  }
  void loops(); const lt = setInterval(() => void loops(), 30_000); offs.push(() => clearInterval(lt))

  // the paired PC
  const link = bridge.link
  const refreshPc = async () => {
    try { const s = (await link.state()) as unknown as { paired?: boolean; connected?: boolean; name?: string; enabled?: boolean; running?: boolean; devices?: unknown[] }; set({ pc: { paired: !!(s.paired ?? s.enabled), connected: !!(s.connected ?? s.running), name: s.name ?? '' } }) } catch { /* no link */ }
  }
  void refreshPc()
  offs.push(link.onEvent?.(e => {
    const d = (e.data ?? {}) as { id?: string; title?: string; detail?: string; text?: string; timeoutMs?: number }
    if (e.type === 'confirm' && d.id) set(s => ({ pcAsks: [...s.pcAsks.filter(x => x.id !== d.id), { id: d.id!, title: d.title ?? 'Your PC needs approval', detail: d.detail ?? '', timeoutMs: d.timeoutMs, from: 'pc' }] }))
    else if (e.type === 'confirm-done' && d.id) set(s => ({ pcAsks: s.pcAsks.filter(x => x.id !== d.id) }))
    else if (e.type === 'nudge') addDue({ id: 'nudge:' + Date.now(), title: d.title ?? d.text ?? 'From your PC', text: d.title ? d.text : undefined, kind: 'nudge' })
    else if (e.type === 'connected' || e.type === 'disconnected' || e.type === 'revoked') void refreshPc()
  }) ?? (() => undefined))

  // charging / low battery: a brief flash on the capsule
  let prev = useData.getState().system?.battery
  offs.push(useData.subscribe(s => {
    const b = s.system?.battery
    if (b?.present && prev?.present) {
      if (b.charging && !prev.charging) flash({ text: `${Math.round(b.pct)}%`, icon: 'bolt' })
      else if (!b.charging) for (const lvl of [20, 10, 5]) if (b.pct <= lvl && prev.pct > lvl) flash({ text: `${Math.round(b.pct)}% left`, icon: 'low' }, 3600)
    }
    prev = b
  }))
  return () => offs.forEach(f => f())
}

/** the live activities, highest priority first, honouring Settings > Island */
export function useActivities() {
  const confirms = useChat(s => s.confirms)
  const state = useChat(s => s.state)
  const convo = useChat(s => s.convo)
  const dict = useChat(s => s.dictation)
  const fstatus = useFocus(s => s.status)
  const media = useData(s => s.media)
  const enabled = useData(s => s.settings.phone?.activities)
  const { jobs, due, pcAsks, pc, flash: fl, pick } = useIsl()
  const list = useMemo(() => {
    const on = (k: Kind) => k === 'approval' || !enabled || enabled.includes(k)
    const a: Kind[] = []
    if (fl && on('charging')) a.push('charging')
    if (confirms.length || pcAsks.length) a.push('approval')
    if ((state !== 'idle' || convo || (dict && dict.phase !== 'done')) && on('voice')) a.push('voice')
    if (fstatus !== 'idle' && on('timer')) a.push('timer')
    if (jobs.some(j => j.status === 'running') && on('job')) a.push('job')
    if (media?.hasSession && on('music')) a.push('music')
    if (due.length && on('reminder')) a.push('reminder')
    if (pc.paired && on('pc')) a.push('pc')
    a.sort((x, y) => PRIO[y] - PRIO[x])
    if (!a.length) a.push('idle')
    return a
  }, [confirms.length, pcAsks.length, state, convo, dict, fstatus, jobs, media?.hasSession, due.length, pc.paired, fl, enabled])
  const face: Kind = pick && list.includes(pick) ? pick : list[0]
  return { list, face, pc, flashing: fl }
}
