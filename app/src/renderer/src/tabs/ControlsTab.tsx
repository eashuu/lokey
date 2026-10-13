import { MediaCard } from './controls/Media'
import { Quick } from './controls/Quick'

/** 604x320 content area of the 640x390 controls menu: media card, volume (+ brightness), tile row, status line. */
export function ControlsTab() {
  return (
    <div style={{ position: 'relative', width: 604, height: 320 }}>
      <MediaCard />
      <Quick />
    </div>
  )
}
