// The ONLY surface the renderer uses to talk to the outside world. Electron implements it through the
// preload script; a later Tauri port implements the same interface. The renderer never imports electron or node.
import type { EventName, Events, MethodName, Methods } from './protocol'
import type { Lyrics, TrackQuery } from './lyrics'
import type { FactView, GraphView, JournalView, LessonView, MemoryStats, ProposalView, QuarantineView } from './memory'
import type { ActionRecord, AgentTask, ScheduledTask, VoiceEvent, VoiceInfo } from './voice'

export type TabId = 'controls' | 'today' | 'stats' | 'clipboard' | 'apps' | 'wallpaper' | 'power' | 'agents'

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
    /** how the sleeping island looks: a small notch, or a hairline that barely covers the screen edge */
    sleepLook: 'sliver' | 'hairline'
    /** which screen edge the island hangs from, and how far along it (0..1) */
    edge: 'top' | 'bottom' | 'left' | 'right'
    offset: number
    /** hold this chord and the island follows the pointer; let go to drop it on the nearest edge or corner */
    moveKey: string
    /** opens / closes the lyrics window */
    lyricsKey: string
    /** synced lyrics under the music player */
    lyrics: 'on' | 'off'
    /** global shortcut that opens the island straight on a tab ('' = none); pressing it again closes the island */
    tabHotkeys: Record<TabId, string>
  }
  appearance: {
    theme: 'dark' | 'light' | 'auto'
    accent: 'wallpaper' | string   // 'wallpaper' or a #rrggbb colour
    scale: number                  // 0.75..1.5
    animSpeed: number              // 0 = off, 1 = normal, 2 = twice as fast
    reduceMotion: boolean
  }
  wallpaper: { folder: string | null }
  /** the lyrics window: where it was left, whether it floats above other windows, text size */
  lyricsWin: { x: number | null; y: number | null; w: number; h: number; pinned: boolean; scale: number }
  loadout: { soul: string; personality: string; voice: string; abilities: string[]; personalities: { id: string; name: string; prompt: string }[] }
  voice: {
    enabled: boolean
    model: string                  // Gemini Live model id (the first choice)
    /** other Live model ids to try, in order, when the first keeps failing (voice ladder rung 1; empty = ask Google which ones this key has) */
    models: string[]
    pushToTalk: string             // hold-to-talk chord
    dictation: boolean
    dictationKey: string           // hold chord for dictation
    lasso: boolean
    lassoKey: string               // hold chord for circle-to-ask
    conversationKey: string        // toggles hands-free conversation mode ('' = none)
    /** conversation mode: stop listening while the assistant speaks (needed with speakers; turn off with headphones to interrupt by voice) */
    halfDuplex: boolean
    speakReplies: boolean          // play the assistant's voice (otherwise captions only)
    /** language the assistant answers in: follow the user, or always Tamil (Tanglish-friendly) / English */
    language: 'auto' | 'ta' | 'en'
    /** answer only after the key is released (turns off Gemini's own voice detection); off = old automatic behaviour */
    holdToAnswer: boolean
    /** how dictation writes Tamil: Tamil letters with English words kept, Latin letters (Tanglish), or translated to English */
    dictationScript: 'mixed' | 'roman' | 'english'
  }
  agent: {
    /** how much Lokey may do without asking: 'risky' asks before anything that changes things outside the app, 'always' before every
     *  action, 'full' never asks (shell, files, mouse and keyboard run on their own; a short protected list still applies) */
    confirmMode: 'risky' | 'always' | 'full'
    /** epoch ms until which full control is granted for a limited time ("full control for 30 minutes"); null = not granted */
    fullUntil: number | null
    /** stops every running task, agent and conversation at once */
    stopKey: string
    /** where requests for the person show up: inside the island ('island', the default) or in the separate confirm window ('window'). The window is also the fallback when the island is hidden or the screens changed. */
    confirmIn: 'island' | 'window'
    /** a soft tone when a request arrives (off by default) */
    askSound: boolean
    /** global chords that answer the card on screen; they do nothing unless a card has been showing for a moment */
    allowKey: string
    denyKey: string
    /** tell the assistant which app/window is in front on every turn */
    context: boolean
    /** extra abilities from MCP servers (stdio) */
    mcp: McpServerConfig[]
  }
  /** wake-up: wake Lokey without touching the keyboard. Audio is analysed on this PC only and never stored or sent anywhere. */
  wake: {
    enabled: boolean
    claps: boolean
    phrases: boolean
    /** how sure the speech recogniser must be (0.5..0.95) */
    confidence: number
    /** 0.5 = needs a sharp loud clap, 1.5 = picks up soft claps */
    clapSensitivity: number
    /** what each phrase does: listen = start a conversation, greet = greet first, welcome = greet, brief and pick up where you left off */
    list: { text: string; action: 'listen' | 'greet' | 'welcome' }[]
  }
  /** guardrails (round 9): the optional injection classifier (Prompt Guard; none is bundled yet, so this does nothing until one is added) */
  guard: { promptGuard: boolean }
  /** memory v2: seal the content of memories in lokey.db (default on), a Windows Hello gate for the Brain page (stub: not built), and the opt-in read-only MCP server over memory */
  memory: { encrypt: boolean; hello: boolean; mcp: { enabled: boolean; port: number } }
  brain: {
    providers: ProviderConfig[]
    /** one setting for how the chain is ordered: best quality (the order of the list), fastest first, or the one that saves free quota */
    preset: ModelPreset
    /** use the local model (Ollama...) when the internet is down */
    offlineLocal: boolean
    /** most model calls one task may make */
    maxSteps: number
    /** a model you add must pass the eval set (80%) before it may serve the main and screen roles (press Test on it) */
    admission: boolean
    /** `id|model|role` entries that passed */
    admitted: string[]
    /** learn from conversations and jobs (the memory on the Bond page); off = it only remembers what you tell it to */
    learn: boolean
    /** meaning-based memory search with Google's free embedding model (falls back to word matching) */
    embed: boolean
    /** programs whose conversations are never learned from (matched in the program name) */
    excludeApps: string[]
    /** coding agents installed on this PC that Lokey may hand work to (they use your own logged-in CLI) */
    cli: { claude: boolean; codex: boolean; folder: string; allowEdits: boolean }
  }
  /** Android only (ignored on Windows): which live activities the island shows, haptics, how lively the spirit is */
  phone: { activities: string[]; haptics: boolean; spirit: 'full' | 'calm'; /** draw the island over other apps (a native overlay at the camera cutout) */ systemIsland: boolean; /** show activities as Android 16 Live Update notifications */ liveUpdates: boolean; /** vivo's own Origin Island route (notification extras), experimental */ vivoIsland: boolean }
  focusTimerMinutes: number
  startWithWindows: boolean
  /** settings upgrade level applied so far (see SettingsStore.load) */
  migrated: number
}

