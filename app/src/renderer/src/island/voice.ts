import { bridge } from '@/bridge'
import { mascot, type EmoteKind } from '@/mascot/bus'
import { useIsland } from './store'

// Maps the main-process agent's events onto the island: held shape while listening/thinking, the awake notch with a
// talking mascot while it speaks, mascot actions, and the microphone level for the voice bars.
export const voiceLevel = { v: 0, at: 0 }

let flashTimer: ReturnType<typeof setTimeout> | undefined

export function initVoiceBridge() {
  return bridge.voice.onEvent(e => {
    const is = useIsland.getState()
    if (e.type === 'level') {
      voiceLevel.v = e.v; voiceLevel.at = performance.now()
      mascot.setLevel(e.v)
    } else if (e.type === 'state') {
      clearTimeout(flashTimer)
      const menu = is.shape === 'menu'
      // like the reference demos: the notch opens to its awake shape with the mascot reacting; the caption lives at the bottom
      const awake = (soul: 'HEARING' | 'LOOKING' | 'THINKING' | 'TALKING') => { if (!menu && is.shape !== 'awake') is.wake('pinned'); is.setSoul(soul) }
      if (e.state === 'listening' || e.state === 'connecting') awake(e.kind === 'lasso' ? 'LOOKING' : 'HEARING')
      else if (e.state === 'thinking') awake('THINKING')
      else if (e.state === 'speaking') awake('TALKING')
      else { // idle / error
        useIsland.setState({ mode: 'hover' })
        if (is.shape === 'held' || is.shape === 'awake') is.release()
        is.setSoul(is.rest === 'awake' || is.shape === 'menu' ? 'LISTENING' : 'MUTED')
      }
    } else if (e.type === 'mascot') {
      if (e.play) mascot.play(e.play)
      if (e.emote) mascot.emote(e.emote as EmoteKind)
    } else if (e.type === 'reply' && is.shape === 'sleep') {
      // a scheduled task spoke up while the island sleeps: show the mascot for a moment
      is.wake('hover')
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => { const s = useIsland.getState(); if (s.shape === 'awake' && s.rest === 'sleep') s.sleep() }, 3800)
    }
  })
}
