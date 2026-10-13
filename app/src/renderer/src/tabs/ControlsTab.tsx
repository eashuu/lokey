import { MediaCard } from './controls/Media'
import { QuickSettings } from './controls/Quick'

export function ControlsTab() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: '0.75rem', alignItems: 'stretch', maxHeight: '21rem' }}>
      <MediaCard />
      <QuickSettings />
    </div>
  )
}
