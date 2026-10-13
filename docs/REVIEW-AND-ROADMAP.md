# Code review and roadmap

Review of the whole codebase after the voice, dictation, circle-to-ask and 3D spirit work: three independent read-only passes (Electron main process, renderer, .NET sidecar), checked against the code. Nothing here was run; every item cites what the code does. Paths are relative to `app/src` unless noted.

## 1. Bugs and risks, ranked

### A. Safety and privacy (fix first)
1. **Microphone can stay on after a quick tap** (found by two reviewers). `main/agent/agent.ts` `begin()` awaits the audio page and the Gemini connect without re-checking that the key is still held; `renderer/src/agent/AgentApp.tsx` `startMic` ignores a `mic off` that arrives while `getUserMedia` is pending, and leaks the stream if `AudioContext` creation throws. Result: OS recording indicator stays on for up to 60 s and PCM keeps streaming to the main process.
2. **Dictation can type into the wrong place.** `native/Lokey.Host/Services/TextInput.cs`: the password flag is only read when dictation starts (seconds before typing), `hwnd == 0` skips the focus guard, focus is not re-checked between 200-key chunks, our own windows are not rejected, `\n` becomes a real Enter (sends chat messages), and text over 4000 chars is silently truncated with `ok:true`. The password check also fails open when the field rectangle is odd-sized.
3. **Prompt injection and over-trusting model output.** `main/agent/tools.ts`: `open_url` opens any http(s) address (including localhost/LAN) with no confirmation, `schedule` can persist such steps to run unattended, `remember` writes arbitrary multi-line text into the system prompt, `forget` with empty text wipes all memory. Lasso sends screenshots, so on-screen text can steer the model.
4. **Unrestricted RPC from every window.** `main/index.ts` `lokey:call` forwards any sidecar method (`power.do`, `apps.openPath`, `wifi.connect`, `wallpaper.set`) from any renderer, including the hidden audio page and the transient overlays; all windows get the same preload. `setWindowOpenHandler` passes any URL scheme to `shell.openExternal`.
5. **Settings can brick the app.** `main/settings.ts` `merge()` does no type validation; a bad patch (`{voice: null}`) is persisted and then throws on every start. `defaultSettings` itself is mutated by the migration and by `--theme/--accent/--soul`. Unknown tab ids in `settings.json` blank the island (no error boundary).
6. **Clipboard history keeps secrets.** Browser-extension password managers are not detected (foreground is `chrome.exe`) and are kept 30 days; `retentionDays: 0` means "forever"; DPAPI without extra entropy lets any same-user process decrypt.

### B. Input and hotkeys
7. **Our own keys trigger our own chords.** `native/.../Native/Win32.cs` `SendChord` does not tag events with the `Magic` marker, so `desktops.switch` (Ctrl+Win+Arrow) matches the dictation chord (Ctrl+Win) and starts the mic; clipboard paste (Ctrl+V) is also seen by the hook.
8. **Hold chords fire immediately.** `Ctrl+Shift` (circle-to-ask) triggers on every Ctrl+Shift+T / layout switch; AltGr (LCtrl+RAlt) equals Ctrl+Alt and triggers push-to-talk on some layouts; the main key of `Ctrl+Alt+V` is not swallowed. Needs a 150-250 ms hold delay cancelled by any extra key.
9. **The keyboard hook has no watchdog.** Windows silently removes a slow low-level hook; lost key-ups (UAC, lock screen) leave a chord stuck and the mic/overlay open. Also a start/stop race on the hook statics (`Hotkeys.cs`) can unhook the new hook, killing every hold chord until restart.
10. **`registerHotkeys` runs on every settings change** (a slider drag), is not serialised, and `unregisterAll` stops the hook, dropping any chord-up in flight. Concurrent runs report false "already registered".