/** What a model is used for. fast/main/heavy are the text roles; the rest are the other kinds of call Lokey makes, all routed through the gateway
 *  (main/ai/gateway.ts). `live` (realtime voice) is listed for the catalog but is not served by the gateway yet. */
export type BrainRole = 'fast' | 'main' | 'heavy' | 'vision' | 'ground' | 'transcribe' | 'search' | 'embed' | 'live'
/** A model's abilities. Inferred from its kind and name; anything set in `ProviderConfig.caps` wins. */
export interface ModelCaps { tools: boolean; vision: boolean; audioIn: boolean; json: boolean; embed: boolean; search: boolean; ctx: number; maxOut: number }
/** One language-model backend. The ORDER of the list is the order they are tried in; `roles` says what each is used for. */
export interface ProviderConfig {
  id: string
  name: string
  /** gemini = Google's generateContent API; openai = any OpenAI-compatible /chat/completions endpoint (FreeLLMAPI, OpenRouter, Groq, Ollama...) */
  kind: 'gemini' | 'openai'
  baseUrl: string
  model: string
  enabled: boolean
  /** which stored key to use ('gemini' is the voice key); the key itself never leaves the main process */
  keyRef: string
  /** all the keys of this provider (the first is `keyRef`); a bad one never rests the provider while another works. Absent in older files: [keyRef]. */
  keyRefs?: string[]
  roles: BrainRole[]
  /** stop using it for the day after this many requests (0 = no limit of our own) */
  dailyLimit: number
  /** requests per minute it allows (0 = unknown) */
  rpm?: number
  /** runs on this PC or LAN (Ollama, LM Studio): used when offline. Detected from localhost/LAN addresses when not set. */
  local?: boolean
  /** overrides for what the model can do (see ModelCaps) */
  caps?: Partial<ModelCaps>
}

