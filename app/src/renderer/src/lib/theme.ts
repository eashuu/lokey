import { Hct, QuantizerCelebi, Score, hexFromArgb, argbFromHex } from '@material/material-color-utilities'

export const FALLBACK_ACCENT = '#d9b556'

const hexToRgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))

/**
 * Palette from one seed colour, the way the reference derives it per wallpaper: a saturated accent (tone ~72), the
 * dark ink that sits on it, a violet "chest" colour (GPU ring), a green "done" colour, and a panel tinted by the
 * accent (accent x 0.078, i.e. near-black with the wallpaper's hue).
 */
function applyPalette(seed: number) {
  const base = Hct.fromInt(seed)
  const hue = base.hue
  const chroma = Math.min(95, Math.max(58, base.chroma))
  const accent = hexFromArgb(Hct.from(hue, chroma, 72).toInt())
  const ink = hexFromArgb(Hct.from(hue, 48, 12).toInt())
  const chest = hexFromArgb(Hct.from(305, 42, 80).toInt())
  const done = hexFromArgb(Hct.from(135, 52, 78).toInt())
  const ember = hexFromArgb(Hct.from((hue + 28) % 360, 55, 86).toInt())
  const [r, g, b] = hexToRgb(accent)
  const panel = '#' + [r, g, b].map(v => Math.round(v * 0.078).toString(16).padStart(2, '0')).join('')
  const root = document.documentElement.style
  root.setProperty('--accent', accent)
  root.setProperty('--accent-ink', ink)
  root.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.16)`)
  root.setProperty('--chest', chest)
  root.setProperty('--done', done)
  root.setProperty('--ember', ember)
  root.setProperty('--panel', panel)
}

/** Accent palette from an image (data URL): quantize, score, take the best seed. */
export async function accentFromImage(src: string): Promise<void> {
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(img, 0, 0, 64, 64)
    const data = g.getImageData(0, 0, 64, 64).data
    const px: number[] = []
    for (let i = 0; i < data.length; i += 4) px.push(((255 << 24) | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) >>> 0)
    applyPalette(Score.score(QuantizerCelebi.quantize(px, 96))[0])
  } catch {
    applyPalette(argbFromHex(FALLBACK_ACCENT))
  }
}

export function accentFromHex(hex: string) {
  applyPalette(argbFromHex(hex))
}

export function applyTheme(theme: 'dark' | 'light' | 'auto', scale: number) {
  const root = document.documentElement
  const light = theme === 'light' || (theme === 'auto' && matchMedia('(prefers-color-scheme: light)').matches)
  root.dataset.theme = light ? 'light' : 'dark'
  root.style.setProperty('--ui-scale', String(scale))
}
