import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Brain } from '@/mascot/brain'
import { mascot } from '@/mascot/bus'
import { Emotes } from '@/mascot/Emotes'
import { MascotGL } from '@/mascot/gl'
import { useData } from '@/lib/data'
import { prefersReducedMotion } from '@/lib/platform'
import { DEFAULT_PALETTE, Soul2D } from '@/island/Soul2D'
import { skinPalette } from '@/island/skins'
import { reactToPoke } from '@/island/reactions'
import type { SoulMode } from '@/island/store'

// One spirit for the whole phone UI. The character is raymarched by ONE WebGL2 context (mascot/gl.ts) on an off-screen canvas, one
// draw per frame; every place that shows the spirit (the big one on Home, the loadout, the capsule's face, the cards) is a plain
// 2D canvas that receives a copy (drawImage) of that frame, whole or cropped to the face. One Brain arbitrates every pose and emote
// (mascot/brain.ts, priorities and cooldowns), the same bus the desktop uses. Nothing renders while no spirit is on screen.
// Frame rate: 60 fps (DPR capped at 2); if frames start to take longer than ~24 ms it drops to 30 and tries 60 again later.
// Settings.phone.spirit = 'calm' (or reduced motion) keeps 30 fps and tells the Brain to skip idle fidgets.

interface Sub { cv: HTMLCanvasElement; w: number; h: number; render: number; crop: [number, number, number, number] | null }

/** the spirit's mode is derived from the app state (voice, dictation...); the loadout page can override it to preview a state */
export const useSpirit = create<{ mode: SoulMode; override: SoulMode | null; setMode: (m: SoulMode) => void; setOverride: (m: SoulMode | null) => void }>(set => ({
  mode: 'LISTENING', override: null, setMode: mode => set({ mode }), setOverride: override => set({ override }),
}))

let failed = false // WebGL2 or the shader is unavailable: the 2D drawing takes over
const subs = new Set<Sub>()
let gl: MascotGL | null = null
let off: HTMLCanvasElement | null = null
let brain: Brain | null = null
let raf = 0
let offBus: (() => void) | null = null
let idleTimer: ReturnType<typeof setTimeout> | undefined
let slow = false, slowSince = 0, ema = 16, last = 0
let t0 = 0
export const spiritStats = { fps: 0, slow: false }

/** a small PNG of the live spirit for the native pill (island.update.spirit): taken from the same canvas, at most ~8 per second, only while wanted */
export const snap = { want: false, url: '', at: 0 }
const snapListeners = new Set<() => void>()
export const onSnapshot = (cb: () => void) => { snapListeners.add(cb); return () => { snapListeners.delete(cb) } }
let snapCv: HTMLCanvasElement | null = null
let bgTimer: ReturnType<typeof setInterval> | undefined
function takeSnap(now: number, S: number) {
  if (!snap.want || !off || now - snap.at < 125) return
  snap.at = now
  snapCv ??= Object.assign(document.createElement('canvas'), { width: 96, height: 96 })
  const g = snapCv.getContext('2d')
  if (!g) return
  g.clearRect(0, 0, 96, 96)
  g.drawImage(off, 0.14 * S, 0.2 * S, 0.72 * S, 0.72 * S, 0, 0, 96, 96)
  snap.url = snapCv.toDataURL('image/png')
  snapListeners.forEach(f => f())
}

function frame(now: number) {
  raf = requestAnimationFrame(frame)
  step(now)
}
function step(now: number) {
  const st = useData.getState()
  const calm = st.settings.phone?.spirit === 'calm' || st.settings.appearance.reduceMotion || prefersReducedMotion()
  const gap = now - last
  if (gap < (slow || calm ? 30 : 15)) return
  if (!gl || !off || !brain) return
  try { if (!gl.ready()) return } catch (e) { console.warn('3D spirit unavailable, using 2D:', e); failed = true; stop(); subs.forEach(s => s.cv.dispatchEvent(new Event('spirit-fail'))); return }
  const dt = Math.min(0.05, last ? gap / 1000 : 0.016)
  last = now
  // adaptive rate: judge the gap between frames while running at full speed
  if (gap > 250) ema = 16 // the page was hidden or paused: that is not a slow GPU
  else if (!slow && !calm) {
    ema += (gap - ema) * 0.08
    if (ema > 24) { slow = true; slowSince = now }
  } else if (slow && !calm && now - slowSince > 15_000) { slow = false; ema = 16 }
  spiritStats.fps = gap > 0 ? Math.round(1000 / gap) : 0; spiritStats.slow = slow

  let px = 0
  for (const s of subs) px = Math.max(px, s.render)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const S = Math.max(64, Math.round(px * dpr))
  gl.resize(S, S)
  const sp = useSpirit.getState()
  const mode = sp.override ?? sp.mode
  const music = !!st.media?.hasSession && !!st.media.playing
  const P = brain.update(dt, { mode, awake: mode !== 'MUTED', music, calm })
  const pal = skinPalette(st.settings.loadout?.soul)
  gl.draw(P, { top: pal.top, bottom: pal.bottom, glow: pal.glow, ink: pal.ink, foot: pal.foot ?? pal.bottom, form: pal.form ?? 0 }, (now - t0) / 1000, 1, 1.08)
  for (const s of subs) {
    const g = s.cv.getContext('2d')
    if (!g) continue
    const tw = Math.round(s.w * dpr), th = Math.round(s.h * dpr)
    if (s.cv.width !== tw || s.cv.height !== th) { s.cv.width = tw; s.cv.height = th }
    g.clearRect(0, 0, tw, th)
    if (s.crop) g.drawImage(off, s.crop[0] * S, s.crop[1] * S, s.crop[2] * S, s.crop[3] * S, 0, 0, tw, th)
    else g.drawImage(off, 0, 0, S, S, 0, 0, tw, th)
  }
  takeSnap(now, S)
}

