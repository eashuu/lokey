import { bridge } from '@/bridge'
import { mascot, type EmoteKind, type Prio } from '@/mascot/bus'
import { useFocus } from '@/lib/focus'
import { useChat } from './chat'
import { useIsl } from './activities'
import { onNativeName } from './native'

// The spirit's reactions to what only a phone has: a new notification, the PC connecting, a timer starting or ending, an approval
// waiting, a reminder due, a finished job. The desktop reactions (battery, charger, music, volume, clipboard, network...) come from
// island/reactions.ts, which the phone runs as well; the Brain (mascot/brain.ts) arbitrates by priority and cooldown.
const lastAt: Record<string, number> = {}
function react(key: string, name: string, o: { prio?: Prio; emote?: EmoteKind; gap?: number } = {}) {
  const now = performance.now()
  if (now - (lastAt[key] ?? -1e9) < (o.gap ?? 3000)) return
  lastAt[key] = now
  mascot.play(name, { prio: o.prio ?? 2 })
  if (o.emote) mascot.emote(o.emote)
}

export function initPhoneReactions() {
  const offs: (() => void)[] = []
  let armed = false
  const arm = setTimeout(() => { armed = true }, 3000) // what is already there at start is not news
  offs.push(() => clearTimeout(arm))
  offs.push(onNativeName(['notification.posted'], () => { if (armed) react('notif', 'bounce', { emote: 'alert', gap: 4000 }) }))
  offs.push(onNativeName(['reminder.fired'], () => react('reminder', 'alert', { emote: 'clock', prio: 3, gap: 1000 })))
  offs.push(bridge.link.onEvent?.(e => {
    if (e.type === 'connected') react('pc-up', 'wave', { emote: 'wave', gap: 15_000 })
    else if (e.type === 'confirm') react('pc-ask', 'alert', { emote: 'alert', prio: 3, gap: 1000 })
    else if (e.type === 'disconnected') react('pc-down', 'sad', { gap: 15_000 })
    else if (e.type === 'nudge') react('nudge', 'tilt', { emote: 'idea', gap: 5000 })
  }) ?? (() => undefined))

  let fs = useFocus.getState().status
  offs.push(useFocus.subscribe(s => {
    const was = fs; fs = s.status
    if (s.status === 'running' && was === 'idle') react('timer-start', 'nod', { emote: 'clock', gap: 1000 })
    else if (s.status === 'done' && was !== 'done') react('timer-done', 'celebrate', { emote: 'success', prio: 3, gap: 1000 })
  }))

  let asks = 0
  offs.push(useChat.subscribe(s => { if (s.confirms.length > asks && armed) react('confirm', 'alert', { emote: 'alert', prio: 3, gap: 1000 }); asks = s.confirms.length }))

  let jobs = useIsl.getState().jobs
  offs.push(useIsl.subscribe(s => {
    if (s.jobs === jobs) return
    const was = jobs; jobs = s.jobs
    for (const j of jobs) { const p = was.find(x => x.id === j.id); if (p && p.status === 'running' && j.status === 'done') react('job-done', 'cheer', { emote: 'success', gap: 4000 }); else if (p && p.status === 'running' && j.status === 'failed') react('job-fail', 'sweat', { emote: 'error', gap: 4000 }) }
  }))
  return () => offs.forEach(f => f?.())
}
