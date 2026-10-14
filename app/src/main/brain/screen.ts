import { desktopCapturer, screen } from 'electron'

// Looking at the screen. The picture is scaled down (models do not need 4K) and coordinates the model gives back are normalised
// to 0..1000 on both axes, which is what vision models point in; `toPixels` turns them into real screen pixels for the mouse.
export interface Shot { jpeg: string; width: number; height: number }

export async function captureScreen(maxW = 1280): Promise<Shot | null> {
  try {
    const d = screen.getPrimaryDisplay()
    const w = Math.round(d.bounds.width * d.scaleFactor), h = Math.round(d.bounds.height * d.scaleFactor)
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h }, fetchWindowIcons: false })
    const s = srcs.find(x => x.display_id === String(d.id)) ?? srcs[0]
    if (!s || s.thumbnail.isEmpty()) return null
    const img = s.thumbnail.getSize().width > maxW ? s.thumbnail.resize({ width: maxW, quality: 'good' }) : s.thumbnail
    const sz = img.getSize()
    return { jpeg: img.toJPEG(72).toString('base64'), width: sz.width, height: sz.height }
  } catch { return null }
}

/** a point in the 0..1000 grid -> physical screen pixels of the primary display */
export function toPixels(nx: number, ny: number): { x: number; y: number } {
  const d = screen.getPrimaryDisplay()
  const cx = Math.max(0, Math.min(1000, nx)), cy = Math.max(0, Math.min(1000, ny))
  return { x: Math.round((d.bounds.x + (cx / 1000) * d.bounds.width) * d.scaleFactor), y: Math.round((d.bounds.y + (cy / 1000) * d.bounds.height) * d.scaleFactor) }
}
