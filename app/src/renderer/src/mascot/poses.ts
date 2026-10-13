import type { Params } from './rig'
import type { EmoteKind } from './bus'

// Poses are functions of time: `f(t, ctx)` returns the targets (only the values it cares about; the rest fall back to
// neutral + eye contact). The rig's springs turn that into motion. `dur` makes a pose a one-shot action.

export interface Ctx { gx: number; gy: number; level: number }
export interface Pose { dur?: number; emote?: EmoteKind; f: (t: number, c: Ctx) => Partial<Params> }

const TAU = Math.PI * 2
const s = Math.sin
const decay = (t: number, k: number) => Math.exp(-t * k)
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
/** 0 -> 1 -> 0 over `dur` */
const bell = (t: number, dur: number) => s(Math.PI * clamp01(t / dur))

export const POSES: Record<string, Pose> = {
  // ---- states (loop until the app state changes) -----------------------------------------------------------
  idle: {
    f: (t, c) => ({
      squash: s(t * 1.9) * 0.028, puff: 0.12 + 0.1 * s(t * 1.9), roll: s(t * 0.8) * 0.035 + c.gx * -0.05, tip: s(t * 1.5) * 0.5,
      aLr: 0.06 + s(t * 1.7) * 0.035, aRr: 0.06 + s(t * 1.7 + 1) * 0.035, smile: 0.5, blush: 0.28,
    }),
  },
  sleep: {
    emote: 'sleep',
    f: t => ({
      pitch: 0.38, squash: 0.14 + s(t * 0.9) * 0.035, roll: 0.07, tip: -0.7, eyeL: 0, eyeR: 0, gazeX: 0, gazeY: -0.4,
      smile: 0.15, aLr: 0, aRr: 0, aLb: 0.3, aRb: 0.3, blush: 0.2, yaw: 0, hop: 0,
    }),
  },
  hear: {
    emote: 'alert',
    f: (t, c) => ({
      roll: 0.11 + s(t * 2.1) * 0.02, yaw: c.gx * 0.2, tip: 1 + s(t * 3) * 0.2 + c.level * 1.5, squash: -0.06 - c.level * 0.08, hop: c.level * 0.12, eyeL: 1.18 + c.level * 0.1, eyeR: 1.18 + c.level * 0.1, browL: 0.55, browR: 0.55,
      aLr: 0.28, aLb: 0.95, aLf: 0.5, aRr: 0.05, smile: 0.25, mouthRound: 0.15, mouthOpen: 0.1 + c.level * 0.2, blush: 0.3,
      gazeX: c.gx * 0.5, gazeY: 0.1,
    }),
  },
  think: {
    emote: 'think',
    f: t => ({
      gazeX: -0.55, gazeY: 0.75, yaw: 0.28 + s(t * 0.9) * 0.1, roll: s(t * 1.1) * 0.09 - 0.05, pitch: -0.1,
      aRr: 0.42, aRb: 1.05, aRf: 0.9, aRo: 0.2, aLr: 0.05, smile: 0.0, mouthRound: 0.35, mouthOpen: 0.12,
      browL: 0.4, browR: 0.1, browAng: -0.3, tip: s(t * 1.3) * 0.9, squash: s(t * 2) * 0.03, eyeL: 1, eyeR: 0.9,
    }),
  },
  talk: {
    f: (t, c) => {
      const m = c.level
      return {
        mouthOpen: m, mouthRound: 0.15 + 0.5 * Math.max(0, s(t * 2.3)) * m, smile: 0.35,
        yaw: s(t * 1.7) * 0.16 + c.gx * 0.2, roll: s(t * 2.3) * 0.05, hop: Math.abs(s(t * 5.4)) * 0.045 * (0.4 + m),
        squash: m * 0.06, aLr: 0.12 + Math.max(0, s(t * 2.9)) * 0.38, aLf: 0.4, aLb: 0.5 + s(t * 2.9) * 0.3,
        aRr: 0.12 + Math.max(0, s(t * 2.5 + 1.7)) * 0.34, aRf: 0.4, aRb: 0.5 + s(t * 2.5) * 0.3, browL: 0.15 + m * 0.3, browR: 0.15 + m * 0.3,
        tip: s(t * 3.1) * 0.6, blush: 0.35,
      }
    },
  },
  yawn: {
    dur: 2.4,
    f: t => {
      const b = bell(t, 2.4)
      return {
        mouthOpen: b, mouthRound: 0.5, eyeL: 1 - b * 0.95, eyeR: 1 - b * 0.95, pitch: -0.22 * b, squash: -0.14 * b, aLr: 0.1 + b * 0.85, aRr: 0.1 + b * 0.85,
        aLb: 0.2, aRb: 0.2, smile: 0, browL: 0.3 * b, browR: 0.3 * b, tip: b * -0.6, hop: 0,
      }
    },
  },
  write: {
    emote: 'write',
    f: (t, c) => ({
      gazeX: 0.1, gazeY: -0.6, pitch: 0.18, yaw: c.gx * 0.1, aRr: 0.46, aRf: 0.9, aRb: 0.55 + s(t * 21) * 0.18, aRo: 0.1, aLr: 0.2, aLf: 0.6, aLb: 0.9,
      smile: 0.25, mouthRound: 0.1, browL: -0.2, browR: -0.2, browAng: -0.2, squash: s(t * 2) * 0.02, roll: 0.04, eyeL: 0.85, eyeR: 0.85,
    }),
  },
  look: {
    emote: 'search',
    f: (t, c) => ({
      yaw: s(t * 1.6) * 0.5, gazeX: s(t * 1.6) * 0.8, gazeY: -0.1, aRr: 0.6, aRb: 1.15, aRf: 0.7, aLr: 0.08, eyeL: 0.8, eyeR: 0.8,
      browL: -0.3, browR: -0.3, smile: 0.1, pitch: 0.05 + c.gy * -0.05, roll: s(t * 1.6) * -0.06, squash: s(t * 2.2) * 0.02,
    }),
  },
  hum: {
    emote: 'music',
    f: t => ({
      roll: s(t * 2.4) * 0.2, yaw: s(t * 1.2) * 0.2, hop: Math.abs(s(t * 2.4)) * 0.07, squash: Math.abs(s(t * 2.4)) * -0.05 + 0.02,
      happy: 0.55, eyeL: 0.55, eyeR: 0.55, smile: 0.95, mouthRound: 0.25, mouthOpen: 0.1 + Math.abs(s(t * 2.4)) * 0.1,
      aLr: 0.22 + s(t * 2.4) * 0.12, aRr: 0.22 - s(t * 2.4) * 0.12, aLb: 0.5, aRb: 0.5, tip: s(t * 2.4) * 1.1, blush: 0.5,
    }),
  },
  muted: {
    emote: 'muted',
    f: t => ({ eyeL: 0.45, eyeR: 0.45, smile: -0.05, pitch: 0.12, squash: 0.06 + s(t * 1.2) * 0.02, aLr: 0.02, aRr: 0.02, tip: -0.3, blush: 0.15, gazeY: -0.3 }),
  },

  // ---- one-shot actions --------------------------------------------------------------------------------------
  wave: {
    dur: 1.5, emote: 'wave',
    f: (t, c) => {
      const up = clamp01(t / 0.18) * clamp01((1.5 - t) / 0.25)
      return {
        aRr: 0.85 * up + 0.04, aRb: 0.35 + s(t * 12) * 0.28 * up, aRf: 0.15, aRo: up, smile: 1, happy: 0.55 * up, yaw: 0.14 + c.gx * 0.1, roll: 0.07 * up,
        hop: 0.05 * Math.abs(s(t * 6)) * up, blush: 0.5, mouthOpen: 0.15 * up, tip: s(t * 6) * 0.6,
      }
    },
  },
  nod: {
    dur: 1,
    f: t => ({ pitch: s(t * 11) * 0.3 * decay(t, 2.6), smile: 0.9, squash: -s(t * 11) * 0.05 * decay(t, 2.6), happy: 0.4 * bell(t, 1), blush: 0.4 }),
  },
  shake: {
    dur: 1.1,
    f: t => ({ yaw: s(t * 14) * 0.55 * decay(t, 2.8), smile: -0.2, eyeL: 0.8, eyeR: 0.8, roll: s(t * 14) * -0.08 * decay(t, 2.8) }),
  },
  shrug: {
    dur: 1.5, emote: 'sweat',
    f: t => {
      const b = clamp01(t / 0.2) * clamp01((1.5 - t) / 0.3)
      return {
        aLr: 0.34 * b + 0.04, aRr: 0.34 * b + 0.04, aLb: 0.85 * b, aRb: 0.85 * b, aLo: b, aRo: b, squash: 0.12 * b, roll: -0.1 * b, smile: -0.35 * b + 0.2,
        browL: 0.5 * b, browR: 0.5 * b, browAng: 0.55 * b, eyeL: 0.9, eyeR: 0.9, mouthOpen: 0, wobble: 0.5 * b, tip: -0.5 * b, gazeX: 0.4 * b, blush: 0.4,
      }
    },
  },
  celebrate: {
    dur: 1.7, emote: 'success',
    f: t => {
      const hop = Math.abs(s(t * 7.5)) * clamp01((1.7 - t) / 0.4)
      return {
        hop: hop * 0.95, squash: (1 - hop) * 0.12 - hop * 0.12, aLr: 0.98, aRr: 0.98, aLb: 0.1, aRb: 0.1, aLo: 1, aRo: 1, aLf: 0.2, aRf: 0.2,
        happy: 1, smile: 1, mouthOpen: 0.55, mouthRound: 0, eyeL: 0.7, eyeR: 0.7, blush: 0.85, tip: s(t * 15) * 0.9, roll: s(t * 7.5) * 0.12, browL: 0.4, browR: 0.4,
      }
    },
  },
  cheer: {
    dur: 2.2, emote: 'success',
    f: t => ({
      hop: Math.abs(s(t * 5)) * 0.55, aLr: 0.8 + s(t * 10) * 0.18, aRr: 0.8 - s(t * 10) * 0.18, aLo: 1, aRo: 1, happy: 1, smile: 1, mouthOpen: 0.5,
      roll: s(t * 5) * 0.1, blush: 0.8, tip: s(t * 10) * 0.8, squash: -Math.abs(s(t * 5)) * 0.06,
    }),
  },
  point: {
    dur: 1.8,
    f: (t, c) => {
      const b = clamp01(t / 0.2) * clamp01((1.8 - t) / 0.3)
      return {
        yaw: -0.38 * b, aRr: 0.5 * b + 0.04, aRf: 1 * b, aRb: 0, aRo: 0, gazeX: 0.5, gazeY: -0.1, leanX: 0.25 * b, smile: 0.7, roll: 0.05 * b + c.gx * 0,
        browL: 0.3, browR: 0.3,
      }
    },
  },
  search: {
    dur: 2.2, emote: 'search',
    f: (t, c) => POSES.look.f(t, c),
  },
  sad: {
    dur: 2.4, emote: 'error',
    f: t => {
      const b = clamp01(t / 0.35) * clamp01((2.4 - t) / 0.5)
      return {
        squash: 0.16 * b, pitch: 0.28 * b, smile: -0.9 * b, browAng: 0.9 * b, browL: 0.2 * b, browR: 0.2 * b, eyeL: 0.72, eyeR: 0.72, gazeY: -0.6 * b,
        tip: -1 * b, aLr: 0.0, aRr: 0.0, aLb: 0.2, aRb: 0.2, wobble: 0.8 * b, blush: 0.1, roll: 0.08 * b,
      }
    },
  },
  startled: {
    dur: 1,
    emote: 'alert',
    f: t => {
      const b = decay(t, 3.2)
      return {
        hop: 0.5 * b * Math.abs(s(t * 9)), squash: -0.2 * b, eyeL: 1.28, eyeR: 1.28, mouthRound: 1, mouthOpen: 0.75 * b + 0.2, smile: 0, browL: 0.9 * b, browR: 0.9 * b,
        aLr: 0.7 * b, aRr: 0.7 * b, aLf: 0.6, aRf: 0.6, aLo: 1, aRo: 1, tip: 1.2 * b, pitch: -0.12 * b,
      }
    },
  },
  alert: {
    dur: 1.1,
    emote: 'alert',
    f: t => ({ hop: 0.3 * decay(t, 4) * Math.abs(s(t * 9)), eyeL: 1.2, eyeR: 1.2, browL: 0.7, browR: 0.7, tip: 1.2, squash: -0.1, mouthRound: 0.6, mouthOpen: 0.25, smile: 0.1 }),
  },
  love: {
    dur: 2.2, emote: 'love',
    f: t => ({
      happy: 1, smile: 1, blush: 1, hop: 0.12 * Math.abs(s(t * 4)), aLr: 0.38, aRr: 0.38, aLb: 1.5, aRb: 1.5, aLf: 1, aRf: 1, roll: s(t * 3) * 0.1,
      squash: s(t * 8) * 0.05, tip: s(t * 4) * 0.9, mouthOpen: 0.15, eyeL: 0.8, eyeR: 0.8,
    }),
  },
  sweat: {
    dur: 1.8, emote: 'sweat',
    f: t => ({ eyeL: 0.8, eyeR: 0.8, smile: -0.2, wobble: 0.9, blush: 0.7, gazeX: 0.7, gazeY: 0.1, yaw: 0.2, roll: s(t * 20) * 0.02, aRr: 0.3, aRb: 1.2, aRf: 0.8, browAng: 0.6, browL: 0.3, browR: 0.3 }),
  },
  peek: {
    dur: 1.8,
    f: t => {
      const b = bell(t, 1.8)
      return { leanX: 0.9 * b, yaw: -0.55 * b, roll: -0.18 * b, gazeX: -0.9 * b, eyeL: 1.1, eyeR: 1.1, smile: 0.6, aLr: 0.5 * b, aLb: 0.6, aLf: 0.7, hop: 0.05 * b, blush: 0.5 }
    },
  },
  spin: {
    dur: 1.1,
    f: t => {
      const u = clamp01(t / 0.9)
      const e = u * u * (3 - 2 * u)
      return { yaw: e * TAU, hop: bell(t, 1.1) * 0.6, aLr: 0.55, aRr: 0.55, happy: 0.7, smile: 1, squash: -0.05 * bell(t, 1.1), roll: s(u * TAU) * 0.08 }
    },
  },
  stretch: {
    dur: 1.6,
    f: t => {
      const b = bell(t, 1.6)
      return { squash: -0.2 * b, aLr: 0.1 + b * 0.9, aRr: 0.1 + b * 0.9, aLb: 0.1, aRb: 0.1, eyeL: 1 - 0.8 * b, eyeR: 1 - 0.8 * b, pitch: -0.18 * b, tip: 1.2 * b, happy: 0.6 * b, smile: 0.7, mouthOpen: 0.3 * b }
    },
  },
  tilt: {
    dur: 2,
    f: t => {
      const b = bell(t, 2)
      return { roll: 0.2 * b, yaw: 0.2 * b, gazeX: 0.5 * b, gazeY: 0.3 * b, browL: 0.5 * b, browR: 0.1 * b, mouthRound: 0.2 * b, smile: 0.2, tip: 1 * b }
    },
  },
  lookaround: {
    dur: 3.2,
    f: t => {
      const a = s(t * 2.0) * bell(t, 3.2)
      return { yaw: a * 0.7, gazeX: a * 0.9, gazeY: 0.1 * s(t * 4), roll: -a * 0.06, tip: a * 0.8 }
    },
  },
  inhale: {
    dur: 2.4,
    f: t => {
      const up = clamp01(t / 0.7)
      const out = clamp01((t - 1.3) / 0.35)
      const e = up * up * (3 - 2 * up)
      return {
        puff: 1.0 * e * (1 - out), squash: -0.1 * e + 0.2 * out * (1 - clamp01((t - 1.65) / 0.4)), aLr: 0.55 * e, aRr: 0.55 * e, aLb: 0, aRb: 0, aLo: e, aRo: e,
        mouthOpen: 0.85 * e * (1 - out), mouthRound: 0.4, eyeL: 1.15, eyeR: 1.15, browL: 0.3, browR: 0.3, smile: 0.2, hop: 0.15 * out, tip: -0.8 * e, blush: 0.5,
      }
    },
  },
  waddle: {
    dur: 2.2,
    f: t => ({
      roll: s(t * 7) * 0.2, yaw: s(t * 3.5) * 0.28, hop: Math.abs(s(t * 7)) * 0.1, leanX: s(t * 3.5) * 0.4, squash: s(t * 14) * 0.04,
      aLr: 0.2 + s(t * 7) * 0.18, aRr: 0.2 - s(t * 7) * 0.18, smile: 1, happy: 0.35, blush: 0.6, tip: s(t * 7) * 0.9,
    }),
  },
  roll: {
    dur: 1.3,
    f: t => {
      const u = clamp01(t / 1.1)
      const e = u * u * (3 - 2 * u)
      return { roll: -e * TAU, leanX: s(u * Math.PI) * 0.8, hop: s(u * Math.PI) * 0.12, squash: 0.06, aLr: 0.3, aRr: 0.3, happy: 0.7, smile: 1, mouthOpen: 0.25 }
    },
  },
  belly: {
    dur: 1.6,
    f: t => ({
      hop: Math.abs(s(t * 6.5)) * 0.32 * decay(t, 0.9), squash: -s(t * 13) * 0.1 * decay(t, 1.2), aLr: 0.7, aRr: 0.7, aLb: 0.2, aRb: 0.2, aLo: 1, aRo: 1,
      happy: 1, smile: 1, mouthOpen: 0.45, blush: 0.8, puff: 0.35 + 0.2 * s(t * 6.5),
    }),
  },
  bounce: {
    dur: 0.9,
    f: t => ({ hop: Math.abs(s(t * 7)) * 0.5 * decay(t, 2), squash: -s(t * 14) * 0.08 * decay(t, 2.5), happy: 0.6, smile: 1, aLr: 0.3, aRr: 0.3, aLb: 0.4, aRb: 0.4 }),
  },
}

