import { holdEscape, releaseEscape } from '../escape'
import { desktopCapturer, ipcMain, screen, type NativeImage } from 'electron'
import type { Agent } from './agent'
import { lassoCanvas } from './overlays'
import { settings } from '../settings'

// Circle to ask. Two ways in, one result (a whole-screen picture, a close-up of the circled part, and where it was):
//
//  TAP the chord  -> the screen dims, the pointer becomes a crosshair, and you draw a loop (or drag a rectangle with Shift)
//                    with the MOUSE. The moment you let go the microphone opens by itself and the question ends when you stop
//                    talking. Esc cancels. Nothing has to be held, nothing has to happen at the same time.
//  HOLD the chord -> the old gesture: hold the keys, draw with the pointer, ask out loud, release.
//
// The screen is grabbed BEFORE our own overlay appears, so the picture is what you were looking at.
const HOLD_MS = 250
const SAMPLE_MS = 8
const MAX_POINTS = 4000
const ARM_TIMEOUT_MS = 20_000
const WINDOW_KEEP_MS = 60_000   // the overlay window stays around for a minute: the next circle starts instantly
const ASK_FALLBACK = 'What is this? Briefly explain what I circled, and say what I could do with it.'

type Pt = { x: number; y: number }

export class Lasso {
  private holdTimer: ReturnType<typeof setTimeout> | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private flush: ReturnType<typeof setInterval> | null = null
  private armTimer: ReturnType<typeof setTimeout> | null = null
  private points: Pt[] = []
  private batch: Pt[] = []
  private shot: Promise<NativeImage | null> | null = null
  private origin = { x: 0, y: 0 }
  private armed = false      // tap mode: waiting for a stroke
  private holding = false    // hold mode: key down, drawing with the pointer polled
  private asking = false     // the stroke is done, the question is being spoken
  active = false

  constructor(private agent: Agent, private dictationActive: () => boolean = () => false) {
    ipcMain.on('lokey:lasso:stroke', (e, pts: Pt[]) => { if (lassoCanvas.owns(e.sender)) void this.onStroke(Array.isArray(pts) ? pts : []) })
    ipcMain.on('lokey:lasso:cancel', e => { if (lassoCanvas.owns(e.sender)) this.cancel() })
    agent.on('idle', () => { if (this.asking) this.release() })
  }

  // ---- chord events -----------------------------------------------------------------------------------------------
  /** key down: a tap arms, holding 250 ms switches to the old hold-to-draw gesture */
  down() {
    if (!settings.value.voice.enabled || !settings.value.voice.lasso || this.holdTimer || this.holding) return
    this.holdTimer = setTimeout(() => { this.holdTimer = null; void this.startHold() }, HOLD_MS)
  }

