import { QuantizerCelebi, Score, hexFromArgb, themeFromSourceColor, argbFromHex } from '@material/material-color-utilities'

export const FALLBACK_ACCENT = '#d9b556'

const hexToRgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))

function setAccent(primary: string, onPrimary: string) {
  const [r, g, b] = hexToRgb(primary)
  const root = document.documentElement.style
  root.setProperty('--accent', primary)
  root.setProperty('--accent-ink', onPrimary)
  root.setProperty('--accent-soft', `rgba(${r}, ${g}, ${b}, 0.16)`)
}

/** Accent colour from an image (data URL): quantize, score, take the Material 'primary' for a dark scheme. */
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
    const seed = Score.score(QuantizerCelebi.quantize(px, 96))[0]
    const t = themeFromSourceColor(seed)
    setAccent(hexFromArgb(t.schemes.dark.primary), hexFromArgb(t.schemes.dark.onPrimary))
  } catch {
    setAccent(FALLBACK_ACCENT, '#1b1405')
  }
}

export function accentFromHex(hex: string) {
  const t = themeFromSourceColor(argbFromHex(hex))
  setAccent(hexFromArgb(t.schemes.dark.primary), hexFromArgb(t.schemes.dark.onPrimary))
}

export function applyTheme(theme: 'dark' | 'light' | 'auto', scale: number) {
  const root = document.documentElement
  const light = theme === 'light' || (theme === 'auto' && matchMedia('(prefers-color-scheme: light)').matches)
  root.dataset.theme = light ? 'light' : 'dark'
  root.style.setProperty('--ui-scale', String(scale))
}
