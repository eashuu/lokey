import { desktopCapturer, screen, type NativeImage } from 'electron'
import type { Agent } from './agent'
import { lassoCanvas } from './overlays'
import { settings } from '../settings'

// Circle to ask: hold the key (after a short threshold so ordinary Ctrl+Shift shortcuts are left alone), draw a loop
// with the pointer, ask out loud. The screen is grabbed once when the stroke starts (before our own overlay appears),
// and when the key is released the whole screen (scaled) plus a sharper crop of the circled region go to the model.
// The pointer is sampled with GetCursorPos (screen.getCursorScreenPoint): no mouse hook.
const HOLD_MS = 250
const SAMPLE_MS = 8
const MAX_POINTS = 4000

export class Lasso {
  private timer: ReturnType<typeof setTimeout> | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private flush: ReturnType<typeof setInterval> | null = null
  private points: { x: number; y: number }[] = []
  private batch: { x: number; y: number }[] = []
  private shot: Promise<NativeImage | null> | null = null
  private origin = { x: 0, y: 0 }
  active = false

  constructor(private agent: Agent) {}

  /** key down: nothing happens until the key has been held for HOLD_MS */
  down() {
    if (!settings.value.voice.enabled || !settings.value.voice.lasso || this.agent.busy || this.timer || this.active) return
    this.timer = setTimeout(() => { this.timer = null; void this.start() }, HOLD_MS)
  }

  private async start() {
    const d = screen.getPrimaryDisplay()
    this.origin = { x: d.bounds.x, y: d.bounds.y }
    this.active = true
    this.points = []; this.batch = []
    this.shot = this.grab(d)
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

  private async grab(d: Electron.Display): Promise<NativeImage | null> {
    try {
      const w = Math.round(d.bounds.width * d.scaleFactor), h = Math.round(d.bounds.height * d.scaleFactor)
      const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h }, fetchWindowIcons: false })
      const s = srcs.find(x => x.display_id === String(d.id)) ?? srcs[0]
      return s && !s.thumbnail.isEmpty() ? s.thumbnail : null
    } catch { return null }
  }

  /** key up */
  async up() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; return } // a plain Ctrl+Shift tap: not ours
    if (!this.active) return
    this.active = false
    if (this.poll) clearInterval(this.poll)
    if (this.flush) clearInterval(this.flush)
    this.poll = this.flush = null
    lassoCanvas.send({ type: 'point', pts: this.batch.splice(0) })
    lassoCanvas.send({ type: 'end' })
    lassoCanvas.closeSoon(1800)

    const pts = this.points
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    const img = await this.shot
    const images: Buffer[] = []
    if (img && pts.length > 8) {
      const full = img.getSize()
      const k = full.width / (screen.getPrimaryDisplay().bounds.width) // image px per DIP
      const pad = 28
      const x0 = Math.max(0, Math.min(...xs) - pad), y0 = Math.max(0, Math.min(...ys) - pad)
      const x1 = Math.min(full.width / k, Math.max(...xs) + pad), y1 = Math.min(full.height / k, Math.max(...ys) + pad)
      const crop = img.crop({ x: Math.round(x0 * k), y: Math.round(y0 * k), width: Math.max(8, Math.round((x1 - x0) * k)), height: Math.max(8, Math.round((y1 - y0) * k)) })
      const cs = crop.getSize()
      const cropOut = cs.width > 900 ? crop.resize({ width: 900, quality: 'good' }) : cs.width < 320 ? crop.resize({ width: 320, quality: 'good' }) : crop
      const whole = full.width > 1280 ? img.resize({ width: 1280, quality: 'good' }) : img
      images.push(whole.toJPEG(70), cropOut.toJPEG(85)) // [0] the whole screen for context, [1] the circled region
    }
    this.agent.setImages(images)
    await this.agent.end()
  }

  /** demo/self-check: a loop around the middle of the display, no pointer or capture involved */
  static demoLoop(cx: number, cy: number, rx = 130, ry = 60, n = 80): { x: number; y: number }[] {
    return Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * Math.PI * 2.1 - 0.3; return { x: cx + Math.cos(a) * rx * (1 + 0.06 * Math.sin(a * 3)), y: cy + Math.sin(a) * ry } })
  }
}
