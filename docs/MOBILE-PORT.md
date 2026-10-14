# Lokey for Android: the real port

Goal: the same Lokey on the phone (vivo T4 Ultra, OriginOS 6 / Android 16 first): the island, the spirit, voice agent, tools, brain and memory, jobs, trust and undo, Desk/Bond/Settings, lyrics, wake-up, and a live link to the Windows Lokey. Standalone first; pairing adds sync and remote work. (This replaces the earlier small `android/` prototype, which is retired.)

## Architecture: one codebase, two bodies

```
React UI (app/src/renderer)  ──same code──►  Windows: Electron renderer        Android: Capacitor WebView
Bridge interface (shared/bridge.ts)           preload → ipc → main → sidecar     mobile bridge → core (in the page) → native plugin
core = app/src/main/{agent,brain,...}         runs in Electron main (Node)       runs in the WebView through shims (src/mobile/shims)
native abilities                              .NET sidecar (Lokey.Host)          Kotlin Capacitor plugin `LokeyNative`
```

- **UI**: `app/src/renderer` is reused as is, with phone layouts (responsive, safe areas, touch). `bridge/index.ts` picks the Android bridge when running inside Capacitor.
- **Core in the page**: the main-process modules (agent, session, brain, memory, scheduler, trust, undo, nudge...) are bundled for the WebView by `vite.mobile.config.ts`. `electron` and Node modules are aliased to browser shims in `app/src/mobile/shims/` (in-process IPC, a persistent fs, secrets, notifications...). The Windows app is **not** changed by this (shims are only aliased in the mobile build); platform-specific code gets small `if (isMobile)` seams only where unavoidable.
- **Native plugin** (`app/mobile/android/app/src/main/java/app/lokey/link/`): answers the same method names the Windows sidecar answers (`audio.get`, `media.get`, `system.get`, `wifi.get`, `bt.get`, `apps.list`, `clipboard.*`, ...) with Android implementations, plus phone-only methods (intents, accessibility actions, SMS/calls/contacts, notifications, media session, screenshots, floating island). The UI tabs therefore work unchanged.
- **Link to the PC**: the phone is a Lokey Link client (`app/src/main/link`): pairing, approvals, `ask_pc`, memory sync, notifications. Phone requests keep the PC-side limits (never full control, no earned trust).

## Windows feature → Android equivalent

| Windows | Android |
|---|---|
| Island at screen edge, always on top | in-app island + system overlay island (SYSTEM_ALERT_WINDOW) + Live Update / Origin Island notification |
| Hold-to-talk hotkey | on-screen hold button, volume-key chord option, QS tile, assistant invoke, wake word |
| Hold-to-dictate (types into focused app) | accessibility service types into the focused field; clipboard fallback |
| Circle-to-ask (lasso on screen) | screenshot (accessibility `takeScreenshot` / MediaProjection) + draw overlay |
| Computer use (mouse/keys) | accessibility service: read UI tree, tap, swipe, type, back/home, open app |
| run_command / files | scoped app storage + shared storage (permission), no shell (Termux optional later) |
| Windows list/focus, processes | recent apps, running app info, accessibility foreground app |
| Clipboard history | foreground-only clipboard read (Android 10+ limit), own history while Lokey is open |
| Media + lyrics | notification-listener MediaSession (any music app) + LRCLIB lyrics window/overlay |
| Wi-Fi / Bluetooth / volume / brightness / battery / network | the same panels, Android APIs (some toggles open the system panel on Android 10+) |
| Wake word + double clap | foreground service with AudioRecord clap detector + on-device keyword spotter |
| Tray, tray menu | persistent notification + widget + QS tile |
| Settings registry, voice settings | unchanged (same registry) |
| Scheduler/routines | AlarmManager + WorkManager backing the same scheduler |
| MCP servers (stdio) | remote MCP over HTTP only (no child processes on Android) |
| Sidecar `input.*`, `text.insert`, windows.* | accessibility service |

Not possible on a non-rooted phone (shown as such in the UI): background hotword while the OS kills the service (needs a foreground service + battery exemption), reading other apps without accessibility consent, silent calls/SMS (the composer opens, the user presses send), screen capture without a consent tap per session, killing other apps.

## Work split (who owns what)

1. **Core port** (`app/src/mobile/**` except native, `vite.mobile.config.ts`, small seams in `src/main/**` and `src/renderer/src/bridge/index.ts`): shims, in-process IPC, mobile boot, Android `Bridge`, Gemini Live + audio on the WebView, memory/brain/agent running in the page, secrets via native Keystore, link client + sync.
2. **Native plugin** (`app/mobile/android/**`): Capacitor plugin, protocol methods, tools, accessibility/notification-listener/media/foreground services, widget, tile, overlay island, wake service, permissions flow, build + APK.
3. **Phone UI** (`app/src/renderer/**` except `bridge/index.ts`): responsive layouts, safe areas, touch/gesture alternatives to hotkeys, mobile Settings/Desk/Bond, onboarding (key, permissions, pairing), OriginOS tips.

