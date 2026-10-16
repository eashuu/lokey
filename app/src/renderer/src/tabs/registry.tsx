import type { ComponentType } from 'react'
import type { TabId } from '@shared/bridge'
import { ControlsTab } from './ControlsTab'
import { TodayTab } from './TodayTab'
import { StatsTab } from './StatsTab'
import { ClipboardTab } from './ClipboardTab'
import { AppsTab } from './AppsTab'
import { WallpaperTab } from './WallpaperTab'
import { PowerTab } from './PowerTab'
import { AgentsTab } from './AgentsTab'

export const tabs: Record<TabId, { label: string; Component: ComponentType }> = {
  controls: { label: 'Controls', Component: ControlsTab },
  today: { label: 'Today', Component: TodayTab },
  stats: { label: 'Stats', Component: StatsTab },
  clipboard: { label: 'Clipboard', Component: ClipboardTab },
  apps: { label: 'Apps', Component: AppsTab },
  wallpaper: { label: 'Wallpaper', Component: WallpaperTab },
  power: { label: 'Power', Component: PowerTab },
  agents: { label: 'Flow', Component: AgentsTab },
}
