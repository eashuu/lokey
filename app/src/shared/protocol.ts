// Wire protocol between Electron main and Lokey.Host.exe (the .NET sidecar).
// Transport: Windows named pipe, UTF-8, one JSON object per line.
//   request  {"id":1,"method":"audio.setVolume","params":{"level":0.4}}
//   response {"id":1,"result":{...}}  or  {"id":1,"error":{"message":"..."}}
//   event    {"event":"media.changed","data":{...}}          (sidecar -> main, unsolicited)
// All property names are camelCase. Sizes are bytes, rates are bytes/second, percentages are 0..100,
// levels are 0..1. Image fields are `data:` URLs (small) or null.
// The sidecar MUST NOT poll at idle: events only fire on OS notifications, or while a subscription is active.

export interface Rect { x: number; y: number; w: number; h: number }

export interface DisplayInfo {
  bounds: Rect          // primary monitor, physical pixels
  work: Rect            // work area (excludes taskbar/appbars), physical pixels
  dpi: number           // 96 = 100%
}

export interface MediaState {
  hasSession: boolean
  app: string           // source app display name, e.g. "Spotify"
  title: string
  artist: string
  album: string
  playing: boolean
  positionMs: number    // position at `sampledAt`
  durationMs: number
  sampledAt: number     // epoch ms when positionMs was read, so the UI can extrapolate while playing
  art: string | null    // data URL, max 320px
  canNext: boolean
  canPrev: boolean
  sessions: { id: string; app: string; playing: boolean }[]
  currentSession: string | null
}

export interface AudioState {
  volume: number        // 0..1 master output
  muted: boolean
  device: string        // friendly name of default output
  micMuted: boolean
}

export interface StatsTick {
  cpu: { pct: number; name: string; ghz: number; processes: number; tempC: number | null }
  gpu: { pct: number; name: string; vramUsed: number; vramTotal: number } | null
  ram: { used: number; total: number }
  disk: { letter: string; used: number; total: number }
  net: { down: number; up: number }
  uptimeSec: number
  top: { name: string; ramBytes: number; cpuPct: number }[]   // top 5 by RAM
}

export interface SystemStatus {
  network: { kind: 'wifi' | 'ethernet' | 'none'; name: string; signal: number | null }
  bluetooth: { available: boolean; on: boolean }
  battery: { present: boolean; pct: number; charging: boolean; minutesLeft: number | null }
  keyboard: string      // layout tag e.g. "ENG"
  keepAwake: boolean
  brightness: number | null   // 0..1, null when no controllable panel
  darkMode: boolean           // Windows apps theme is dark
  nightLight: boolean | null  // null = not available (not implemented yet)
}

export interface UserInfo { name: string; avatar: string | null; machine: string }

export interface AppEntry {
  id: string            // stable (AppUserModelID or path hash)
  name: string
  kind: 'app' | 'game' | 'store'
  starred: boolean
  lastUsed: number | null   // epoch ms
}

export interface ClipItem {
  id: string
  kind: 'text' | 'image' | 'link'
  preview: string       // text (truncated to 400 chars), or URL, or "" for images
  image: string | null  // data URL thumbnail for images
  source: string        // app name it was copied from, may be ""
  at: number            // epoch ms
  pinned: boolean
  size: number          // bytes
}

export interface WallpaperItem { path: string; name: string; thumb: string | null }

export interface DesktopsState { count: number; current: number; occupied: boolean[] }

export interface ForegroundInfo { title: string; exe: string; pid: number }

export interface WifiNetwork { ssid: string; signal: number; secured: boolean; connected: boolean; known: boolean }   // signal 0..100
export interface WifiState {
  available: boolean            // a Wi-Fi adapter exists
  on: boolean                   // its radio is on
  connected: { ssid: string; signal: number } | null
  accessDenied: boolean         // Windows blocked scanning (Location services off)
}
export interface BtDevice { id: string; name: string; kind: 'audio' | 'input' | 'phone' | 'computer' | 'other'; paired: boolean; connected: boolean; battery: number | null }
export interface BtState { available: boolean; on: boolean }
export interface AudioDevice { id: string; name: string; kind: 'output' | 'input'; isDefault: boolean }

export type PowerAction = 'lock' | 'sleep' | 'hibernate' | 'signout' | 'restart' | 'shutdown'

// ---- request methods: name -> [params, result] -----------------------------------------------
export interface Methods {
  'sys.hello': [{ version: number }, { version: number; host: string }]
  'sys.quit': [{}, {}]
  'display.get': [{}, DisplayInfo]
  'user.get': [{}, UserInfo]

  'hotkey.register': [{ id: number; combo: string }, { ok: boolean; reason?: string }]   // "Ctrl+Alt+Space"
  'hotkey.registerHold': [{ id: number; combo: string }, { ok: boolean; reason?: string }] // fires hotkey.down / hotkey.up
  'hotkey.unregisterAll': [{}, {}]

  'media.get': [{}, MediaState]
  'media.control': [{ action: 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'seek'; positionMs?: number }, {}]
  'media.selectSession': [{ id: string }, {}]

