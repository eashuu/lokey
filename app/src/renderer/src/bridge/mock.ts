// Fake bridge for running the UI in a plain browser or when the sidecar is unavailable.
// Realistic fixtures so every tab renders; stats/visualiser/media tick only while subscribed.
import type { Bridge, AppEvent, Settings } from '@shared/bridge'
import { defaultSettings } from '@shared/bridge'
import type { AppEntry, ClipItem, EventName, Events, MethodName, Methods, MediaState, StatsTick, WallpaperItem } from '@shared/protocol'

function gradient(a: string, b: string, size = 160, angle = 135): string {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const r = (angle * Math.PI) / 180
  const grad = g.createLinearGradient(size / 2 - Math.cos(r) * size / 2, size / 2 - Math.sin(r) * size / 2, size / 2 + Math.cos(r) * size / 2, size / 2 + Math.sin(r) * size / 2)
  grad.addColorStop(0, a)
  grad.addColorStop(1, b)
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  return c.toDataURL('image/jpeg', 0.8)
}

export function createMockBridge(): Bridge {
  const listeners = new Map<string, Set<(d: unknown) => void>>()
  const emit = <E extends EventName>(e: E, d: Events[E]) => listeners.get(e)?.forEach(cb => cb(d))
  let settings: Settings = structuredClone(defaultSettings)
  const settingsCbs = new Set<(s: Settings) => void>()
  const appCbs = new Set<(e: AppEvent) => void>()

  const started = Date.now()
  const media: MediaState = {
    hasSession: true, app: 'Spotify', title: 'Night Drive', artist: 'Kavinsky', album: 'OutRun', playing: true,
    positionMs: 74_000, durationMs: 214_000, sampledAt: Date.now(), art: gradient('#ff7a59', '#3b1d6e'),
    canNext: true, canPrev: true, sessions: [{ id: 's1', app: 'Spotify', playing: true }, { id: 's2', app: 'Chrome', playing: false }], currentSession: 's1',
  }
  const audio = { volume: 0.42, muted: false, device: 'Speakers (Realtek)', micMuted: false }
  const system = {
    network: { kind: 'wifi' as const, name: 'HomeNet-5G', signal: 0.8 }, bluetooth: { available: true, on: true },
    battery: { present: true, pct: 82, charging: false, minutesLeft: 214 }, keyboard: 'ENG', keepAwake: false, brightness: 0.7, darkMode: true, nightLight: false as boolean | null,
  }
  const apps: AppEntry[] = ['Spotify', 'Visual Studio Code', 'Google Chrome', 'Discord', 'File Explorer', 'Minecraft', 'Valorant', 'Calculator', 'Canva', 'Notepad', 'Terminal', 'Settings']
    .map((name, i) => ({ id: `app${i}`, name, kind: (['Minecraft', 'Valorant'].includes(name) ? 'game' : 'app') as AppEntry['kind'], starred: i < 2, lastUsed: Date.now() - i * 3_600_000 }))
  const day = 86_400_000
  const clips: ClipItem[] = [
    { id: 'c1', kind: 'text', preview: 'Pull up last quarter’s numbers and tell me what changed.', image: null, source: 'Chrome', at: Date.now() - 120_000, pinned: true, size: 56 },
    { id: 'c2', kind: 'link', preview: 'https://github.com/eashuu/lokey', image: null, source: 'Chrome', at: Date.now() - 900_000, pinned: false, size: 32 },
    { id: 'c3', kind: 'image', preview: '', image: gradient('#4b79a1', '#283e51', 200), source: 'Snipping Tool', at: Date.now() - 4_000_000, pinned: false, size: 120_000 },
    { id: 'c4', kind: 'text', preview: 'const spring = { stiffness: 260, damping: 24 }', image: null, source: 'Code', at: Date.now() - day - 1000, pinned: false, size: 44 },
  ]
  const walls: WallpaperItem[] = [
    ['#2c5364', '#0f2027'], ['#f7971e', '#8e2de2'], ['#4b79a1', '#283e51'], ['#134e5e', '#71b280'], ['#614385', '#516395'],
  ].map(([a, b], i) => ({ path: `C:\\Wallpapers\\wall${i}.jpg`, name: `wall${i}.jpg`, thumb: gradient(a, b, 320, 160) }))

  let statsTimer: ReturnType<typeof setInterval> | null = null
  const tick = (): StatsTick => {
    const t = (Date.now() - started) / 1000
    return {
      cpu: { pct: 24 + Math.sin(t / 3) * 14, name: 'AMD Ryzen 7 7840HS', ghz: 4.2, processes: 229, tempC: 58 },
      gpu: { pct: 11 + Math.sin(t / 2) * 6, name: 'NVIDIA RTX 4060', vramUsed: 2.1e9, vramTotal: 8e9 },
      ram: { used: 19.4e9 + Math.sin(t / 5) * 4e8, total: 31.9e9 },
      disk: { letter: 'C:', used: 412e9, total: 931e9 },
      net: { down: 1.2e6 + Math.random() * 6e5, up: 3e5 + Math.random() * 1e5 },
      uptimeSec: 5 * 3600 + 12 * 60 + t,
      top: [['Google Chrome', 1.4e9, 4], ['Visual Studio Code', 8.2e8, 2], ['Spotify', 4.1e8, 1], ['Discord', 3e8, 1], ['Explorer', 2.1e8, 0]]
        .map(([name, ramBytes, cpuPct]) => ({ name: name as string, ramBytes: ramBytes as number, cpuPct: cpuPct as number })),
    }
  }
  let vis: ReturnType<typeof setInterval> | null = null

  const handlers: { [M in MethodName]?: (p: Methods[M][0]) => Methods[M][1] | Promise<Methods[M][1]> } = {
    'sys.hello': () => ({ version: 1, host: 'mock' }),
    'display.get': () => ({ bounds: { x: 0, y: 0, w: 1920, h: 1080 }, work: { x: 0, y: 0, w: 1920, h: 1040 }, dpi: 96 }),
    'user.get': () => ({ name: 'Eashwar', avatar: gradient('#d9b556', '#b4572e', 96), machine: 'LOKEY-PC' }),
    'media.get': () => ({ ...media, sampledAt: Date.now() }),
    'media.control': ({ action }) => { if (action === 'toggle') media.playing = !media.playing; media.sampledAt = Date.now(); emit('media.changed', { ...media }); return {} },
    'audio.get': () => audio,
    'audio.setVolume': ({ level }) => { audio.volume = level; emit('audio.changed', { ...audio }); return {} },
    'audio.setMuted': ({ muted }) => { audio.muted = muted; emit('audio.changed', { ...audio }); return {} },
    'audio.visualiser': ({ on }) => {
      if (vis) clearInterval(vis)
      vis = on ? setInterval(() => emit('audio.bands', { bands: Array.from({ length: 32 }, (_, i) => 0.25 + 0.5 * Math.abs(Math.sin(Date.now() / 300 + i / 3)) * (1 - i / 48)) }), 33) : null
      return {}
    },
    'stats.subscribe': ({ intervalMs }) => {
      if (statsTimer) clearInterval(statsTimer)
      statsTimer = setInterval(() => emit('stats.tick', tick()), Math.max(500, intervalMs))
      return tick()
    },
    'stats.unsubscribe': () => { if (statsTimer) clearInterval(statsTimer); statsTimer = null; return {} },
    'system.get': () => system,
    'system.setKeepAwake': ({ on }) => { system.keepAwake = on; emit('system.changed', { ...system }); return {} },
    'system.setDarkMode': ({ on }) => { system.darkMode = on; emit('system.changed', { ...system }); return {} },
    'wifi.get': () => ({ available: true, on: true, connected: { ssid: 'HomeNet-5G', signal: 82 }, accessDenied: false }),
    'wifi.scan': () => [
      { ssid: 'HomeNet-5G', signal: 82, secured: true, connected: true, known: true },
      { ssid: 'Neighbour-2.4', signal: 61, secured: true, connected: false, known: false },
      { ssid: 'CafeGuest', signal: 44, secured: false, connected: false, known: false },
      { ssid: 'Office-WiFi', signal: 30, secured: true, connected: false, known: true },
    ],
    'wifi.setOn': () => ({}),
    'wifi.connect': () => ({ ok: true }),
    'wifi.disconnect': () => ({}),
    'bt.get': () => ({ available: true, on: true }),
    'bt.devices': () => [
      { id: 'b1', name: 'WH-1000XM5', kind: 'audio' as const, paired: true, connected: true, battery: 74 },
      { id: 'b2', name: 'Keyboard K380', kind: 'input' as const, paired: true, connected: false, battery: null },
      { id: 'b3', name: 'Pixel 8', kind: 'phone' as const, paired: true, connected: false, battery: null },
    ],
    'bt.discover': () => [{ id: 'b9', name: 'JBL Flip 6', kind: 'audio' as const, paired: false, connected: false, battery: null }],
    'bt.pair': () => ({ ok: true }),
    'bt.forget': () => ({}),
    'bt.connect': () => ({ ok: true }),
    'bt.disconnect': () => ({ ok: true }),
    'audio.devices': () => [
      { id: 'a1', name: 'Speakers (Realtek)', kind: 'output' as const, isDefault: true },
      { id: 'a2', name: 'Headphones (WH-1000XM5)', kind: 'output' as const, isDefault: false },
      { id: 'a3', name: 'Microphone (Realtek)', kind: 'input' as const, isDefault: true },
    ],
    'audio.setDefault': () => ({}),
    'system.setNightLight': ({ on }) => { system.nightLight = on; emit('system.changed', { ...system }); return { ok: true } },
    'system.setBrightness': ({ level }) => { system.brightness = level; emit('system.changed', { ...system }); return {} },
    'system.setBluetooth': ({ on }) => { system.bluetooth.on = on; emit('system.changed', { ...system }); return {} },
    'apps.list': () => apps,
    'apps.icon': ({ id }) => ({ icon: gradient('#3a3a44', '#1c1c20', 64, 45 + (id.length * 40) % 180) }),
    'apps.star': ({ id, on }) => { const a = apps.find(x => x.id === id); if (a) a.starred = on; return {} },
    'apps.searchFiles': ({ query }) => [{ name: `${query}-notes.txt`, path: `C:\\Users\\you\\Documents\\${query}-notes.txt` }],
    'clipboard.list': ({ query, kind }) => clips.filter(c => (!kind || c.kind === kind) && (!query || c.preview.toLowerCase().includes(query.toLowerCase()))),
    'clipboard.delete': ({ id }) => { const i = clips.findIndex(x => x.id === id); if (i >= 0) clips.splice(i, 1); return {} },
    'clipboard.clear': ({ keepPinned }) => { for (let i = clips.length - 1; i >= 0; i--) if (!keepPinned || !clips[i].pinned) clips.splice(i, 1); return {} },
    'clipboard.paste': () => ({}),
    'clipboard.pin': ({ id, on }) => { const c = clips.find(x => x.id === id); if (c) c.pinned = on; return {} },
    'wallpaper.get': () => ({ path: walls[0].path }),
    'wallpaper.recent': () => walls,
    'wallpaper.folder': () => walls.slice().reverse(),
    'wallpaper.thumb': ({ path }) => ({ thumb: walls.find(w => w.path === path)?.thumb ?? null }),
    'desktops.get': () => ({ count: 3, current: 0, occupied: [true, true, false] }),
    'foreground.get': () => ({ title: 'lokey', exe: 'lokey.exe', pid: 1 }),
  }

  return {
    kind: 'mock',
    async call(method, params) {
      const h = handlers[method] as ((p: unknown) => unknown) | undefined
      if (!h) return {} as never
      return (await h(params)) as never
    },
    on(event, cb) {
      let set = listeners.get(event)
      if (!set) listeners.set(event, (set = new Set()))
      set.add(cb as (d: unknown) => void)
      return () => { set!.delete(cb as (d: unknown) => void) }
    },
    setRegion() {},
    setFocusable() {},
    stage: async () => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio, workTop: 0 }),
    settings: {
      get: async () => settings,
      set: async patch => {
        const merge = (a: unknown, b: unknown): unknown => (b && typeof b === 'object' && !Array.isArray(b) ? Object.fromEntries(Object.keys(a as object).map(k => [k, merge((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k] ?? (a as Record<string, unknown>)[k])])) : b)
        settings = merge(settings, patch) as Settings
        settingsCbs.forEach(cb => cb(settings))
        return settings
      },
      onChange: cb => { settingsCbs.add(cb); return () => { settingsCbs.delete(cb) } },
    },
    onApp: cb => { appCbs.add(cb); return () => { appCbs.delete(cb) } },
    app: { openSettings() {}, quit() {}, log: m => console.log('[lokey]', m), openExternal: u => { window.open(u, '_blank') }, pickFolder: async () => null, openMain() {} },
    effects: { revealWallpaper: async () => undefined, glow() {} },
    voice: { info: async () => ({ hasKey: false, state: 'idle' as const, tasks: [] }), onEvent: () => () => undefined, setKey: async () => false, clearKey: async () => undefined, say() {}, hold() {}, cancelTask: async () => [], runTaskNow: async () => [], onTasks: () => () => undefined, memory: async () => [], forget: async () => [] },
  }
}
