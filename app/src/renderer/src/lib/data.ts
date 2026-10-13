import { useEffect } from 'react'
import { create } from 'zustand'
import type { Settings } from '@shared/bridge'
import { defaultSettings } from '@shared/bridge'
import type { AudioState, DesktopsState, MediaState, StatsTick, SystemStatus, UserInfo, WifiState } from '@shared/protocol'
import { bridge } from '@/bridge'

interface Data {
  settings: Settings
  media: MediaState | null
  audio: AudioState | null
  system: SystemStatus | null
  user: UserInfo | null
  desktops: DesktopsState | null
  wifi: WifiState | null
  stats: StatsTick | null
  bands: number[]
  wallpaper: string | null
  fullscreen: boolean
}

export const useData = create<Data>(() => ({
  settings: defaultSettings, media: null, audio: null, system: null, user: null, desktops: null, wifi: null,
  stats: null, bands: [], wallpaper: null, fullscreen: false,
}))

const set = useData.setState

/** One-time wiring: initial reads + event subscriptions. Everything after this is event-driven. */
export async function initData() {
  const [settings, media, audio, system, user, desktops, wp] = await Promise.all([
    bridge.settings.get(),
    bridge.call('media.get', {}).catch(() => null),
    bridge.call('audio.get', {}).catch(() => null),
    bridge.call('system.get', {}).catch(() => null),
    bridge.call('user.get', {}).catch(() => null),
    bridge.call('desktops.get', {}).catch(() => null),
    bridge.call('wallpaper.get', {}).catch(() => ({ path: null })),
  ])
  set({ settings, media, audio, system, user, desktops, wallpaper: wp.path })
  bridge.settings.onChange(s => set({ settings: s }))
  bridge.on('media.changed', media => set({ media }))
  bridge.on('audio.changed', audio => set({ audio }))
  bridge.on('system.changed', system => set({ system }))
  bridge.on('desktops.changed', desktops => set({ desktops }))
  void bridge.call('wifi.get', {}).then(wifi => set({ wifi })).catch(() => undefined)
  bridge.on('wifi.changed', wifi => set({ wifi }))
  bridge.on('wallpaper.changed', e => set({ wallpaper: e.path }))
  bridge.on('stats.tick', stats => set({ stats }))
  bridge.on('audio.bands', e => set({ bands: e.bands }))
}

// ---- reference-counted subscriptions: nothing streams unless a visible view asks for it -------------
let statsUsers = 0
export function useStatsStream(active: boolean, intervalMs = 1000) {
  useEffect(() => {
    if (!active) return
    if (statsUsers++ === 0) void bridge.call('stats.subscribe', { intervalMs }).then(t => set({ stats: t })).catch(() => undefined)
    return () => { if (--statsUsers === 0) void bridge.call('stats.unsubscribe', {}).catch(() => undefined) }
  }, [active, intervalMs])
}

let bandUsers = 0
export function useBandsStream(active: boolean) {
  useEffect(() => {
    if (!active) return
    if (bandUsers++ === 0) void bridge.call('audio.visualiser', { on: true }).catch(() => undefined)
    return () => { if (--bandUsers === 0) void bridge.call('audio.visualiser', { on: false }).catch(() => undefined) }
  }, [active])
}
