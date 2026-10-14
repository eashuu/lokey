import { NEUTRAL, Rig, type Params } from './rig'
import { POSES, STATE_POSE, type Ctx } from './poses'
import { mascot, type EmoteKind, type PlayOpts, type Prio } from './bus'

export interface BrainInput {
  mode: string
  /** the notch is awake (hover/menu): the mascot may glance around and fidget */
  awake: boolean
  /** music is playing: the mascot sways instead of idling */
  music: boolean
  /** honour reduced motion: no autonomous fidgets */
  calm: boolean
  /** false = never start a fidget on its own (deterministic captures) */
  fidget?: boolean
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** states where the mascot is part of a conversation: nothing ambient may play over them */
const VOICE_STATES = new Set(['hear', 'think', 'talk', 'look', 'write'])
/** short acknowledgements that may still play over a voice state (below critical priority) */
const OK_IN_VOICE = new Set(['nod', 'bounce', 'shrug'])
/** minimum seconds between two plays of the same action, by priority */
const COOLDOWN: Record<Prio, number> = { 3: 0.3, 2: 1.2, 1: 0 }
let lastWaveAt = -1e9 // wall clock: a wave on every re-appearance is too much

/**
 * Chooses what the mascot does: a looping state pose from the app mode, one-shot actions on request, and a little
 * autonomy (blinks, glances, fidgets) so it never looks frozen while it is on screen. Output = spring-smoothed params.
 */
export class Brain {
  readonly rig = new Rig()
  private t = 0
  private state = 'idle'
  private stateT = 0
  private one: { name: string; t0: number; prio: Prio } | null = null
  private pending: { name: string; prio: Prio; at: number } | null = null
  private lastPlayed = new Map<string, number>()
  private lastEmoteT = -1e9
  private blink = 0
  private nextBlink = rand(1.5, 3.5)
  private nextFidget = rand(6, 12)
  private nextZ = 2
  private glance = { x: 0, y: 0, until: 0 }
  private lastMode = ''
  private out: Params = { ...NEUTRAL }
  private gz = { x: 0, y: 0 }
  private idleFor = 0

  constructor(private emit: (k: EmoteKind) => void) { this.rig.snap(NEUTRAL) }

  /** a one-shot action is running */
  get busy() { return !!this.one }
  /** end the running one-shot now (the springs ease back to the state pose) */
  cancel() { this.one = null; this.pending = null }

  /** call when the mascot becomes visible again */
  wake() { this.lastMode = '' }

  /**
   * Ask for a one-shot action. Priorities keep things from fighting: a higher one cuts in, an equal or lower one waits its turn (one
   * slot, the latest wins) or is dropped, a repeat of the same action inside its cooldown is ignored, and while the mascot is in a
   * voice state only critical actions and short acknowledgements play.
   */
  play(name: string, opts?: PlayOpts) {
    const p = POSES[name]
    if (!p) return
    const prio = opts?.prio ?? 2
    if (this.t - (this.lastPlayed.get(name) ?? -1e9) < COOLDOWN[prio]) return
    if (VOICE_STATES.has(this.state) && prio < 3 && !OK_IN_VOICE.has(name)) return
    const cur = this.one
    if (cur) {
      const progress = (this.t - cur.t0) / (POSES[cur.name].dur ?? 1.5)
      const cuts = prio > cur.prio || (prio === cur.prio && progress > 0.6)
      if (!cuts) { if (prio >= 2) this.pending = { name, prio, at: this.t }; return }
    }
    this.start(name, prio)
  }

  private start(name: string, prio: Prio) {
    this.one = { name, t0: this.t, prio }
    this.pending = null
    this.lastPlayed.set(name, this.t)
    const e = POSES[name]?.emote
    if (e) { this.emit(e); this.lastEmoteT = this.t }
  }

  private enterState(name: string) {
    this.state = name
    this.stateT = 0
    const e = POSES[name]?.emote
    // the state's emote is skipped when an action just showed one (no stacks of icons)
    if (e && name !== 'sleep' && this.t - this.lastEmoteT > 0.4) { this.emit(e); this.lastEmoteT = this.t }
    this.nextZ = 1.2
    // entering a conversation state: ambient actions (sit, lie down, a stretch...) are cut, anything queued is dropped
    if (VOICE_STATES.has(name)) { if (this.one && this.one.prio < 3) this.one = null; this.pending = null }
  }

