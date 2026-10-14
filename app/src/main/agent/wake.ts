import { settings } from '../settings'
import type { Sidecar } from '../sidecar'
import type { Agent } from './agent'

// Wake-up: keeps the sidecar's listener (claps, phrases) in line with the settings, pauses it while Lokey itself is talking or
// being talked to (so it never wakes itself up), and turns a detection into "start a conversation" (with the right greeting).
export type WakeAction = 'listen' | 'greet' | 'welcome'

export class Wake {
  private paused = false
  private resumeTimer: ReturnType<typeof setTimeout> | null = null
  private lastSig = ''

  constructor(private sidecar: Sidecar, private agent: Agent) {
    // never listen for the wake-up while the assistant is working with the microphone or speakers
    agent.on('state', (s: string) => {
      if (s !== 'idle') { this.setPaused(true); return }
      if (this.resumeTimer) clearTimeout(this.resumeTimer)
      this.resumeTimer = setTimeout(() => this.setPaused(false), 1200) // let the tail of its own voice die out first
      this.resumeTimer.unref?.()
    })
    sidecar.onEvent('wake.detected', d => this.onDetected(d))
  }

  private setPaused(p: boolean) { if (this.paused !== p) { this.paused = p; void this.apply(true) } }

  /** push the current settings to the listener (only when something that matters changed, unless `force`) */
  async apply(force = false) {
    if (!this.sidecar.ready) return
    const w = settings.value.wake
    const on = w.enabled
    const cfg = { claps: on && w.claps, phrases: on && w.phrases ? w.list.map(x => x.text).filter(Boolean) : [], confidence: w.confidence, clapSensitivity: w.clapSensitivity, paused: this.paused }
    const sig = JSON.stringify(cfg)
    if (!force && sig === this.lastSig) return
    this.lastSig = sig
    await this.sidecar.call('wake.set', cfg).catch(() => undefined)
  }

  status() { return this.sidecar.call('wake.status', {}).catch(() => ({ listening: false, speech: false, claps: false, recogniser: null, error: 'the helper is not running', available: false })) }

  private onDetected(d: { kind: 'clap' | 'phrase'; phrase: string | null; confidence: number }) {
    if (!settings.value.wake.enabled || this.paused) return
    const action: WakeAction = d.kind === 'clap' ? 'listen' : settings.value.wake.list.find(x => x.text.toLowerCase() === (d.phrase ?? '').toLowerCase())?.action ?? 'listen'
    void this.agent.wake(action, d.phrase ?? 'a clap')
  }
}
