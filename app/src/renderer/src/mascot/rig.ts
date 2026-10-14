// Numeric skeleton of the mascot. Every value is spring-damped towards a target each frame, so poses only have to say
// where things should be; overshoot, settle and anticipation come from the springs.

export const KEYS = [
  'yaw', 'pitch', 'roll', 'squash',            // body turn (radians) and squash/stretch (+ = squash)
  'leanX', 'hop', 'scale', 'tip',              // sideways lean, jump height 0..1, size, curl of the head tip
  'aLr', 'aLf', 'aLb', 'aLo',                  // left arm (screen left): raise 0..1, forward -1..1, elbow bend 0..1, hand open
  'aRr', 'aRf', 'aRb', 'aRo',                  // right arm (screen right)
  'eyeL', 'eyeR', 'gazeX', 'gazeY',            // eye openness (0..1.3), where the pupils look (-1..1, +y = up)
  'browL', 'browR', 'browAng', 'happy',        // brow height, brow tilt (+ = sad), "^ ^" eyes 0..1
  'smile', 'mouthOpen', 'mouthRound', 'wobble', // mouth: -1 frown .. 1 grin, open 0..1, O shape 0..1, trembling 0..1
  'blush',
  'puff',                                       // inflate 0..1 (the round body swells; used by inhale / celebrate)
  'lower', 'feet',                             // posture: body sinks toward the floor 0..1; feet 0 = standing, +1 = stretched out in front (sitting), -1 = tucked up (jumping)
] as const
export type Key = (typeof KEYS)[number]
export type Params = Record<Key, number>

export const NEUTRAL: Params = {
  yaw: 0, pitch: 0, roll: 0, squash: 0, leanX: 0, hop: 0, scale: 1, tip: 0,
  aLr: 0.04, aLf: 0, aLb: 0.1, aLo: 0, aRr: 0.04, aRf: 0, aRb: 0.1, aRo: 0,
  eyeL: 1, eyeR: 1, gazeX: 0, gazeY: 0,
  browL: 0, browR: 0, browAng: 0, happy: 0,
  smile: 0.45, mouthOpen: 0, mouthRound: 0, wobble: 0,
  blush: 0.25,
  puff: 0.1, lower: 0, feet: 0,
}

// [angular frequency, damping ratio]; < 1 overshoots (bouncy), 1 settles without overshoot
const DEFAULT: [number, number] = [24, 0.72]
const SPRING: Partial<Record<Key, [number, number]>> = {
  hop: [40, 0.42], squash: [32, 0.45], scale: [30, 0.55], tip: [20, 0.4],
  eyeL: [46, 1], eyeR: [46, 1], mouthOpen: [36, 0.85], mouthRound: [30, 0.9], smile: [28, 0.8],
  gazeX: [22, 0.9], gazeY: [22, 0.9], happy: [30, 0.9], blush: [10, 1], wobble: [20, 1],
  puff: [20, 0.45], lower: [22, 0.7], feet: [26, 0.6],
  aLr: [30, 0.55], aRr: [30, 0.55], aLb: [32, 0.6], aRb: [32, 0.6],
}

export class Rig {
  v: Params = { ...NEUTRAL }
  readonly vel: Params = Object.fromEntries(KEYS.map(k => [k, 0])) as Params

  /** Advance every value towards `target`; semi-implicit Euler in small steps so stiff springs stay stable. */
  step(target: Params, dt: number) {
    let left = Math.min(dt, 0.05)
    while (left > 1e-5) {
      const h = Math.min(left, 0.006)
      left -= h
      for (const k of KEYS) {
        const [w, z] = SPRING[k] ?? DEFAULT
        const a = w * w * (target[k] - this.v[k]) - 2 * z * w * this.vel[k]
        this.vel[k] += a * h
        this.v[k] += this.vel[k] * h
      }
    }
  }

  /** after a spin or roll the body is at 2*pi; the target is 0, so without this it would unwind a full turn backwards */
  wrapTurns() {
    for (const k of ['yaw', 'roll'] as const) {
      const n = Math.round(this.v[k] / (2 * Math.PI))
      if (n) this.v[k] -= n * 2 * Math.PI
    }
  }

  snap(p: Params) {
    for (const k of KEYS) { this.v[k] = p[k]; this.vel[k] = 0 }
  }
}
