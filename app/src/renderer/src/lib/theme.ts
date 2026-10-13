import { Hct, QuantizerCelebi, Score, hexFromArgb, argbFromHex } from '@material/material-color-utilities'

export const FALLBACK_ACCENT = '#d9b556'

const hexToRgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))

// ---- one seed colour, two schemes -------------------------------------------------------------------------------------
// Dark (the reference): saturated accent at tone ~72, dark ink on it, panel = accent x 0.078 (near-black with the
// wallpaper's hue). Light: a deeper accent (tone ~44, readable on a pale panel), pale ink on it and a near-white panel
// carrying a hint of the wallpaper's hue. The seed is remembered so a scheme flip re-derives everything instantly.
let seed = argbFromHex(FALLBACK_ACCENT)
let isLight = false

function paintPalette() {
  const base = Hct.fromInt(seed)
  const hue = base.hue
  const chroma = Math.min(95, Math.max(58, base.chroma))
  const hex = (h: number, c: number, t: number) => hexFromArgb(Hct.from(h, c, t).toInt())
  const accent = isLight ? hex(hue, Math.min(88, chroma), 44) : hex(hue, chroma, 72)
  const ink = isLight ? hex(hue, 14, 98) : hex(hue, 48, 12)
  const chest = isLight ? hex(305, 46, 46) : hex(305, 42, 80)
  const done = isLight ? hex(135, 56, 38) : hex(135, 52, 78)
  const ember = isLight ? hex((hue + 28) % 360, 60, 48) : hex((hue + 28) % 360, 55, 86)
  const [r, g, b] = hexToRgb(accent)
  const darkAccent = hexToRgb(hex(hue, chroma, 72))
  const panel = isLight ? hex(hue, 9, 96) : '#' + darkAccent.map(v => Math.round(v * 0.078).toString(16).padStart(2, '0')).join('')
  const root = document.documentElement.style
  root.setProperty('--accent', accent)
  root.setProperty('--accent-ink', ink)
  root.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.16)`)
  root.setProperty('--chest', chest)
  root.setProperty('--done', done)
  root.setProperty('--ember', ember)
  root.setProperty('--panel', panel)
}

function applyPalette(s: number) {
  seed = s
  paintPalette()
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

// ---- scheme ------------------------------------------------------------------------------------------------------------
let wanted: 'dark' | 'light' | 'auto' = 'dark'
let scaleNow = 1
let watching = false

function resolve() {
  const light = wanted === 'light' || (wanted === 'auto' && matchMedia('(prefers-color-scheme: light)').matches)
  const changed = light !== isLight || document.documentElement.dataset.theme !== (light ? 'light' : 'dark')
  isLight = light
  const root = document.documentElement
  root.dataset.theme = light ? 'light' : 'dark'
  root.style.setProperty('--ui-scale', String(scaleNow))
  if (changed) paintPalette()
}

/** Applies the theme setting. `auto` follows Windows live: flipping Windows' app mode re-themes without a restart. */
export function applyTheme(theme: 'dark' | 'light' | 'auto', scale: number) {
  wanted = theme
  scaleNow = scale
  resolve()
  if (!watching) {
    watching = true
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (wanted === 'auto') resolve() })
  }
}

/** WCAG contrast ratio of two #rrggbb colours (used by the theme check in --lab). */
export function contrast(a: string, b: string): number {
  const lum = (h: string) => { const [r, g, bl] = hexToRgb(h).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl }
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
