# Architecture

lokey is three cooperating parts: a **renderer** (what you see), the Electron **main process** (windows, IPC, the voice agent) and a native **sidecar** (everything that needs Windows APIs).

```mermaid
flowchart TB
  subgraph R["Renderer pages (React 19)"]
    I["#  island overlay<br/>island/ tabs/ mascot/"]
    S["#settings · #main (Loadout, Desk, Bond)"]
    F["#caption · #dictation · #lasso · #glow · #reveal<br/>transient click-through effect pages"]
    AU["#agent<br/>hidden audio page"]
  end
  subgraph M["Main process"]
    IDX["index.ts<br/>windows · IPC · hotkey wiring"]
    AG["agent/<br/>Agent · GeminiSession · tools · scheduler<br/>Dictation · Lasso · overlays"]
    SC["sidecar.ts<br/>pipe client"]
  end
  H["Lokey.Host (.NET 8)"]
  I & S & F & AU <-- "preload bridge" --> IDX
  IDX --- AG
  IDX --- SC
  SC <-- "named pipe, JSON lines" --> H
  AG -- "WebSocket" --> G(["Gemini Live"])
```

## The three layers

### Renderer (`app/src/renderer/src`)

One bundle, many pages chosen by the URL hash (`main.tsx`): the island itself, Settings, the Loadout window, and small transparent pages used as overlays.

- **`island/`**: `Island.tsx` animates **one SVG path** from five numbers (depth, width, corner, ramp width, ramp height). The same string is the `clip-path` of the content, so shape and content can never drift apart. `store.ts` (zustand) holds the state machine (`shape`, `view`, `mode`, `soul`, `peek`, `caption`).
- **`tabs/`**: each tab is a self-contained component laid out in design pixels; `registry.tsx` lists them. Flyouts (Wi-Fi, Bluetooth, audio) are views too.
- **`mascot/`**: the spirit. `gl.ts` is a WebGL2 raymarcher (signed-distance body, arms, feet, face painted in the body's own space); `rig.ts` is a bank of spring-damped parameters; `poses.ts` describes each action as a function of time; `brain.ts` picks what to do (state from the app, one-shot actions, blinks, glances, fidgets); `bus.ts` carries `play`/`emote`/`level`/`look` events; `Emotes.tsx` floats the reaction glyphs. If WebGL2 is unavailable the flat 2D drawing in `island/Soul2D.tsx` takes over.
- **`lib/`**: `data.ts` (one zustand store fed by sidecar events), `theme.ts` (palette from the wallpaper), `region.ts` (shapes the overlay window), `media.ts`, `inputlog.ts`.
- **`bridge/`**: the *only* way pages talk to the outside. `window.lokey` (from the preload) in Electron; a fake `mock` bridge in a plain browser and for README art.

### Main process (`app/src/main`)

- **`index.ts`** creates the island overlay (a transparent, always-on-top, non-focusable window that is *shaped* with `BrowserWindow.setShape` to exactly the island, so there is no click-through toggling and no mouse hook), the tray, IPC handlers, hotkey registration and the QA modes.
- **`sidecar.ts`** spawns `Lokey.Host.exe` and talks to it over a per-launch named pipe (current user only).
- **`effects.ts`** and **`agent/overlays.ts`** create the transient click-through windows (wallpaper reveal, edge glow, caption bar, dictation, lasso).
- **`agent/`** is the voice layer:
  `agent.ts` (turn state machine) → `session.ts` (Gemini Live WebSocket) → `tools.ts` (the allow-listed actions) → `scheduler.ts` (persisted one-timer scheduler); `dictation.ts` and `lasso.ts` are the two other hold-to-use features; `audio.ts` owns the hidden microphone/speaker page; `keystore.ts` keeps the API key encrypted.

### Sidecar (`native/Lokey.Host`)

A headless .NET 8 program. `Pipe/Server.cs` accepts one client and `Pipe/Dispatcher.cs` routes `{id, method, params}` requests to the services (requests with the same method prefix run in order, different prefixes never block each other). `Services/` has one file per feature: `Media` (SMTC), `Audio` (NAudio + default-device switching), `Wifi`, `Bluetooth`, `Clipboard` (history store, DPAPI blobs, paste), `Apps`, `Wallpaper`, `Desktops`, `Foreground` (fullscreen detection), `Hotkeys` (registered hotkeys and the low-level keyboard hook for hold chords), `TextInput` (UI Automation focus rectangle, Unicode typing), `Stats`, `Status`, `NightLight`, `SystemControls`, `Visualiser`.

## The protocol

`app/src/shared/protocol.ts` is the contract: `Methods` (request → result) and `Events` (sidecar → app). Both the TypeScript main process and the C# `Args.*` calls follow it; adding a native feature means adding the method there first. Wire format: one JSON object per line, camelCase, nulls kept as `null`.

## Windows and overlays

| Window | Created by | Notes |
|---|---|---|
| Island overlay | `index.ts` | 1200×760, shaped to the island, `screen-saver` level, never focusable unless a text field pins it |
| Settings, Loadout | `windows.ts` | Normal windows with Mica |
| Caption bar | `agent/overlays.ts` | Click-through, bottom centre, speech pills |
| Dictation | `agent/overlays.ts` | Click-through, display-sized; pill and bubble placed at the focused field |
| Lasso | `agent/overlays.ts` | Click-through, display-sized canvas for the stroke |
| Glow, wallpaper reveal | `effects.ts` | Click-through, display-sized, torn down when done |
| Audio page | `agent/audio.ts` | Hidden; created on first use, destroyed after a minute idle |

## A voice turn, end to end

1. The sidecar's keyboard hook sees the hold chord and emits `hotkey.down`.
2. `Agent.begin()` opens the mic in the audio page, connects (or reuses) a `GeminiSession` and streams 16 kHz PCM.
3. Input transcription streams back and becomes the "YOU" pill; the island wakes and the spirit listens.
4. On release the agent sends `audioStreamEnd`; the spirit thinks (edge glow on).
5. The model answers with audio (played in the audio page, lip-sync from its level) and/or tool calls. `tools.ts` runs them and returns results; the caption shows what was done.
6. `turnComplete` → the spirit celebrates, the caption clears, the session idles out after a minute.

## Design notes

- **Everything that moves is `transform`/`opacity`**; nothing animates blur or box-shadow. The 3D spirit only renders while visible and releases its WebGL context when it is not.
- **No polling**: the sidecar uses WinEvent hooks, registry notifications, SMTC events and debounced emitters; the scheduler keeps one timer.
- **No synthetic input in tests**: see [DEVELOPMENT.md](DEVELOPMENT.md).
- Known weaknesses and the plan to fix them are in [REVIEW-AND-ROADMAP.md](REVIEW-AND-ROADMAP.md).
