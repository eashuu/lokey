import { bridge } from '@/bridge'
import { useData } from '@/lib/data'
import { mascot, type EmoteKind, type Prio } from '@/mascot/bus'
import { useIsland } from './store'

// The spirit reacts to what happens on the PC, not only to the assistant: music starting, the volume, the battery, copying,
// the network, dark mode, the first wake of the day. This file only decides WHAT to react to; the Brain decides whether it can
// play right now (priorities, cooldowns, voice states: mascot/brain.ts) and the bus keeps a reaction for a moment while the
// mascot is hidden. Reactions that matter (battery, charger) briefly wake a sleeping notch so they are seen.

const lastAt: Record<string, number> = {}
let flashTimer: ReturnType<typeof setTimeout> | undefined
const quiet = () => useData.getState().settings.appearance.reduceMotion

/** `gap`: minimum ms between two reactions of the same `key` */
function react(key: string, name: string, o: { prio?: Prio; emote?: EmoteKind; gap?: number; flash?: boolean } = {}) {
  const now = performance.now()
  if (now - (lastAt[key] ?? -1e9) < (o.gap ?? 4000)) return
  lastAt[key] = now
  const is = useIsland.getState()
  if (o.flash && is.shape === 'sleep' && !is.voiceBusy && !quiet()) {
    is.wake('hover')
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => { const s = useIsland.getState(); if (s.shape === 'awake' && s.rest === 'sleep' && !s.voiceBusy) s.sleep() }, 3800)
  }
  mascot.play(name, { prio: o.prio ?? 2 })
  if (o.emote) mascot.emote(o.emote)
}

/** the notch was pressed: a hop, and a startled squeak when it is poked repeatedly */
const clicks: number[] = []
export function reactToPoke() {
  const now = performance.now()
  clicks.push(now)
  while (clicks.length && now - clicks[0] > 1400) clicks.shift()
  if (clicks.length >= 4) { react('poke', 'startled', { gap: 2500, emote: 'love' }); clicks.length = 0 } else react('poke', 'bounce', { gap: 900 })
}

export function initReactions() {
  const offs: (() => void)[] = []
  let armed = false
  const armTimer = setTimeout(() => { armed = true }, 4000) // the first data load is not news
  offs.push(() => clearTimeout(armTimer))

  // ---- media, volume, battery, network, dark mode --------------------------------------------------------------------
  let m = useData.getState().media
  let a = useData.getState().audio
  let sys = useData.getState().system
  let volTimer: ReturnType<typeof setTimeout> | undefined
  offs.push(useData.subscribe(s => {
    if (!armed) { m = s.media; a = s.audio; sys = s.system; return }
    if (s.media !== m) {
      const was = m; m = s.media
      if (m?.hasSession) {
        if (m.playing && !was?.playing) react('media-play', 'nod', { emote: 'music', gap: 8000 })
        else if (!m.playing && was?.playing && was.title === m.title) react('media-pause', 'tilt', { gap: 8000 })
        if (was?.hasSession && m.title !== was.title && m.playing) react('media-track', 'spin', { gap: 6000 })
      }
    }
    if (s.audio !== a && s.audio && a) {
      const was = a; a = s.audio
      if (a.muted !== was.muted) react('mute', a.muted ? 'crouch' : 'bounce', { emote: a.muted ? 'muted' : undefined, gap: 1500 })
      else if (a.micMuted !== was.micMuted) { if (a.micMuted) react('micmute', 'shrug', { emote: 'muted', gap: 1500 }) }
      else if (Math.abs(a.volume - was.volume) > 0.01) {
        clearTimeout(volTimer) // a slider drag is one reaction, when it settles
        const v = a.volume
        volTimer = setTimeout(() => react('volume', v >= 0.9 ? 'startled' : 'bounce', { gap: 1500 }), 350)
      }
    }
    if (s.system !== sys && s.system && sys) {
      const was = sys; sys = s.system
      const b = sys.battery, wb = was.battery
      if (b.present && wb.present) {
        if (b.charging && !wb.charging) react('plug', 'love', { emote: 'success', flash: true, prio: 3, gap: 20_000 })
        if (!b.charging) for (const lvl of [5, 10, 20]) if (b.pct <= lvl && wb.pct > lvl) { react('battery' + lvl, lvl <= 10 ? 'sad' : 'sweat', { emote: lvl <= 10 ? 'error' : 'alert', flash: true, prio: 3, gap: 60_000 }); break }
        if (b.pct >= 100 && wb.pct < 100 && b.charging) react('full', 'cheer', { emote: 'success', gap: 60_000 })
      }
      if (sys.network.kind === 'none' && was.network.kind !== 'none') react('net-down', 'sweat', { emote: 'error', prio: 3, gap: 15_000 })
      else if (was.network.kind === 'none' && sys.network.kind !== 'none') react('net-up', 'wave', { gap: 15_000 })
      if (sys.darkMode !== was.darkMode) react('dark', sys.darkMode ? 'yawn' : 'stretch', { gap: 5000 })
    }
  }))

  // ---- copying ------------------------------------------------------------------------------------------------------
  offs.push(bridge.on('clipboard.changed', () => { if (armed) react('copy', 'nod', { emote: 'write', gap: 2500 }) }))

  // ---- first wake of the day: a greeting that fits the hour --------------------------------------------------------------
  let prevShape = useIsland.getState().shape
  offs.push(useIsland.subscribe(s => {
    const was = prevShape; prevShape = s.shape
    if (was !== 'sleep' || s.shape !== 'awake' || s.voiceBusy || !armed) return
    const day = new Date().toDateString()
    let seen: string | null = null
    try { seen = localStorage.getItem('lokey.greeted') } catch { /* no storage */ }
    if (seen === day) return
    try { localStorage.setItem('lokey.greeted', day) } catch { /* no storage */ }
    const h = new Date().getHours()
    if (h >= 5 && h < 12) react('greet', 'stretch', { emote: 'wave', gap: 0 })
    else if (h < 5) react('greet', 'yawn', { gap: 0 })
    else react('greet', 'wave', { gap: 0 })
  }))

  return () => { offs.forEach(f => f()); clearTimeout(volTimer); clearTimeout(flashTimer) }
}
