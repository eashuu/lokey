// The ONLY surface the renderer uses to talk to the outside world. Electron implements it through the
// preload script; a later Tauri port implements the same interface. The renderer never imports electron or node.
import type { EventName, Events, MethodName, Methods } from './protocol'

export type TabId = 'controls' | 'today' | 'stats' | 'clipboard' | 'apps' | 'wallpaper' | 'power'

export interface Settings {
  island: {
    enabled: boolean
    hotkey: string                 // toggles the island open/closed
    tabs: TabId[]                  // order; omitted tabs are hidden
    openOnHover: boolean
    hoverDelayMs: number
    closeDelayMs: number
    scrollToOpen: boolean
    startTab: TabId
    size: number                   // 0.7..1.2, scales the island (on top of appearance.scale)
    trigger: 'scroll' | 'hover' | 'both'
    rest: 'sleep' | 'awake'        // the shape the island rests in when closed
  }
  appearance: {
    theme: 'dark' | 'light' | 'auto'
    accent: 'wallpaper' | string   // 'wallpaper' or a #rrggbb colour
    scale: number                  // 0.75..1.5
    animSpeed: number              // 0 = off, 1 = normal, 2 = twice as fast
    reduceMotion: boolean
  }
  wallpaper: { folder: string | null }
  focusTimerMinutes: number
  startWithWindows: boolean
}

export const defaultSettings: Settings = {
  island: {
    enabled: true,
    hotkey: 'Ctrl+Alt+Space',
    tabs: ['controls', 'today', 'stats', 'clipboard', 'apps', 'wallpaper', 'power'],
    openOnHover: true,
    hoverDelayMs: 160,
    closeDelayMs: 420,
    scrollToOpen: true,
    startTab: 'controls',
    size: 1,
    trigger: 'both',
    rest: 'sleep',
  },
  appearance: { theme: 'dark', accent: 'wallpaper', scale: 1, animSpeed: 1, reduceMotion: false },
  wallpaper: { folder: null },
  focusTimerMinutes: 25,
  startWithWindows: false,
}

/** Where the overlay window sits, in CSS pixels of the overlay itself (so the renderer lays out against it). */
export interface Stage {
  width: number
  height: number
  scale: number                    // devicePixelRatio of the display
  workTop: number                  // CSS px between the screen top and the usable work area (0 normally)
}

export interface Bridge {
  readonly kind: 'electron' | 'mock'
  call<M extends MethodName>(method: M, params: Methods[M][0]): Promise<Methods[M][1]>
  on<E extends EventName>(event: E, cb: (data: Events[E]) => void): () => void

  /** Shapes the overlay window to these rectangles (overlay CSS px); everything outside is click-through by construction. */
  setRegion(rects: { x: number; y: number; w: number; h: number }[]): void
  /** Ask for keyboard focus (launcher-style input). The overlay is non-focusable otherwise. */
  setFocusable(on: boolean): void

  stage(): Promise<Stage>
  settings: {
    get(): Promise<Settings>
    set(patch: DeepPartial<Settings>): Promise<Settings>
    onChange(cb: (s: Settings) => void): () => void
  }
  /** Events from main that are not sidecar events. */
  onApp(cb: (e: AppEvent) => void): () => void
  app: {
    openSettings(): void
    quit(): void
    log(message: string): void
    openExternal(url: string): void
    pickFolder(): Promise<string | null>
  }
  /** Present only under `--bench <dir>`: the renderer drives the run, main captures screenshots and process metrics. */
  bench?: {
    config(): Promise<{ dir: string } | null>
    capture(name: string): Promise<void>
    metrics(): Promise<unknown>
    finish(report: unknown): Promise<void>
  }
}

export type AppEvent =
  | { type: 'toggle-island' }
  | { type: 'open-island'; tab?: TabId }
  | { type: 'close-island' }
  | { type: 'blur' }
  | { type: 'fullscreen'; full: boolean }
  | { type: 'bench'; step: string; arg?: string }

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }

declare global {
  interface Window { lokey?: Bridge; lokeyFlags?: { mock: boolean } }
}
