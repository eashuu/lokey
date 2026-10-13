import { NEUTRAL, Rig, type Params } from './rig'
import { POSES, STATE_POSE, type Ctx } from './poses'
import { mascot, type EmoteKind } from './bus'

export interface BrainInput {
  mode: string
  /** the notch is awake (hover/menu): the mascot may glance around and fidget */
  awake: boolean
  /** music is playing: the mascot sways instead of idling */
  music: boolean
  /** honour reduced motion: no autonomous fidgets */
  calm: boolean
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/**
 * Chooses what the mascot does: a looping state pose from the app mode, one-shot actions on request, and a little
 * autonomy (blinks, glances, fidgets) so it never looks frozen while it is on screen. Output = spring-smoothed params.
 */
export class Brain {
  readonly rig = new Rig()
  private t = 0
  private state = 'idle'
  private stateT = 0
  private one: { name: string; t0: number } | null = null
  private blink = 0
  private nextBlink = rand(1.5, 3.5)
  private nextFidget = rand(6, 12)
  private nextZ = 2
  private glance = { x: 0, y: 0, until: 0 }
  private lastMode = ''
  private out: Params = { ...NEUTRAL }

  constructor(private emit: (k: EmoteKind) => void) { this.rig.snap(NEUTRAL) }

  /** call when the mascot becomes visible again: the next idle state greets with a wave */
  wake() { this.lastMode = '' }

  play(name: string) {
    const p = POSES[name]
    if (!p) return
    this.one = { name, t0: this.t }
    if (p.emote) this.emit(p.emote)
  }

  private enterState(name: string) {
    this.state = name
    this.stateT = 0
    const e = POSES[name]?.emote
    if (e && name !== 'sleep') this.emit(e)
    this.nextZ = 1.2
  }

  update(dt: number, inp: BrainInput): Params {
    this.t += dt
    this.stateT += dt

    // state pose from the app mode (music turns plain idling into swaying)
    if (inp.mode !== this.lastMode) {
      const first = this.lastMode === ''
      const was = this.lastMode
      this.lastMode = inp.mode
      if ((first || was === 'MUTED') && inp.mode === 'LISTENING' && !inp.calm) this.play('wave') // woke up: say hi
    }
    let want = STATE_POSE[inp.mode] ?? 'idle'
    if (want === 'idle' && inp.music && inp.awake) want = 'hum'
    if (want !== this.state) this.enterState(want)

    // finished one-shots hand control back
    if (this.one && this.t - this.one.t0 > (POSES[this.one.name].dur ?? 1.5)) this.one = null
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

    const fresh = performance.now() - mascot.levelAt < 300
    const level = this.state === 'hear' ? (fresh ? mascot.level : 0) : this.state === 'talk' ? (fresh ? mascot.level : 0.25 + 0.4 * Math.abs(Math.sin(this.t * 7.3)) * (0.6 + 0.4 * Math.sin(this.t * 2.1))) : 0
    const ctx: Ctx = { gx, gy, level }

    // idle fidgets
    if (!inp.calm && inp.awake && !this.one && this.state === 'idle') {
      this.nextFidget -= dt
      if (this.nextFidget <= 0) {
        const pick = ['lookaround', 'tilt', 'stretch', 'bounce', 'spin', 'peek']
        this.play(pick[Math.floor(Math.random() * pick.length)])
        this.nextFidget = rand(7, 14)
      }
    }
    if (this.state === 'sleep') {
      this.nextZ -= dt
      if (this.nextZ <= 0) { this.emit('sleep'); this.nextZ = 3.4 }
    }

    // compose the target: neutral + eye contact + state pose + one-shot (which wins where it speaks)
    const pose = this.one ? POSES[this.one.name] : POSES[this.state]
    const lt = this.one ? this.t - this.one.t0 : this.stateT
    const tgt: Params = { ...NEUTRAL, yaw: gx * 0.32, pitch: -gy * 0.14, gazeX: gx, gazeY: gy }
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