  update(dt: number, inp: BrainInput): Params {
    this.t += dt
    this.stateT += dt

    // state pose from the app mode (music turns plain idling into swaying)
    if (inp.mode !== this.lastMode) {
      const first = this.lastMode === ''
      const was = this.lastMode
      this.lastMode = inp.mode
      if ((first || was === 'MUTED') && inp.mode === 'LISTENING' && !inp.calm && performance.now() - lastWaveAt > 60_000) { lastWaveAt = performance.now(); this.play('wave', { prio: 1 }) } // woke up: say hi, but not every time
    }
    let want = STATE_POSE[inp.mode] ?? 'idle'
    if (want === 'idle' && inp.music && inp.awake) want = 'hum'
    if (want !== this.state) this.enterState(want)

    // finished one-shots hand control back
    if (this.one && this.t - this.one.t0 > (POSES[this.one.name].dur ?? 1.5)) {
      this.one = null
      this.rig.wrapTurns()
      const q = this.pending
      if (q && this.t - q.at < 2 && !(VOICE_STATES.has(this.state) && q.prio < 3 && !OK_IN_VOICE.has(q.name))) this.start(q.name, q.prio)
      this.pending = null
    }
    // a yawn that is a state (mode YAWNING) is just the looping pose; keep it alive

    // eye contact: pointer when seen recently, otherwise a slow wander
    const g = mascot.gaze
    let gx = 0
    let gy = 0
    if (performance.now() - g.at < 2500) { gx = g.x; gy = g.y }
    else if (inp.awake) {
      if (this.t > this.glance.until) {
        this.glance = { x: Math.random() < 0.4 ? 0 : rand(-0.6, 0.6), y: rand(-0.15, 0.25), until: this.t + rand(1.4, 4) }
      }
      gx = this.glance.x; gy = this.glance.y
    }

    this.gz.x += (gx - this.gz.x) * Math.min(1, dt * 4)
    this.gz.y += (gy - this.gz.y) * Math.min(1, dt * 4)
    gx = this.gz.x; gy = this.gz.y

    const fresh = performance.now() - mascot.levelAt < 300
    const level = this.state === 'hear' ? (fresh ? mascot.level : 0) : this.state === 'talk' ? (fresh ? mascot.level : 0.25 + 0.4 * Math.abs(Math.sin(this.t * 7.3)) * (0.6 + 0.4 * Math.sin(this.t * 2.1))) : 0
    const ctx: Ctx = { gx, gy, level }

    // idle fidgets; a long quiet spell ends with sitting down and, much later, lying down
    if (this.one || this.state !== 'idle') this.idleFor = 0
    else this.idleFor += dt
    if (!inp.calm && inp.awake && inp.fidget !== false && !this.one && this.state === 'idle') {
      this.nextFidget -= dt
      if (this.nextFidget <= 0) {
        const long = this.idleFor > 70
        const pick = long ? ['sit', 'lie'] : this.idleFor > 25 ? ['sit', 'stand', 'jump', 'lookaround'] : ['lookaround', 'tilt', 'stretch', 'jump', 'peek', 'stand', 'waddle', 'inhale']
        this.play(pick[Math.floor(Math.random() * pick.length)], { prio: 1 })
        this.nextFidget = rand(8, 15)
      }
    }
    if (this.state === 'sleep') {
      this.nextZ -= dt
      if (this.nextZ <= 0) { this.emit('sleep'); this.nextZ = 3.4 }
    }

    // compose the target: neutral + eye contact + state pose + one-shot (which wins where it speaks)
    const pose = this.one ? POSES[this.one.name] : POSES[this.state]
    const lt = this.one ? this.t - this.one.t0 : this.stateT
    const tgt: Params = { ...NEUTRAL, yaw: gx * 0.2, pitch: -gy * 0.1, gazeX: gx, gazeY: gy }
    Object.assign(tgt, POSES[this.state].f(this.stateT, ctx))
    if (this.one) Object.assign(tgt, pose.f(lt, ctx))
    if (inp.calm) { tgt.hop *= 0.3; tgt.tip *= 0.3 }
    this.rig.step(tgt, dt)

    // blinking sits on top of the springs (instant); never while the pose keeps the eyes shut
    this.nextBlink -= dt
    if (this.nextBlink <= 0) { this.blink = 1; this.nextBlink = rand(2.2, 5.5) }
    this.blink = Math.max(0, this.blink - dt * 8)
    const b = Math.sin(Math.min(1, this.blink) * Math.PI)
    Object.assign(this.out, this.rig.v)
    this.out.eyeL *= 1 - b * 0.95
    this.out.eyeR *= 1 - b * 0.95
    return this.out
  }
}