/** One row of the "Model calls" viewer (Settings > Brain). */
export interface TraceRow { id: number; at: number; op: string; role: string; provider: string; model: string; ok: boolean; kind: string; attempt: number; ms: number; tin: number; tout: number; chain: string; note: string }
/** Per provider, today: how much it was used, whether it is resting and why. */
export interface ProviderStatus { id: string; requests: number; tin: number; tout: number; errors: number; limit: number; exhaustedUntil: number | null; restingUntil: number | null; breaker: 'closed' | 'open' | 'half'; demerits: number; note: string }
export interface BrainStatus { providers: ProviderStatus[]; offline: boolean; db: boolean }

/** How the model chain is ordered (Settings > Models): the order of the list, fastest answers first, or whoever has used the least free quota today. */
export type ModelPreset = 'quality' | 'fast' | 'save'
/** A key family on the Keys list (Settings > Models). `other` = any OpenAI-compatible endpoint, FreeLLMAPI included. */
export type KeyFamily = 'gemini' | 'openrouter' | 'other' | 'ollama'
/** One saved key: `ref` is what the commands take, never the key itself (only the last 4 characters are shown). */
export interface ModelKeyStatus { ref: string; hint: string; state: 'ok' | 'resting' | 'rejected' | 'limit'; until?: number; note?: string }
export interface ModelProviderStatus {
  id: string; family: KeyFamily; label: string; enabled: boolean; keys: ModelKeyStatus[]; model: string; caps: string[]
  /** ok | resting | rejected | limit | off */
  state: 'ok' | 'resting' | 'rejected' | 'limit' | 'off'
  usedToday: number; note?: string
}
/** Pushed main -> renderer on change (at most twice a second): the data behind the one-glance Models page. Contract in docs/AI-FAILSAFE.md section 6. */
export interface ModelsStatus {
  mode: 'online' | 'offline' | 'degraded'
  using: { providerId: string; model: string; label: string } | null
  backups: number
  requestsToday: number
  voice: { rung: 'live' | 'live-alt' | 'cascade' | 'text' | 'spoken-text'; model: string; note?: string }
  providers: ModelProviderStatus[]
  preset: ModelPreset
  /** the "use my local model when offline" switch (an addition to the section-6 contract: the page needs its current value) */
  offlineLocal: boolean
}
export interface ModelsApi {
  /** the current picture now */
  status(): Promise<ModelsStatus>
  /** pushed on change, throttled to 2 per second */
  onStatus(cb: (s: ModelsStatus) => void): () => void
  /** `family` 'gemini' | 'openrouter' | 'ollama' | 'other'; `key` is the secret (checked by prefix: AIza.. = Google, sk-or-.. = OpenRouter); `baseUrl` only for 'other'. Models and abilities are discovered and the provider is switched on. */
  addKey(a: { family: KeyFamily; key: string; baseUrl?: string }): Promise<{ ok: boolean; ref?: string; providerId?: string; error?: string }>
  removeKey(ref: string): Promise<{ ok: boolean; error?: string }>
  /** a provider id or a key ref: one cheap request; the answer says what happened in a sentence */
  test(target: string): Promise<{ ok: boolean; ms: number; reply?: string; error?: string }>
  setPreset(p: ModelPreset): Promise<void>
  setOfflineLocal(on: boolean): Promise<void>
}

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  enabled: boolean
  /** its tools run without asking (otherwise every call shows a confirm card) */
  trusted: boolean
}