function start() {
  clearTimeout(idleTimer)
  if (raf || failed) return
  try {
    if (!gl) { off = document.createElement('canvas'); off.width = off.height = 128; gl = new MascotGL(off) }
  } catch (e) { console.warn('3D spirit unavailable, using 2D:', e); failed = true; return }
  brain ??= new Brain(k => mascot.emote(k))
  brain.wake()
  offBus = mascot.on(e => { if (e.type === 'play') brain?.play(e.name, e.opts) })
  t0 = performance.now(); last = 0; ema = 16; slow = false
  raf = requestAnimationFrame(frame)
  // a hidden WebView stops animation frames; the native pill still needs a live spirit, so a slow timer drives the same step
  bgTimer ??= setInterval(() => { if (document.hidden && snap.want && subs.size) step(performance.now()) }, 250)
}
function stop() {
  clearInterval(bgTimer); bgTimer = undefined
  cancelAnimationFrame(raf); raf = 0
  offBus?.(); offBus = null
  // the context is kept for a few seconds (page changes remount the spirit), then released
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { if (!subs.size) { gl?.dispose(); gl = null; off = null } }, 6000)
}

type Skins = Record<string, { palette: { top: string; bottom: string; glow: string; ink: string; foot?: string; form?: number } }>
const thumbCache = new Map<string, string>()
/** one small still of the spirit per skin (the loadout's skin grid), drawn with the same single context instead of one WebGL context per skin */
export async function skinThumbs(skins: Skins, px = 96): Promise<Record<string, string>> {
  const key = (id: string) => `${id}:${px}`
  const missing = Object.keys(skins).filter(id => !thumbCache.has(key(id)))
  if (missing.length) {
    start()
    try {
      for (let i = 0; i < 100 && !(gl && off); i++) await new Promise(r => setTimeout(r, 30))
      for (let i = 0; i < 200 && gl && !gl.ready(); i++) await new Promise(r => setTimeout(r, 30))
      if (gl && off) {
        const b = new Brain(() => undefined)
        const S = Math.round(px * Math.min(window.devicePixelRatio || 1, 2))
        gl.resize(S, S)
        for (const id of missing) {
          for (let k = 0; k < 14; k++) b.update(0.033, { mode: 'LISTENING', awake: true, music: false, calm: true })
          const P = b.update(0.033, { mode: 'LISTENING', awake: true, music: false, calm: true })
          const p = skins[id].palette
          gl.draw(P, { top: p.top, bottom: p.bottom, glow: p.glow, ink: p.ink, foot: p.foot ?? p.bottom, form: p.form ?? 0 }, 1, 1, 1.08)
          thumbCache.set(key(id), off.toDataURL('image/png')) // same task as the draw: the buffer is still there
        }
      }
    } catch (e) { console.warn('skin thumbnails unavailable', e) }
    if (!subs.size) stop()
  }
  return Object.fromEntries(Object.keys(skins).map(id => [id, thumbCache.get(key(id)) ?? '']))
}

const to2d = (m: SoulMode) => (m === 'HEARING' ? 'LISTENING' : m === 'WRITING' || m === 'LOOKING' ? 'THINKING' : m)

/**
 * The spirit. `face` shows only the head (for the capsule and the cards), otherwise the whole character.
 * `poke`: tap = a poke reaction (hop, startled squeak when poked repeatedly, a heart); pointer moves make it look at you.
 */
export function Spirit({ size, face = false, emotes = false, poke = false, active = true }: { size: number; face?: boolean; emotes?: boolean; poke?: boolean; active?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [fail, setFail] = useState(failed)
  const skin = useData(s => s.settings.loadout?.soul)
  const mode = useSpirit(s => s.override ?? s.mode)

  useEffect(() => {
    const cv = ref.current
    if (!cv || !active || fail) return
    const sub: Sub = { cv, w: size, h: size, render: face ? 110 : size, crop: face ? [0.24, 0.32, 0.52, 0.52] : null }
    subs.add(sub)
    start()
    const onFail = () => setFail(true)
    cv.addEventListener('spirit-fail', onFail)
    let px = NaN, py = NaN
    const onMove = (e: PointerEvent) => { px = e.clientX; py = e.clientY }
    let look = 0
    if (!face) {
      window.addEventListener('pointermove', onMove, { passive: true })
      look = window.setInterval(() => {
        if (px !== px) return
        const r = cv.getBoundingClientRect()
        mascot.look((px - (r.left + r.width / 2)) / Math.max(120, r.width * 0.9), -(py - (r.top + r.height * 0.55)) / Math.max(90, r.height * 1.2))
        px = NaN
      }, 80)
    }
    if (failed) setFail(true)
    return () => {
      subs.delete(sub)
      cv.removeEventListener('spirit-fail', onFail)
      window.removeEventListener('pointermove', onMove); clearInterval(look)
      if (!subs.size) stop()
    }
  }, [size, face, active, fail])

  const pal = skinPalette(skin)
  return (
    <div onPointerDown={poke ? () => reactToPoke() : undefined} style={{ position: 'relative', width: size, height: size, flex: 'none', touchAction: poke ? 'manipulation' : undefined }}>
      {fail ? <Soul2D width={size} height={size} mode={to2d(mode)} active={active} palette={pal ?? DEFAULT_PALETTE} /> : <canvas ref={ref} aria-hidden style={{ width: size, height: size, display: 'block' }} />}
      {emotes && <Emotes width={size} height={size} />}
    </div>
  )
}