### C. Reliability
11. **Voice state machine holes** (`agent.ts`, `session.ts`): releasing before the session connects drops the utterance and later leaks stale audio into the next turn; a socket error never emits `closed` so the UI stays in `thinking` and `agent.busy` blocks dictation and lasso; `goAway` emits `closed` without closing; barge-in leaves the old session's listeners attached (stale replies and tool calls); the 1.2 s and 20 s timers are not tied to a turn; stale lasso images leak into later typed requests; there is no turn watchdog.
12. **Dictation races** (`dictation.ts`): releasing during `focusRect`/`mic`/`connect` leaves the overlay, listeners, mic and a Gemini session alive; `end()` is re-entrant; dictation and assistant share one `AgentAudio` with no owner, so the idle timer or the other feature can kill the mic mid-use.
13. **Sidecar startup and crash handling.** One hung service init (WMI, COM, DPAPI) blocks every request behind `Dispatcher.Ready` (no timeout); an unwritable data folder throws in a static initialiser and kills the host; the restart budget (3) never refills; a failed first `start()` can kill the healthy restarted process; after a restart subscriptions are not replayed and held chords never get `hotkey.up`.
14. **Wi-Fi, Bluetooth and audio-device flyouts never live-update.** `main/index.ts` `FWD` omits `wifi.changed`, `bt.changed`, `audio.devices.changed`. One-line fix; derive the list from the `Events` type.
15. **Display changes are ignored.** The overlay is built once for the primary display; no handling of dock/undock, DPI or primary swaps; no `render-process-gone` recovery. Lasso, dictation, caption, glow and reveal all assume the primary monitor.
16. **Scheduler:** no `powerMonitor` resume hook (tasks due during sleep are late or marked missed), date-only ISO strings parse as UTC, past times are accepted and reported as "Scheduled", a corrupt `tasks.json` aborts boot before the tray and sidecar start, the run-time caption ignores failed steps, and a due task interrupts a live conversation caption.
17. **Possible deadlock** in `Audio.cs` (lock held while COM notification callbacks run), unbounded outbound pipe queue, `apps.list` cache can cache a fault forever, shell COM objects leak, the single STA thread has no timeout.

### D. Product bugs (renderer)
18. "Open on hover" setting does nothing (`openOnHover` is read nowhere).
19. Scrolling up inside a list on the start tab flips the island to Music; the tab bar has no wheel debounce.
20. Clipboard tab key handler is greedy: Ctrl+C with text selected in the preview copies the clip instead, Enter pastes while a button is focused, Tab is always swallowed (same pattern in Apps and the wallpaper carousel).
21. Sliders (volume, brightness, seek, music) freeze if the pointer-up is lost; none handles `pointercancel`/`lostpointercapture`.
22. Main window keeps the old accent after a theme flip (`useThemeBoot`); the 0.8 s `@property` colour transitions put dark text on a dark panel for half a second and ignore reduced motion; several hard-coded colours remain (Today, Stats, split-tile divider).
23. A voice turn ending resets a pinned menu to hover mode and loses keyboard focus (`island/voice.ts`); dictation turns wake the island like assistant turns.
24. One WebGL failure disables 3D for the whole session and context loss is unhandled; the Loadout picker runs 11 raymarch loops at once.
25. `initData` registers listeners after fetching (lost events), has no error handling; several screens call `bridge.call` without `.catch`; the mock bridge swallows unknown methods that the real one rejects.
26. The focus timer finishes silently; accessibility gaps (sliders not keyboard-operable, no tab roles, no focus management on pin).