/** Which looping state pose each soul mode uses. */
export const STATE_POSE: Record<string, string> = {
  MUTED: 'sleep', LISTENING: 'idle', HEARING: 'hear', THINKING: 'think', TALKING: 'talk', YAWNING: 'yawn', WRITING: 'write', LOOKING: 'look',
}

/** The pose gallery shown in the Loadout window. */
export const GALLERY: { name: string; label: string }[] = [
  { name: 'wave', label: 'Wave' }, { name: 'nod', label: 'Nod' }, { name: 'shake', label: 'No' }, { name: 'shrug', label: 'Shrug' },
  { name: 'celebrate', label: 'Celebrate' }, { name: 'cheer', label: 'Cheer' }, { name: 'point', label: 'Point' }, { name: 'search', label: 'Search' },
  { name: 'sad', label: 'Sad' }, { name: 'startled', label: 'Startled' }, { name: 'love', label: 'Love' }, { name: 'sweat', label: 'Nervous' },
  { name: 'peek', label: 'Peek' }, { name: 'spin', label: 'Spin' }, { name: 'stretch', label: 'Stretch' }, { name: 'tilt', label: 'Curious' },
  { name: 'lookaround', label: 'Look around' }, { name: 'bounce', label: 'Bounce' }, { name: 'yawn', label: 'Yawn' }, { name: 'alert', label: 'Alert' },
  { name: 'inhale', label: 'Inhale' }, { name: 'waddle', label: 'Waddle' }, { name: 'roll', label: 'Roll' }, { name: 'belly', label: 'Belly bounce' },
]