Rules: one session builds the APK at a time (agent 2); the others only run `vite build -c vite.mobile.config.ts` and `pnpm typecheck`; the Windows build (`pnpm build`, `--selfcheck`) must stay green; no real input or killing the user's apps.

## Core in the page: how it is wired (src/mobile)

- **Boot**: `src/mobile/entry.ts` is the page's script (vite.mobile.config.ts swaps it in for the renderer's): Node globals, virtual disk (`vfs.ts`: in-memory + IndexedDB write-through, loaded before any core module), `boot.ts` (the mobile `main/index.ts`: Agent, Wake, scheduler, brain, memory, trust, link client), then the unchanged renderer. `?mobile=1` boots the same core in a desktop browser. `pnpm mobile:check` runs the shims, the platform-neutral selfchecks and a full boot + Link flow under Node.
- **In-process IPC**: `shims/electron.ts` gives `ipcMain`/`ipcRenderer` as one bus, so `src/preload/index.ts` runs as is and `window.lokey` is built from it (`kind: 'android'`). Shared handlers live in `src/main/ipcCore.ts` (used by Windows and Android). Windows the core opens by hash (#agent audio, #confirm, #caption, #dictation, #lasso) are mounted in the page by `pages.ts`: audio (mic 16 kHz PCM16 via AudioWorklet, playback 24 kHz) and the confirm card work through `window.lokeyAgent` / `lokeyConfirm` / `lokeyOverlay` exactly as on Windows. A plain fallback confirm sheet shows only if the UI has not subscribed to `lokeyConfirm.onRequest`.
- **Swapped files** (Android build only, see OVERRIDES in vite.mobile.config.ts): `keystore.ts` (Android Keystore), `link/server.ts` (the phone is a client), `brain/screen.ts`, `brain/extraTools.ts` (+ `ask_pc`, `pc_status`).
- **Plugin contract**: the source of truth is `app/mobile/android/PLUGIN.md` (`call` always resolves `{result}`, failures are `{ok:false, reason}`, an unknown method answers `unknown method: x` and the core then uses the UI's sample data for it). The core adds on top: `perm.*` names are mapped (UI `microphone`/`notification_listener`/`battery` <-> plugin `mic`/`notification-listener`/`battery-optimisation-exempt`, `perm.status {}` answers the UI's keys), list methods that answer `{ok:false}` become `[]`, `secret.*` use `{name, value}`, shell/clipboard/notification calls of the shimmed `electron` map to `intent.open`, `apps.openPath`, `clipboard.set/read`, `notify.show`, `sys.quit`, `screenshot` replaces the Windows screen capture. `app.launchAction` is asked once at boot (`ask|listen|wake|share|confirm`, later ones arrive as `app.launch`). Events used: protocol events, `island.talk {down}` (hold-to-talk), `confirm.action {id,allow}` (notification buttons), `reminder.fired` (runs the `task-<id>` alarm), `app.resume`, `app.launch`; `hotkey.down|up|pressed` ids 1 island, 2 talk, 3 dictation, 5 conversation, 8 stop are still honoured. While the page is hidden: scheduled tasks are also armed as `reminder.set {id:'task-<id>'}` alarms, confirm cards become `notify.confirm`, finished jobs `notify.show`; the assistant state drives `island.set`, replies `widget.update`.
- **Android rules**: no shell tools are offered (`run_command`, processes, coding CLIs); `safety.ts` protects system folders, other apps' data and Lokey's own secrets (`process.platform === 'android'` branch, Windows rules unchanged); MCP servers are remote only (`command` = https address of a Streamable HTTP server, `args` = `Header: value` lines). Back button: close menu, else Home, else minimise (`@capacitor/app`).
- **Link (phone = client)**: `bridge.link.pair({address, code})` (rejects with a message), `.sync()`, `.pcStatus()`, `.approve(id, allow)`, `.onEvent(cb)`; `state()/revoke()` describe the paired PC. The live stream needs the unpatched `fetch` and `allowMixedContent` (set in capacitor.config.ts); without it the client still polls reachability.

## Toolchain (this PC)
JDK 21 (`C:\lokey-android-tools\jdk-21*`; Capacitor 7 needs 21), Gradle 8.9 (`C:\lokey-android-tools\gradle-8.9`), Android SDK `C:\lokey-android-tools\sdk` (platform 35, build-tools 35.0.0). Build: `pnpm mobile:web` (vite) → `pnpm exec cap sync android` → gradle `assembleDebug` in `app/mobile/android`.