## 2. Architecture assessment
- **Good:** the process split (UI / main / native sidecar over a named pipe with an orphan-safe lifecycle), the typed protocol (every method and event checked consistent between TypeScript and C#), the scheduler (injectable clock, self-check, atomic writes), fail-closed handling of undocumented Windows internals (Night Light blob, virtual desktops, IPolicyConfig), and the diagnostics tooling (`--bench`, `--uitest`, `--lab`, `--demo`, `--selfcheck`).
- **Weak:**
  - The voice `Agent` is a god object with an implicit state machine (booleans and untracked timers, no turn id). Introduce an explicit turn object with a generation token and one owner for the microphone.
  - Global singletons everywhere (settings, overlays, keystore cache, glow state, the mascot bus, `pointerState`, `glFailed`) make testing and multi-window use hard.
  - IPC is stringly typed and unvalidated; the same powerful preload is attached to every window.
  - The sidecar is all static classes with no cancellation, three message-loop threads plus one unprotected STA thread, and no event coalescing.
  - Dev and test machinery (bench, lab, uitest, demo, env overrides) ships in the production entry file.
  - Dead code: `Held`, `Caption`, `setCaption`, region extras (only the bench uses them); three mascot implementations (SVG flame, 2D canvas, 3D shader).
  - Pixel-absolute layouts everywhere (hard for accessibility, text scaling and localisation); a half-registered tab registry (adding a tab touches about six files).
  - Tests are limited to `--selftest` and the injected-event UI test; no unit tests for hotkey parsing/state, the scheduler beyond one check, or settings migration.

## 3. Roadmap: from widget to personal agent

### Phase 0: stability and safety pass (do first, about two days)
Hot-mic fix and a mic-owner model; turn object with generation token and watchdog; dictation re-check of password/focus before typing and refusal of `hwnd == 0`; `Magic` on all injected keys; hold-delay for chords; hook watchdog; serialised, change-only hotkey registration; settings validation plus error boundaries; forward the three missing events; tools hardening (confirm URLs from lasso/schedules, sanitise memory, guard `forget`); scheduler power-resume and UTC fix; sidecar init timeout and per-service try/catch; per-window RPC allow-list; display-change handling.

### Phase 1: a real agent core
- **Permission model and audit log.** Three levels per tool (read-only, ask first, allowed), an island confirmation card ("open example.com? yes/no"), a visible history of what the agent did, and undo where possible. Treat screen/page text as untrusted data.
- **Context engine.** The agent knows what you are doing: active app and window title, browser URL and tab titles (UI Automation), selected text, clipboard, upcoming calendar item, battery/network state. Cheap, local, and makes every command smarter ("summarise this", "reply to this").
- **MCP client.** Let any MCP server add tools (calendar, mail, GitHub, Home Assistant, Notion, filesystem). This is the highest-leverage feature: the "Abilities" slot becomes installable ability packs.
- **Provider abstraction.** Gemini Live today; add OpenAI Realtime and a text-mode Claude/Gemini path, plus an offline path (local whisper.cpp for dictation, Ollama for text) and a cost/quota readout.

### Phase 2: navigator and automation
- **Navigator:** "take me to ...": jump to a window by description ("the Figma window"), open the exact Settings page, find and open files (Windows Search is already wired), tab control in browsers, route and map links, window snapping and virtual-desktop moves. The spirit can point at what it means (the point pose plus the lasso overlay already exist).
- **Computer use with guardrails:** read the UI Automation tree (text, not just screenshots), click and type in apps after confirmation, fill forms, drag files into folders, with a per-app allow-list.
- **Routines engine:** natural-language rules with triggers (time, app opened, headphones connected, Wi-Fi joined, battery low, meeting in 5 minutes, folder changed) and chains ("when I plug in headphones, play my focus playlist and set volume 30"). The scheduler grows into this; a morning briefing and an end-of-day recap are the first two built-ins.
- **Dictation upgrades:** voice editing of selected text ("make this friendlier", "translate to French") through the UIA text pattern, per-app tone, snippets and voice commands ("new line", "delete last sentence").
- **Screen intelligence from the lasso:** OCR to clipboard, translate, explain, summarise a region, "what is this error", annotate and save.

### Phase 3: memory and presence
- **Real memory:** episodic summaries per day, people/projects/preferences with embeddings, a Bond page that shows, edits and forgets them, import/export, on-device by default.
- **Wake word and always-listening mode:** local wake-word engine plus VAD, push-to-talk remains default; barge-in; proactive speech limited by a quiet-hours and focus-mode setting.
- **The spirit reflects your machine:** hot CPU makes it sweat, low battery makes it sleepy, a finished download or build makes it cheer, a meeting in five minutes makes it alert, a long idle spell makes it sit and then lie down (the postures exist). Notifications become small reactions instead of toasts. A bond level with streaks and unlockable skins and hats ties the character to the assistant.

### Phase 4: product polish
Installer/MSIX and auto-update; crash recovery and a diagnostics bundle (no telemetry); multi-monitor model; accessibility pass (keyboard-operable sliders, focus management, reduced motion everywhere); localisation (move off pixel-absolute layouts); unit and integration test harness in CI; memory reduction or the Tauri port (idle total is still about 765 MB against the 400 MB gate; most of it is the GPU process); remove dead code and the third mascot implementation.

## 4. Suggested order
Phase 0 first (it removes every issue that can hurt the user: stuck microphone, wrong-window typing, stuck chords), then Phase 1's permission model plus MCP, then Phase 2's navigator and routines, which is where it stops being a control widget and starts being an assistant.