export const defaultSettings: Settings = {
  island: {
    enabled: true,
    hotkey: 'Ctrl+Alt+Space',
    tabs: ['controls', 'today', 'stats', 'clipboard', 'apps', 'wallpaper', 'power', 'agents'],
    openOnHover: true,
    hoverDelayMs: 160,
    closeDelayMs: 420,
    scrollToOpen: true,
    startTab: 'controls',
    size: 1,
    trigger: 'both',
    rest: 'sleep',
    sleepLook: 'sliver',
    edge: 'top',
    offset: 0.5,
    moveKey: 'Win+Shift',
    lyricsKey: 'Ctrl+Alt+Y',
    lyrics: 'on',
    tabHotkeys: { controls: '', today: '', stats: '', clipboard: 'Ctrl+Alt+C', apps: 'Ctrl+Alt+A', wallpaper: '', power: '', agents: '' },
  },
  appearance: { theme: 'auto', accent: 'wallpaper', scale: 1, animSpeed: 1, reduceMotion: false },
  wallpaper: { folder: null },
  lyricsWin: { x: null, y: null, w: 460, h: 700, pinned: false, scale: 1 },
  loadout: { soul: 'puff', personality: 'chad', voice: 'Charon', abilities: [], personalities: [{ id: 'chad', name: 'True Chad', prompt: 'Confident, direct, a little cheeky. Short answers. Gets things done.' }] },
  voice: {
    enabled: true,
    model: 'gemini-3.8-live',
    models: [],
    pushToTalk: 'Ctrl+Alt+V',
    dictation: true,
    dictationKey: 'Ctrl+Win',
    lasso: true,
    lassoKey: 'Ctrl+Alt+L',
    conversationKey: 'Ctrl+Alt+T',
    halfDuplex: true,
    speakReplies: true,
    language: 'auto',
    holdToAnswer: true,
    dictationScript: 'mixed',
  },
  agent: { confirmMode: 'risky', fullUntil: null, stopKey: 'Ctrl+Alt+Backspace', confirmIn: 'island', askSound: false, allowKey: 'Ctrl+Alt+Shift+Y', denyKey: 'Ctrl+Alt+Shift+N', context: true, mcp: [] },
  wake: {
    enabled: false, claps: true, phrases: true, confidence: 0.82, clapSensitivity: 1,
    list: [{ text: 'hey lokey', action: 'listen' }, { text: 'wake up buddy', action: 'greet' }, { text: "daddy's home", action: 'welcome' }],
  },
  guard: { promptGuard: false },
  memory: { encrypt: true, hello: false, mcp: { enabled: false, port: 7749 } },
  brain: {
    providers: [
      { id: 'gemini-flash', name: 'Gemini Flash', kind: 'gemini', baseUrl: '', model: 'gemini-flash-latest', enabled: true, keyRef: 'gemini', roles: ['main', 'heavy', 'vision', 'ground', 'transcribe', 'search'], dailyLimit: 0 },
      { id: 'gemini-lite', name: 'Gemini Flash-Lite', kind: 'gemini', baseUrl: '', model: 'gemini-flash-lite-latest', enabled: true, keyRef: 'gemini', roles: ['fast'], dailyLimit: 0 },
      { id: 'gemini-embed', name: 'Gemini embeddings', kind: 'gemini', baseUrl: '', model: 'gemini-embedding-001', enabled: true, keyRef: 'gemini', roles: ['embed'], dailyLimit: 0 },
      { id: 'ollama', name: 'Ollama (local, works offline)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', enabled: false, keyRef: 'ollama', roles: ['fast', 'main'], dailyLimit: 0, local: true },
      { id: 'ollama-ground', name: 'Local screen model (Ollama, for the screen operator)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', enabled: false, keyRef: 'ollama', roles: ['ground', 'vision'], dailyLimit: 0, local: true },
      { id: 'freellmapi', name: 'FreeLLMAPI (local)', kind: 'openai', baseUrl: 'http://localhost:3001/v1', model: '', enabled: false, keyRef: 'freellmapi', roles: ['fast', 'main'], dailyLimit: 0, local: false },
      { id: 'openrouter', name: 'OpenRouter (free models)', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '', enabled: false, keyRef: 'openrouter', roles: ['main'], dailyLimit: 0 },
    ],
    maxSteps: 14,
    admission: true,
    preset: 'quality',
    offlineLocal: true,
    admitted: [],
    learn: true,
    embed: true,
    excludeApps: ['keepass', '1password', 'bitwarden', 'lastpass', 'dashlane'],
    cli: { claude: true, codex: true, folder: '', allowEdits: false },
  },
  phone: { activities: ['approval', 'voice', 'timer', 'job', 'music', 'reminder', 'charging', 'pc'], haptics: true, spirit: 'full', systemIsland: true, liveUpdates: true, vivoIsland: true },
  focusTimerMinutes: 25,
  startWithWindows: false,
  migrated: 0,
}