  'audio.get': [{}, AudioState]
  'audio.setVolume': [{ level: number }, {}]
  'audio.setMuted': [{ muted: boolean }, {}]
  'audio.setMicMuted': [{ muted: boolean }, {}]
  'audio.visualiser': [{ on: boolean }, {}]         // starts/stops `audio.bands` events (~30 Hz)

  'stats.subscribe': [{ intervalMs: number }, StatsTick]   // returns first tick, then `stats.tick` events
  'stats.unsubscribe': [{}, {}]

  'system.get': [{}, SystemStatus]
  'system.setBrightness': [{ level: number }, {}]
  'system.setKeepAwake': [{ on: boolean }, {}]
  'system.setDarkMode': [{ on: boolean }, {}]
  'system.setNightLight': [{ on: boolean }, { ok: boolean; reason?: string }]   // only when `nightLight` is not null
  'wifi.get': [{}, WifiState]
  'wifi.scan': [{}, WifiNetwork[]]                                        // active scan, sorted: connected first, then by signal
  'wifi.setOn': [{ on: boolean }, {}]
  'wifi.connect': [{ ssid: string; password?: string }, { ok: boolean; reason?: string }]
  'wifi.disconnect': [{}, {}]
  'bt.get': [{}, BtState]
  'bt.devices': [{}, BtDevice[]]                                          // paired devices with connection state
  'bt.discover': [{ seconds: number }, BtDevice[]]                         // nearby unpaired devices (blocks for `seconds`)
  'bt.pair': [{ id: string }, { ok: boolean; reason?: string }]
  'bt.forget': [{ id: string }, {}]
  'bt.connect': [{ id: string }, { ok: boolean; reason?: string }]
  'bt.disconnect': [{ id: string }, { ok: boolean; reason?: string }]
  'audio.devices': [{}, AudioDevice[]]
  'audio.setDefault': [{ id: string }, {}]
  'system.setBluetooth': [{ on: boolean }, {}]
  'system.openSettings': [{ page: 'network' | 'bluetooth' | 'sound' | 'display' | 'main' }, {}]

  'apps.list': [{}, AppEntry[]]
  'apps.icon': [{ id: string }, { icon: string | null }]   // data URL 64px, cached on disk
  'apps.launch': [{ id: string }, {}]
  'apps.star': [{ id: string; on: boolean }, {}]
  'apps.searchFiles': [{ query: string; limit: number }, { name: string; path: string }[]]   // Windows Search index
  'apps.openPath': [{ path: string }, {}]

  'clipboard.list': [{ query?: string; kind?: 'text' | 'image' | 'link'; limit?: number }, ClipItem[]]
  'clipboard.pin': [{ id: string; on: boolean }, {}]
  'clipboard.delete': [{ id: string }, {}]
  'clipboard.clear': [{ keepPinned: boolean }, {}]
  'clipboard.paste': [{ id: string }, {}]           // put item on clipboard; sidecar also sends Ctrl+V to the previous foreground window when `autoPaste` is true
  'clipboard.settings': [{ retentionDays: number; autoPaste: boolean }, {}]

  'wallpaper.get': [{}, { path: string | null }]
  'wallpaper.set': [{ path: string }, {}]
  'wallpaper.recent': [{}, WallpaperItem[]]          // the Windows wallpaper history (BackgroundHistoryPath0..4)
  'wallpaper.folder': [{ folder: string; limit: number }, WallpaperItem[]]   // images in a folder, newest first
  'wallpaper.thumb': [{ path: string; size: number }, { thumb: string | null }]

  'desktops.get': [{}, DesktopsState]
  'desktops.switch': [{ index: number }, {}]

  'power.do': [{ action: PowerAction }, {}]
  'foreground.get': [{}, ForegroundInfo]

  // dictation: where the focused text field is (physical screen px), and typing into it
  'text.focusRect': [{}, { x: number; y: number; w: number; h: number; source: 'uia' | 'focus' | 'caret' | 'window' | 'screen'; password: boolean; hwnd: number }]
  'text.insert': [{ text: string; hwnd?: number }, { ok: boolean; reason?: string }]
}

// ---- events: name -> data ---------------------------------------------------------------------
export interface Events {
  'display.changed': DisplayInfo
  'fullscreen.changed': { full: boolean }           // true only for a real fullscreen app (never the desktop/Progman/WorkerW)
  'foreground.changed': ForegroundInfo
  'wallpaper.changed': { path: string | null }
  'hotkey.pressed': { id: number }
  'hotkey.down': { id: number }
  'hotkey.up': { id: number }
  'media.changed': MediaState
  'audio.changed': AudioState
  'audio.bands': { bands: number[] }                // 32 values 0..1
  'stats.tick': StatsTick
  'system.changed': SystemStatus
  'clipboard.changed': { item: ClipItem }
  'desktops.changed': DesktopsState
  'wifi.changed': WifiState
  'bt.changed': {}                                  // re-fetch bt.get / bt.devices
  'audio.devices.changed': {}                       // re-fetch audio.devices
  'apps.changed': {}                                // installed-apps list changed, re-fetch
}

export type MethodName = keyof Methods
export type EventName = keyof Events