  /** key up (`cancelled`: another key ended the chord) */
  async up(cancelled = false) {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer); this.holdTimer = null
      if (!cancelled) this.tap() // pressed and released quickly with no other key: a tap
      return
    }
    if (this.holding) await this.finishHold(cancelled)
  }

  private tap() {
    if (this.asking) { void this.agent.end(); return }   // a second tap ends the question now
    if (this.armed) { this.cancel(); return }            // a tap while armed backs out
    void this.arm()
  }

  // ---- tap mode ----------------------------------------------------------------------------------------------------
  private async arm() {
    if (this.dictationActive()) { this.agent.notice('Finish dictating first.', 'info'); return }
    if (this.agent.inConversation) this.agent.stopConversation(true)
    const d = screen.getPrimaryDisplay()
    this.origin = { x: d.bounds.x, y: d.bounds.y }
    this.armed = true
    this.agent.cue('lasso') // the island reacts at once
    this.shot = this.grab(d)
    await Promise.race([this.shot, new Promise(r => setTimeout(r, 1500))])
    if (!this.armed) return
    lassoCanvas.interactive(true)
    lassoCanvas.send({ type: 'arm', hint: 'Draw around what you want to ask about · hold Shift and drag for a box · Esc to cancel' })
    holdEscape('lasso', () => { if (this.armed) this.cancel() })
    this.armTimer = setTimeout(() => this.cancel(), ARM_TIMEOUT_MS)
  }

  /** the overlay page reports a finished stroke (overlay coordinates = display DIPs) */
  private async onStroke(pts: Pt[]) {
    if (!this.armed) return
    this.armed = false
    if (this.armTimer) { clearTimeout(this.armTimer); this.armTimer = null }
    lassoCanvas.interactive(false) // the page shows its closing animation and the screen belongs to the apps again
    this.asking = true
    const { images, hint } = await this.makeImages(pts.slice(0, MAX_POINTS))
    if (!this.asking) return // cancelled while the pictures were prepared
    this.agent.setImages(images, hint)
    this.agent.askHandsFree('lasso', ASK_FALLBACK)
  }

  // ---- hold mode (the original gesture) ----------------------------------------------------------------------------
  private async startHold() {
    if (this.dictationActive() || this.asking) return
    const d = screen.getPrimaryDisplay()
    this.origin = { x: d.bounds.x, y: d.bounds.y }
    this.holding = true; this.active = true
    this.points = []; this.batch = []
    this.shot = this.grab(d)
    lassoCanvas.interactive(false)
    lassoCanvas.send({ type: 'start' })
    void this.agent.begin('lasso')
    let last = { x: -1, y: -1 }
    this.poll = setInterval(() => {
      const p = screen.getCursorScreenPoint()
      if (p.x === last.x && p.y === last.y) return
      last = p
      if (this.points.length < MAX_POINTS) {
        const q = { x: p.x - this.origin.x, y: p.y - this.origin.y }
        this.points.push(q); this.batch.push(q)
      }
    }, SAMPLE_MS)
    this.flush = setInterval(() => { if (this.batch.length) lassoCanvas.send({ type: 'point', pts: this.batch.splice(0) }) }, 16)
  }

  private async finishHold(cancelled: boolean) {
    this.holding = false; this.active = false
    if (this.poll) clearInterval(this.poll)
    if (this.flush) clearInterval(this.flush)
    this.poll = this.flush = null
    if (cancelled) { lassoCanvas.send({ type: 'cancel' }); lassoCanvas.closeSoon(WINDOW_KEEP_MS); this.agent.cancel(); return }
    lassoCanvas.send({ type: 'point', pts: this.batch.splice(0) })
    lassoCanvas.send({ type: 'end' })
    lassoCanvas.closeSoon(WINDOW_KEEP_MS)
    try {
      const { images, hint } = await this.makeImages(this.points)
      this.agent.setImages(images, hint)
    } catch { this.agent.setImages([], '') } finally {
      await this.agent.end() // always: a failure above must never leave the microphone open
    }
  }

  // ---- shared -----------------------------------------------------------------------------------------------------
  /** abort anything in progress (Esc, a tap while armed, the sidecar restarted, a cancelled chord) */
  cancel() {
    const was = this.armed || this.holding || this.asking || !!this.holdTimer
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null }
    if (this.poll) clearInterval(this.poll)
    if (this.flush) clearInterval(this.flush)
    this.poll = this.flush = null
    const wasAsking = this.asking
    this.armed = false; this.holding = false; this.active = false; this.asking = false
    if (!was) return
    lassoCanvas.send({ type: 'cancel' })
    lassoCanvas.interactive(false)
    lassoCanvas.closeSoon(WINDOW_KEEP_MS)
    this.unhook()
    if (wasAsking) this.agent.cancel(); else this.agent.uncue()
  }

  /** the question was answered (or dropped): everything goes back to rest */
  private release() {
    this.asking = false; this.armed = false
    this.unhook()
    lassoCanvas.closeSoon(WINDOW_KEEP_MS)
  }

  private unhook() {
    if (this.armTimer) { clearTimeout(this.armTimer); this.armTimer = null }
    releaseEscape('lasso')
  }

  private async grab(d: Electron.Display): Promise<NativeImage | null> {
    try {
      const w = Math.round(d.bounds.width * d.scaleFactor), h = Math.round(d.bounds.height * d.scaleFactor)
      const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h }, fetchWindowIcons: false })
      const s = srcs.find(x => x.display_id === String(d.id)) ?? srcs[0]
      return s && !s.thumbnail.isEmpty() ? s.thumbnail : null
    } catch { return null }
  }

  /** whole screen (for context) + a close-up of the circled part + a sentence saying where it is. Never throws. */
  private async makeImages(pts: Pt[]): Promise<{ images: Buffer[]; hint: string }> {
    const img = await this.shot
    if (!img) return { images: [], hint: '' }
    const d = screen.getPrimaryDisplay()
    const W = d.bounds.width, H = d.bounds.height
    const whole = (() => { try { const f = img.getSize(); return (f.width > 1280 ? img.resize({ width: 1280, quality: 'good' }) : img).toJPEG(70) } catch { return null } })()
    try {
      const k = img.getSize().width / W // picture pixels per DIP
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
      let x0 = pts.length ? Math.min(...xs) : W / 2, x1 = pts.length ? Math.max(...xs) : W / 2
      let y0 = pts.length ? Math.min(...ys) : H / 2, y1 = pts.length ? Math.max(...ys) : H / 2
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1)
      // a small or sloppy loop still gets a usable picture: at least 400 x 300 around its centre, padded, kept on the screen
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
      const w = Math.min(W, Math.max(x1 - x0 + 56, 400)), h = Math.min(H, Math.max(y1 - y0 + 56, 300))
      const bx = Math.max(0, Math.min(W - w, cx - w / 2)), by = Math.max(0, Math.min(H - h, cy - h / 2))
      const crop = img.crop({ x: Math.round(bx * k), y: Math.round(by * k), width: Math.max(8, Math.round(w * k)), height: Math.max(8, Math.round(h * k)) })
      const cs = crop.getSize()
      const out = cs.width > 900 ? crop.resize({ width: 900, quality: 'good' }) : cs.width < 320 ? crop.resize({ width: 320, quality: 'good' }) : crop
      const pct = (v: number, m: number) => Math.round((v / m) * 100)
      const hint = `The user circled a region on the screen: left ${pct(x0, W)}%, top ${pct(y0, H)}%, right ${pct(x1, W)}%, bottom ${pct(y1, H)}% of the screen. The first picture is the whole screen, the second is a close-up of that region.`
      return { images: [...(whole ? [whole] : []), out.toJPEG(85)], hint }
    } catch { return { images: whole ? [whole] : [], hint: '' } }
  }

  /** self-check helper: a loop around the middle of a display, no pointer or capture involved */
  static demoLoop(cx: number, cy: number, rx = 130, ry = 60, n = 80): Pt[] {
    return Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2.1 - 0.3; return { x: cx + Math.cos(a) * rx * (1 + 0.06 * Math.sin(a * 3)), y: cy + Math.sin(a) * ry } })
  }
}