/** Where the overlay window sits, in CSS pixels of the overlay itself (so the renderer lays out against it). */
export interface Stage {
  width: number
  height: number
  scale: number                    // devicePixelRatio of the display
  workTop: number                  // CSS px between the screen top and the usable work area (0 normally)
}

/** Whole-screen effects drawn by their own transient click-through windows. */
export type GlowState = 'off' | 'thinking' | 'speaking' | 'research'
export type MainPage = 'home' | 'bond' | 'soul' | 'desk' | 'settings'

export interface Bridge {
  readonly kind: 'electron' | 'mock' | 'android'
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
    /** opens the Settings page of the main window (optionally a section: general, island, appearance, voice, shortcuts, wallpaper, about) */
    openSettings(section?: string): void
    quit(): void
    log(message: string): void
    openExternal(url: string): void
    pickFolder(): Promise<string | null>
    /** Opens the main app window (Loadout etc.). */
    openMain(page?: MainPage, section?: string): void
    /** the main window was asked to go somewhere (tray, key button, voice) while already open */
    onNav(cb: (n: { page: MainPage; section?: string }) => void): () => void
  }
  effects: {
    /** New wallpaper grows as a circle from a screen point, then is applied. x/y in screen px. Resolves when done. */
    revealWallpaper(path: string, x: number, y: number): Promise<void>
    /** Screen-edge glow while the assistant thinks or speaks. */
    glow(state: GlowState): void
  }
  voice: {
    info(): Promise<VoiceInfo>
    onEvent(cb: (e: VoiceEvent) => void): () => void
    /** Google AI Studio key; stored encrypted on this PC, never sent anywhere but Google. */
    setKey(key: string): Promise<boolean>
    clearKey(): Promise<void>
    /** type a request instead of speaking it */
    say(text: string): void
    /** push-to-talk from the UI (the mic button / held shape) */
    hold(on: boolean): void
    cancelTask(id: string): Promise<ScheduledTask[]>
    runTaskNow(id: string): Promise<ScheduledTask[]>
    onTasks(cb: (t: ScheduledTask[]) => void): () => void
    /** facts the assistant remembers about you */
    memory(): Promise<string[]>
    forget(fact: string): Promise<string[]>
    /** hands-free conversation mode on/off */
    toggleConversation(): void
    /** forget the recent conversation (the saved facts stay) */
    clearConversation(): Promise<void>
    /** what the assistant did (newest first) */
    actions(): Promise<ActionRecord[]>
    clearActions(): Promise<void>
    trustRules(): Promise<string[]>
    trustRevoke(sig: string): Promise<void>
    undoList(): Promise<{ id: string; at: string; summary: string }[]>
    undoRun(id: string): Promise<string>
    loops(): Promise<{ id: string; what: string; who?: string; due?: string }[]>
    loopSet(id: string, action: 'done' | 'drop' | 'snooze'): Promise<boolean>
    /** routines learned by watching: review, edit (name, step apps), delete; and the watch switch */
    routines(): Promise<{ id: string; name: string; steps: { app: string; label: string }[]; runs: number; approved: boolean }[]>
    routineSave(id: string, patch: { name?: string; steps?: { app: string; label?: string }[] }): Promise<boolean>
    routineDelete(id: string): Promise<boolean>
    watchStatus(): Promise<{ active: boolean; name?: string; steps: number }>
    watchStart(name: string): Promise<boolean>
    watchStop(): Promise<string | null>
    /** connected MCP servers and the tools each one offers */
    mcpStatus(): Promise<{ id: string; name: string; ok: boolean; tools: number; error?: string }[]>
  }
  /** Why a global shortcut could not be registered (empty string = fine), keyed island | talk | dictation | lasso | tab:<id>. */
  place: {
    get(): Promise<{ edge: 'top' | 'bottom' | 'left' | 'right'; along: number; editing: false | 'hold' | 'pick' }>
    onChange(cb: (p: { edge: 'top' | 'bottom' | 'left' | 'right'; along: number; editing: false | 'hold' | 'pick' }) => void): () => void
    /** pointer position (display px) while the move chord is held */
    onCursor(cb: (pt: { x: number; y: number }) => void): () => void
    /** start moving the island by clicking where it should go (the hold chord starts a move on its own) */
    start(mode: 'pick'): void
    commit(edge: 'top' | 'bottom' | 'left' | 'right', offset: number): void
    cancel(): void
  }
  wake: { status(): Promise<import('./protocol').WakeStatus> }
  /** Lokey Link: pair a phone over the LAN (Settings > Devices). On the PC this manages the paired phones; on Android (kind 'android') the
   *  same calls describe the paired PC ("client mode": state() lists it as the one device, revoke()/setEnabled(false) unpair), and the optional
   *  methods below exist only there. */
  link: {
    state(): Promise<{ enabled: boolean; running: boolean; port: number; url: string | null; pairing: boolean; devices: { id: string; name: string; scopes: string[]; created: number; lastSeen: number }[] }>
    setEnabled(on: boolean): Promise<unknown>
    newCode(): Promise<{ code: string; expiresAt: number }>
    revoke(id: string): Promise<boolean>
    /** Android: pair with the PC at `address` (ip[:port] or a full http address) using the 6-digit code shown there; rejects with a message fit to show the user */
    pair?(req: { address: string; code: string }): Promise<{ ok: true }>
    /** Android: sync memory with the PC both ways */
    sync?(): Promise<{ pulled: number; pushed: number }>
    /** Android: what the PC is doing (null = unreachable) */
    pcStatus?(): Promise<{ pc: string; agent: string; battery?: unknown; nowPlaying?: { app: string; title: string; artist: string; playing: boolean } | null; jobs?: string[] } | null>
    /** Android: send a typed request to the PC's assistant ("ask the PC") */
    say?(text: string): Promise<{ ok: boolean; error?: string }>
    /** Android: answer a confirm card the PC is showing */
    approve?(id: string, allow: boolean): Promise<boolean>
    /** Android: live events from the PC: 'confirm' (data = the card), 'confirm-done', 'job', 'nudge', 'connected', 'disconnected', 'revoked' */
    onEvent?(cb: (e: { type: string; data?: unknown }) => void): () => void
  }
  /** what Lokey knows: facts, people and projects, lessons, the daily journal */
  memory: {
    list(): Promise<FactView[]>
    search(query: string): Promise<FactView[]>
    graph(): Promise<GraphView>
    lessons(): Promise<LessonView[]>
    journal(): Promise<JournalView[]>
    stats(): Promise<MemoryStats>
    add(text: string): Promise<boolean>
    edit(id: string, text: string): Promise<boolean>
    remove(id: string): Promise<void>
    pin(id: string, on: boolean): Promise<void>
    /** the memory as JSON text (for backup) */
    exportJson(): Promise<string>
    /** facts learned from untrusted content, waiting for approval (never used until approved) */
    /** the opt-in read-only MCP server over memory: is it running, the port, the token to paste into the client */
    mcpInfo?(): Promise<{ enabled: boolean; port: number; running: boolean; token: string }>
    quarantine?(): Promise<QuarantineView[]>
    approve?(id: string): Promise<boolean>
    reject?(id: string): Promise<boolean>
    /** the core profile that is always in the prompt, and refreshed versions waiting for approval */
    core?(): Promise<{ text: string; proposals: ProposalView[] }>
    setCore?(text: string): Promise<void>
    proposal?(id: string, approve: boolean): Promise<void>
    clear(): Promise<void>
    onChange(cb: () => void): () => void
  }
  /** background jobs: workers, helpers, the screen operator, coding agents */
  agents: {
    list(): Promise<AgentTask[]>
    /** stop one job, or every job and conversation with 'all' */
    stop(id: string): void
    /** jobs the app was closed in the middle of (they can be continued from the last complete step, or discarded) */
    interrupted?(): Promise<{ id: string; goal: string; role: string; at: number }[]>
    resume?(id: string): Promise<{ id: string } | { error: string }>
    discard?(id: string): Promise<void>
    onChange(cb: (tasks: AgentTask[]) => void): () => void
    /** the Flow tab's feed: jobs, schedule, open loops, serving models, connectors. One snapshot now; pushes (<= 2/s) while watching. */
    graph?(): Promise<import('./graph').GraphSnapshot>
    watchGraph?(on: boolean): void
    onGraph?(cb: (g: import('./graph').GraphSnapshot) => void): () => void
    /** start a finished job again with the same request */
    retry?(id: string): Promise<{ id: string } | { error: string }>
  }
  /** the simple model settings (Settings > Models): status feed and key / preset commands. The gateway view stays under `brain`. */
  models: ModelsApi
  /** the model layer: providers, keys and today's usage (keys are only ever stored and used in the main process) */
  brain: {
    usage(): Promise<Record<string, { requests: number; in: number; out: number; errors: number }>>
    /** the gateway's view: quota, resting providers, circuit breakers */
    status?(): Promise<BrainStatus>
    /** the hash-chained audit log: is the chain intact (and where it first breaks) */
    audit?(): Promise<{ ok: boolean; count: number; brokenAt?: number }>
    /** recent model calls, newest first */
    traces?(filter?: { role?: string; provider?: string; failed?: boolean; limit?: number }): Promise<TraceRow[]>
    test(id: string): Promise<{ ok: boolean; ms: number; reply?: string; error?: string; tools?: boolean; admission?: { role: string; score: number; admitted: boolean; skipped?: string }[] }>
    hasSecret(ref: string): Promise<boolean>
    setSecret(ref: string, value: string): Promise<boolean>
    clearSecret(ref: string): Promise<void>
    /** which coding agents are installed on this PC */
    cli(): Promise<{ claude: boolean; codex: boolean }>
    /** the assistant's instruction files: open the folder, or restore the defaults */
    prompts(action: 'open' | 'reset'): void
  }
  lyrics: {
    /** synced lyrics for a track (from LRCLIB, cached on disk) */
    get(track: TrackQuery): Promise<Lyrics>
    /** remember the user's timing nudge for this track */
    setOffset(key: string, offsetMs: number): Promise<void>
    /** the lyrics window */
    openWindow(): void
    win: { close(): void; setPinned(on: boolean): void }
  }
  hotkeyStatus(): Promise<Record<string, string>>
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
  | { type: 'open-island'; tab?: TabId; toggle?: boolean }
  | { type: 'close-island' }
  | { type: 'blur' }
  | { type: 'fullscreen'; full: boolean }
  | { type: 'bench'; step: string; arg?: string }

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] }

declare global {
  interface Window { lokey?: Bridge; lokeyFlags?: { mock: boolean; demo?: boolean; edge?: string; along?: number } }
}
