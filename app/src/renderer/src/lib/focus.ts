// Focus timer singleton: survives the tab unmounting / island closing. One 1 s interval, only while running.
import { create } from 'zustand'

export type FocusStatus = 'idle' | 'running' | 'paused' | 'done'
interface Focus {
  status: FocusStatus
  totalMs: number
  remainingMs: number
  endsAt: number
  /** Start (from idle/done, using `minutes`) or resume (from paused). */
  start: (minutes: number) => void
  pause: () => void
  reset: () => void
}

let timer: ReturnType<typeof setInterval> | undefined
const stop = () => { clearInterval(timer); timer = undefined }

export const useFocus = create<Focus>((set, get) => ({
  status: 'idle', totalMs: 0, remainingMs: 0, endsAt: 0,
  start: minutes => {
    const s = get()
    const resume = s.status === 'paused'
    const total = resume ? s.totalMs : Math.max(1, minutes) * 60_000
    const left = resume ? s.remainingMs : total
    set({ status: 'running', totalMs: total, remainingMs: left, endsAt: Date.now() + left })
    stop()
    timer = setInterval(() => {
      const rest = Math.max(0, get().endsAt - Date.now())
      if (rest === 0) { stop(); set({ status: 'done', remainingMs: 0 }) } else set({ remainingMs: rest })
    }, 1000)
  },
  pause: () => { stop(); set(s => ({ status: 'paused', remainingMs: Math.max(0, s.endsAt - Date.now()) })) },
  reset: () => { stop(); set({ status: 'idle', remainingMs: 0 }) },
}))
