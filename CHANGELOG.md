# Changelog

All notable changes to lokey. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/) once 1.0 is reached.

## [Unreleased]

**Shizuku power tier (Android, optional; not run on a phone).** Tasks in other apps on a hidden second (virtual) screen while you keep using the phone: `second_screen_task`, `bg_apps`, `bg_stop`, Settings > You > Power tier (Shizuku) with a 3-step guide and a "Test second screen" button, a live preview card on Home, a confirm card with the current picture for buy/pay/send/post/delete steps. Banking, payment, wallet, password-manager and authenticator apps are never operated; passwords and codes are never typed; no earned trust. Plugin: `shizuku.*`, `bg.*`, `priv.*` (PLUGIN.md), Kotlin user service in a Shizuku shell process (`BgService`). The Windows operator loop got optional hooks (`OperatorOptions`), jobs got `taskRunners`. See docs/SHIZUKU-TIER.md for how it works and what is unverified.

## [0.8.0-android] - 2026-10-14

- **Island and wake-up outside the app**: the native service now owns them (overlay visibility from the app's foreground state and saved settings, PC approvals through a native link client, wake settings persisted and restarted, wake launches the app), instead of depending on the page the system freezes in the background. Background-health panel in You > Island.
- **Pill fixes**: no more self-hiding/dead touch (the insets check misread the overlay), the avatar is fitted uncropped, minimum capsule height.
- **vivo Origin Island (experimental)**: Live Update notifications carry vivo's documented `notification.superx.*` extras; a probe button tests whether the phone honours them. vivo approval for the app is required for the real island.
- **Power tier (Shizuku)**: second-screen tasks on a virtual display (`second_screen_task`), plus allow-listed privileged actions. Needs Shizuku started through wireless debugging. See `docs/SHIZUKU-TIER.md`.

## [0.7.0-android] - 2026-10-14

**System-wide island on Android.** The island is no longer only inside the app: (1) Android 16 Live Updates (promoted ongoing notifications, `POST_PROMOTED_NOTIFICATIONS`) for voice sessions, timers/focus, jobs, approvals, PC tasks and reminders, which is the OS route OriginOS's Origin Island is built on; (2) a native black pill drawn over every app at the camera cutout (Display over other apps) with per-activity cards and gestures, music from the system media session, the 3D spirit as its face (live snapshot), hidden over fullscreen and while Lokey itself is open; (3) the app keeps running in the background and can be brought forward for hold-to-talk. vivo's own island API is a partner programme (push-based, via vivo's developer platform), not available to us: whether OriginOS puts our Live Updates on its real island is unverified. Settings > You > Island has the toggles and permission status.

## [0.6.0-android] - 2026-10-14

**Lokey for Android (debug build, first real port; nothing tried on a phone yet).** The same Lokey as on Windows: the React UI and the 3D spirit (all poses, animations and emotes), the voice agent (Gemini Live), tools, brain and memory, jobs, trust and undo, scheduler, and a link to the Windows Lokey (pairing, approvals, ask PC, two-way memory sync). The core runs inside a Capacitor WebView through small browser stand-ins for Node/Electron; a Kotlin plugin `LokeyNative` provides the Android side (system info, media session, notifications, accessibility control of other apps, intents, SMS/contacts/calendar, wake clap detector, foreground service, widget, tiles, floating island, Live Update notifications). The phone UI follows the Origin Island style (black capsule around the camera, live activities: voice, music, timers, jobs, approvals, PC) with phone-only pages: Home, Inbox, Today, PC, You. Desktop-only panels (wallpaper, power, stats, apps grid, clipboard history, Wi-Fi/Bluetooth flyouts) are not on the phone. See `docs/MOBILE-PORT.md` and `app/mobile/android/PLUGIN.md`.

## [0.5.1] - 2026-10-14

Round 8: hardening, trust and undo, phone link, style, weekly review. Built and checked by self-checks only; nothing here has been tried with real keys, a real mic or a real phone.

### Security and stability
- **Sidecar input**: injected keys carry the Magic tag (so Ctrl+Win+Arrow, Win+Shift+S and clipboard paste no longer trigger Lokey's own hotkeys); hold chords need a 200 ms hold and cancel on an extra key; AltGr no longer counts as Ctrl+Alt; the main key of a matched chord is swallowed; a hook watchdog reinstalls a hook Windows dropped (it injects a tagged no-op key every 10 s); `forceForeground` tries AllowSetForegroundWindow before the Alt tap.
- **Typing safety**: password flag and target window re-checked before and during typing; our own windows and hwnd 0 rejected; odd UIA rectangle fails closed; newline types as Shift+Enter; over 4000 characters is refused.
- **Sidecar start-up**: each service init has a timeout; pipe queue is bounded; lazy data folders; volume-callback deadlock removed; a failed apps scan is not cached.
- **Trust boundary**: each window has a role and an allow-list of calls (the audio page cannot power off the PC); settings/placement calls check the sender; windows cannot open other windows, external links are http/https only; unknown tools ask first; secret-looking clipboard text is hidden from the model.
- **Settings**: wrong-type values and null patches are dropped; defaults cannot be mutated.
- **Events**: Wi-Fi, Bluetooth and audio-device events reach every window (the lyrics window now follows track changes); subscriptions are replayed after a sidecar restart; one owner for the Escape shortcut.
- **Voice turns**: stale callbacks and timers of an old turn are ignored; a late mic-on is dropped; lasso images are cleared on every exit; a socket error ends the turn; reminders cannot hijack a press; dictation cancel during transcription cannot still type; language/personality changes keep the session.
- **Smaller**: scheduler re-plans after sleep and keeps a corrupt tasks.json as `.bad`; failed scheduled steps are reported; menus respect an active voice turn; sliders survive a cancelled pointer; lyric match tolerance +-3 s and offsets survive an empty cache; second launch opens Settings; display add/remove and a crashed overlay are handled; CI now runs the self-checks.

### Added
- **Earned trust**: after 5 approvals and no denial in 30 days a confirm card offers "don't ask again for this"; rules are listed with Revoke in Settings > Permissions; a denial resets the count. Never offered for the protected list, commands, deletes, sending messages, actions that came from screen/web/MCP text, or phone requests.
- **Undo**: "undo that" reverses the last settings change, toggle, mute or scheduled task; Desk > Activity has an Undo button per row. Not yet: restoring from the Recycle Bin, exact volume.
- **Open loops**: promises you make ("I'll send it tomorrow") are picked up from conversations, listed on Desk (done / snooze / drop), mentioned in the briefing, and become reminders when they have a time.
- **Nudges** with a budget (5 a day, quiet 22:00-08:00, per-kind mute, ignored kinds fade): used for missed tasks and overdue promises.
- **Activity timeline** (off until you create `%LocalAppData%\Lokeyctivity.on`; no Settings switch yet): app and window titles, never password-manager, banking or private-window titles; 90 days; tools `search_activity`, `day_summary`.
- **Writes like you**: samples of your own writing (dictation, typed requests) feed `draft_as_me`, which only drafts and never sends.
- **Weekly review**: a Sunday 18:00 note in the Bond journal and a `weekly_review` tool.
- **Quality test set**: `Lokey.exe --eval` replays `app/evals/*.json` (10 samples) against your configured model with fake tools and prints a score. Needs a model provider set up.
- **Lokey Link (Android phone)**: off by default (Settings > Devices). Pair with a 6-digit code, then open the PC's address in Chrome on the phone: approve or deny confirm cards, send a request, read status, send text to the PC clipboard. Phone requests can never use full control or earned trust and cannot change autonomy, keys or shortcuts. LAN only, see `docs/MOBILE.md` (includes OriginOS 6 battery settings for the vivo T4 Ultra).

- **Android app prototype** (`android/`, vivo T4 Ultra / OriginOS 6): native app with approval notifications (Allow/Deny buttons, Android 16 Live Update request for the Origin Island), popup dialogs, toasts, a home-screen widget, a Quick Settings "Ask Lokey" tile and Share-to-PC. Version 0.2.0 is standalone: own Gemini key, chat by text or voice (English/Tamil), phone tools (apps, timers, alarms, reminders, flashlight, volume, search, maps, music, dialer/SMS composer), its own memory; when paired it also sends work to the PC (`ask_pc`) and memory syncs both ways. Debug APK; not yet run on a phone.

### Not done yet (from the round-8 plan)
Release-signed Android app and phone voice, QR pairing, phone notifications when the page is closed, remote screen and mouse control, wake-word model (sherpa-onnx) and offline mode, MCP spec refresh, learn-by-watching, inbox/calendar triage, shared slider hook, SQLite memory, iOS. See the plan file.

## [0.5.0] - 2026-10-15

Phases 3 and 4: Lokey remembers, can change its own settings, and can be woken without touching the keyboard.

### Added
- **A real memory** (Bond page): after conversations and jobs Lokey writes down what matters (preferences, people, projects, places, routines) as small facts, decides for each whether it is new, an update of something it knew, a contradiction (the old fact is kept as history) or already known, and links them in a graph you can browse. Also episodes (what happened and how it ended), lessons (what went wrong or what you corrected, so it is not repeated) and a short daily journal. Search combines word matching, optional meaning search (Google's free embedding model) and graph closeness. Passwords, keys, card numbers and OTPs are never stored; you can pause learning, exclude apps, edit, pin or delete any memory, and export it. The old memory.json is migrated once. Tools: `remember`, `recall`, `forget`.
- **Change settings by voice**: "make the island bigger", "move the island to the right edge", "use light theme". Settings are described in a registry, every change is validated, shown in the activity log, and `undo_setting` reverts the last one; risky ones (shortcuts, keys, autonomy) ask first and autonomy can never be raised this way. `open_page` opens the right Settings section.
- **Wake-up** (off until you turn it on in Settings > Voice, or from the tray): clap twice, or say "hey lokey", "wake up buddy" or "daddy's home" (add your own, each with an action: just listen, greet, or welcome home). Detection runs in the Windows helper on this PC: claps by sound energy, phrases by Windows' own speech recogniser; nothing is stored or sent anywhere until Lokey wakes up. "Daddy's home" greets you, gives your briefing and mentions anything left unfinished. Listening pauses while Lokey itself is talking. Tray: "Wake-up listening" switch.
- Settings > Brain: learn from conversations, meaning search, apps never learned from.

### Notes
- Phrases are English only (Windows' recogniser); Tamil wake phrases are not supported yet. Needs an English speech recogniser installed in Windows; Settings shows when it is missing.

## [0.4.0] - 2026-10-15

Phase 2: Lokey can now get multi-step work done on its own, on any model, and use the whole PC.

### Added
- **Model layer** (Settings > Brain): the voice stays on Google's free Live model, but thinking and doing now run through a router over any number of providers: Gemini (Flash, Flash-Lite) and any OpenAI-compatible endpoint (FreeLLMAPI, OpenRouter's free models, Groq, Cerebras, Ollama, LM Studio...). Providers are tried in your order, a rate-limited or failing one rests for a while, daily limits and per-provider usage are tracked, each can be tested, keys are stored encrypted. Roles: fast (cheap jobs), main (the agent loop), heavy.
- **Agent loop and background jobs**: say or type a bigger request ("research...", "fix...", "organise my Downloads") and a worker takes it on in the background with a plan-act-observe loop (tools chosen by group so a call never carries every tool's description, step limit, token budget, repeated calls cut off). Up to three at a time, listed on Desk with Stop; the assistant tells you when each one ends. `schedule` steps can now start a job too.
- **Helpers**: researcher, writer, operator and general helpers (`spawn_agent`). Helpers cannot start helpers.
- **Computer use**: `computer_task` looks at the screen, decides one action at a time (click, double-click, right-click, drag, scroll, type, key) on a 0-1000 grid and does it through the sidecar, checking the next screenshot; one confirm card covers the run; Stop ends it at once.
- **Do anything on the PC**: `run_command` (PowerShell with timeout and output limits), `read_file` / `write_file` (overwrites are backed up first) / `list_dir` / `make_folder` / `move_file` / `copy_file` / `delete_file` (Recycle Bin only), `web_fetch`, `web_research` (Google search with sources), `see_screen`, `clipboard_set`, `list_processes` / `close_app` / `kill_process`, `notify`, `download_file`. Sidecar: `input.mouse`, `input.keys`, `process.list/close/kill`.
- **Coding agents**: `delegate_coding` hands a job to your installed Claude Code or Codex (your own signed-in command, task on stdin, progress streamed, read-only unless you allow edits).
- **Autonomy**: only risky / every action / **full control** (never asks), or full control for 15 min / 1 h / 3 h (turns itself off), and "request full control" by voice always shows a card. A protected list stays refused even in full control: formatting or partitioning drives, boot/registry/Windows-security changes, deleting system or profile folders, download-and-run, saved passwords and keys, power commands (use the power tool).
- **Stop everything**: `Ctrl+Alt+Backspace` (changeable) or tray "Stop all agents" ends every job, conversation and full-control grant.
- **Token and prompt control**: instructions are small editable files (Settings > Brain > Instructions), stable parts first so providers can cache them; memory in the prompt is capped to what fits; old tool outputs are shortened inside long jobs.

## [0.3.1] - 2026-10-15

### Changed
- **Moving the island** is now a held shortcut instead of dragging the notch (which fought with "press to open"): hold `Win+Shift` (changeable in Settings > Shortcuts), put the pointer near any edge or corner, let go. The pointer position comes from the main process, so no mouse button is involved. Tray > "Move island..." and Settings still offer click-to-place. **Corners are real positions now**: near a corner the island snaps flush into it (menus, the awake pill and the mascot included).
- **Lyrics moved out of the player** (it was a strip under the music card) into their own **lyrics window**: opens from the new lyrics button on the player, the tray, or `Ctrl+Alt+Y`; stays until closed (X), remembers its place and size, can be pinned above other windows, text size and +/-0.1 s timing controls on hover. The animation was redone after Spicy Lyrics: every word is lit by a soft gradient sweep while it is sung and swells, floats and glows on springs, lines blur and dim with distance, three dots pulse through instrumental breaks, the active line is carried to the upper third, the album cover tints and slides in as the background, click a line to seek, wheel to look around. LRCLIB only has line timing, so word times inside a line are estimated (longer beats after punctuation).

## [0.3.0] - 2026-10-15

Fixes and feel: the island can live on any screen edge, circle-to-ask is rebuilt, the assistant remembers the conversation, synced lyrics, and the spirit reacts to what happens on the PC.

### Fixed
- **Scheduled flows**: "open A at 7, an hour later open B, then play music" is one schedule call with timed steps (`after_minutes` / `at` per step); each timed group is its own persisted task, cancelling one cancels the flow, tasks created after an approval run unattended without a second card.
- **No caret after a shortcut**: global shortcuts reach the sidecar, so Windows refused to give Electron the keyboard. The sidecar now hands the foreground to the island window (`windows.forceForeground`, no injected keys) before the tab opens, and the search box focuses as soon as the window is active.
- **One window**: Settings is a page of the main window; tray, the Bond key button, the Clipboard gear, a second launch and `--settings` all open it there (and navigate an already-open window by message instead of a hash change that could do nothing).
- **Circle to ask**: tap the shortcut, draw with the mouse (loop, or Shift+drag for a box), then speak: the question ends when you stop talking. Default chord is now `Ctrl+Alt+L` (bare Ctrl+Shift is also Windows' layout switch). Screen is grabbed before the overlay appears, always cropped safely (min 400x300, kept on screen), `agent.end()` can no longer be skipped, Esc cancels. The keyboard hook reports `cancelled` when another key ends a chord, does not re-arm while modifiers stay held, heals lost key-ups every 100 ms, and re-registration is serialised and only happens when a shortcut setting changes.
- **Forgetting what you just said**: conversation turns are saved (`conversation.json`) and seed every new connection; the server's resumption handle restores context after idle/go-away; a quick tap no longer closes the connection (nothing is sent for a tap); typed turns use the same path; clear it in Settings > Voice.
- **Click-through**: a sleeping island only owns the pixels it draws (small notch, or a hairline), not a 234x39 px block; "Open on hover" now works; scrolling up inside a list no longer flips the menu back to Music.

### Added
- **Island on any edge**: drag the notch to any edge or corner (or Tray / Settings > Island > Move island); the outline, menus and mascot re-orient, with a slide-in; saved in settings.
- **Conversation mode** (hands-free, `Ctrl+Alt+T` or tray): talk back and forth; ends on "bye", 20 s of quiet, or the shortcut; pauses listening while it speaks (setting) so speakers do not feed back.
- **Synced lyrics** under the player (LRCLIB, cached on disk): word-by-word reveal, a full scrolling lyrics view, tap a line to seek, +/-0.1 s timing nudge saved per song.
- **The spirit reacts for real**: copying, music starting/pausing/changing track, volume and mute, battery levels and charger, network loss, dark-mode flip, a poke (and a startled squeak when poked repeatedly), first wake of the day, dictation start/done/failed. A priority system (critical > interaction > ambient) with cooldowns and one waiting slot stops reactions fighting; conversation states cut ambient actions; spin/roll no longer unwind backwards; emotes are rate-limited; a sleeping notch flashes awake for important ones.

## [0.2.0] - 2026-10-14

Voice rebuilt for speed and accuracy, plus the first real agent features.

### Fixed
- **Hold to talk answered while the key was still held.** Gemini's own silence detection is now switched off; the app sends the start and end of speech itself, so the model replies only after you let go, however long you pause.
- **Dictation was slow and missed words.** The microphone starts before anything else (the field lookup runs in parallel), the page keeps the device warm for a few seconds, and the recording is transcribed by one streaming call that listens to the audio itself (no live transcript, no second clean-up call, no animation delay). Failures no longer vanish: the text goes to the clipboard when there is no safe place to type.
- Interrupting a reply no longer reconnects (the old connection is reused); a 30 s watchdog and a server `goAway` now reset a stuck turn; a quick tap is discarded cleanly; typed requests work with manual speech detection; "captions only" no longer asks the model for a text-only reply (native-audio models cannot).

### Added
- **Tamil, English and Tanglish**: the assistant understands the mix and answers in kind (or always Tamil/English by setting); dictation can write Tamil letters with English words kept, Tanglish in Latin letters, or translate to English.
- **Permissions**: every action is classified safe / ask / refuse; risky ones (typing for you, closing windows, unknown links, power, unknown tools) show a confirm card with Allow / Deny; every action is written to an activity log shown on Desk. Setting: ask only for risky actions, or for every action.
- **Context**: `get_context` (app in front, open windows, clipboard, now playing, battery) and `read_selection`.
- **Navigator**: switch to any open window by voice, press named shortcuts (browser tabs, snap, minimise, screenshot...), find and open files, open any Windows Settings page, toggle Wi-Fi, Bluetooth, dark mode, Night Light, keep-awake, mic mute, lock/sleep/restart.
- **Write for me**: read the selection, rewrite it, type it back after you confirm.
- **Routines**: "every morning at 8" (daily, weekdays, weekly) and a spoken **morning briefing** (date, weather, battery, what is scheduled).
- **MCP connectors**: add any stdio MCP tool server in Settings > Voice; its tools join the assistant's abilities and ask before each call unless trusted.
- Sidecar: `windows.list`, `windows.focus`, `input.chord` (fixed shortcut table), `text.selection`.

### Security
- Memory facts are sanitised (no instructions, keys or passwords) and `forget` needs 3+ characters; past or date-only schedule times are handled; scheduled routines never run actions that need approval.

## [0.1.0] - 2026-10-13

First public release of the Electron + .NET rewrite.

### Added
- **Island**: one animated shape that morphs between a thin bar, an awake notch, a music island and 11 menu sizes; opens on hover, scroll, click or hotkey; region-shaped overlay window so the rest of the screen stays clickable.
- **Tabs**: Controls (Wi-Fi, Bluetooth, audio, Night Light, dark mode, volume, brightness, media), Today, Stats, Clipboard, Apps, Wallpaper, Power, plus in-island Wi-Fi, Bluetooth and audio-device flyouts.
- **Themes**: dark, light and follow-Windows, with accent and panel tint derived from the wallpaper.
- **Voice assistant** over Gemini Live: push-to-talk, tools (open app or site, search, schedule, media, volume, brightness, remember), persisted scheduler, Desk and Bond pages.
- **Dictation** into any text field with live raw transcript, clean-up rewrite and Unicode typing.
- **Circle to ask**: freehand loop on screen, whole-screen and crop sent with the question.
- **The spirit**: a WebGL2 raymarched 3D character with a spring rig, behaviour brain, 35+ actions and postures, 14 emotes, 10 skins and eye contact.
- **Settings**: per-tab global shortcuts with conflict detection, trigger and size options, voice settings, loadout (skin, personality, voice, abilities).
- **Tooling**: `--bench`, `--uitest`, `--lab`, `--demo`, `--selfcheck`, sidecar `--selftest`; README art generator.

### Known limits
See the status table in the [README](README.md#-status-and-known-limits) and [docs/REVIEW-AND-ROADMAP.md](docs/REVIEW-AND-ROADMAP.md).

[0.1.0]: https://github.com/eashuu/lokey/releases/tag/v0.1.0
