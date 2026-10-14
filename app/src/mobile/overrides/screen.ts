// main/brain/screen.ts for the phone: the picture comes from the native plugin's `screenshot` (accessibility takeScreenshot: Android 11+, about one per
// second, protected screens refused) and is shaped like the Windows helper's answer. Points the model gives (0..1000 grid) map onto the screen size the
// plugin reported with the last picture, which is what its tap / swipe methods (`input.mouse`, `ui.*`) take.
import { nativeCall } from '../native'

export interface Shot { jpeg: string; width: number; height: number }

let screenW = 0, screenH = 0

export async function captureScreen(maxW = 1280): Promise<Shot | null> {
  try {
    const r = await nativeCall<{ ok?: boolean; base64?: string; w?: number; h?: number; screenW?: number; screenH?: number }>('screenshot', { maxWidth: maxW, quality: 72 }, 20_000)
    if (!r || r.ok === false || !r.base64) return null
    if (r.screenW && r.screenH) { screenW = r.screenW; screenH = r.screenH }
    return { jpeg: r.base64, width: r.w ?? 0, height: r.h ?? 0 }
  } catch { return null }
}

/** a point in the 0..1000 grid -> screen pixels */
export function toPixels(nx: number, ny: number): { x: number; y: number } {
  const cx = Math.max(0, Math.min(1000, nx)), cy = Math.max(0, Math.min(1000, ny))
  const s = devicePixelRatio || 1
  const w = screenW || screen.width * s, h = screenH || screen.height * s
  return { x: Math.round((cx / 1000) * w), y: Math.round((cy / 1000) * h) }
}
