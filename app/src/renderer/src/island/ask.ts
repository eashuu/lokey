import { create } from 'zustand'
import type { AskState } from '@shared/ask'
import { useData } from '@/lib/data'
import { mascot } from '@/mascot/bus'
import { useIsland } from './store'

// Requests for the person inside the island. The main process owns the queue, the timer and the answer (agent/permissions.ts); this store
// only mirrors what it sends: the card on screen (with its absolute expiry) and how many wait behind it.
interface AskStore { cur: AskState['cur']; more: number; shownAt: number }
export const useAsk = create<AskStore>(() => ({ cur: null, more: 0, shownAt: 0 }))

let ctx: AudioContext | null = null
/** a soft two-note tone; only when Settings > Permissions > "Soft sound" is on. Quiet on purpose (about -26 dB, 200 ms). */
function chime() {
  try {
    if (!useData.getState().settings.agent?.askSound) return
    ctx ??= new AudioContext()
    const t = ctx.currentTime
    for (const [i, f] of [660, 880].entries()) {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0, t + i * 0.09); g.gain.linearRampToValueAtTime(0.05, t + i * 0.09 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.2)
      o.connect(g).connect(ctx.destination); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.22)
    }
  } catch { /* no audio device: silent is fine */ }
}

/** what a new state does to the island: show the card (and let the spirit notice), or give the island back */
export function applyAsk(s: AskState) {
  const prev = useAsk.getState()
  const fresh = !!s.cur && s.cur.id !== prev.cur?.id
  useAsk.setState({ cur: s.cur, more: s.more, shownAt: fresh ? Date.now() : prev.shownAt })
  const is = useIsland.getState()
  if (s.cur) {
    if (is.shape !== 'ask') is.showAsk()
    if (fresh) { mascot.play('alert', { prio: 3 }); mascot.emote('alert'); chime() }
  } else is.endAsk()
}

export const answerAsk = (id: string, ok: boolean) => window.lokeyAsk?.answer(id, ok)

export function initAsk() {
  const a = window.lokeyAsk
  if (!a) return () => undefined
  a.onState(s => applyAsk(s))
  a.ready()
  return () => undefined
}

// QA hook, only on the mock bridge (--mock --shots, a plain browser): window.__ask.set({ cur: {...}, more: 1 }) draws a card without any main process
if ((window as unknown as { lokeyFlags?: { mock?: boolean } }).lokeyFlags?.mock || !('lokey' in window)) (window as unknown as { __ask: { set: (s: AskState) => void } }).__ask = { set: applyAsk }
