# Lokey: agent map and structure (as of 0.9.0 desktop, 0.9.1 Android)

> 0.9.0: a model failure never cancels a request (chain with a last-resort tail, parked jobs that resume from the journal, a voice ladder with spoken output), and a worker or the voice can hand a coding job to Claude Code or Codex (tool group agents, do_task(role: coder)). See docs/AI-FAILSAFE.md and ARCHITECTURE.md "Never-fail AI".

Read from the code on 2026-10-16. "Verified" means a self-check or a real run proved it; most of this has only been checked with mocks. See the status table at the end.

## 1. The big picture

```
 you ──voice/text/hotkey──►  INTERFACES ──►  AGENTS ──►  TOOLS ──► GUARD ──► your PC / phone
                              island, spirit,   Live voice     tools.ts     ai/guard    sidecar (C#),
                              caption, Desk,    agent +        brain/       (policy,    Android plugin
                              phone app         background     computer.ts  taint,
                                                workers        operator     audit)
                                  ▲                │
                                  └────── AI GATEWAY (ai/) ◄── model providers (Gemini, OpenRouter, FreeLLMAPI, Ollama...)
                                         + lokey.db (traces, quota, health, journal, memory, audit)
```

Parts: renderer (React, the island/spirit/Desk/Settings), Electron main (windows, IPC, the agents), the .NET sidecar `native/Lokey.Host` (Windows APIs: hotkeys, UIA, audio, media, input), the Android app (`app/mobile/android`: Kotlin plugin, services, Compose UI) running the same TS core in a hidden WebView, and Lokey Link (LAN link between phone and PC).

## 2. The agents (who does what)

| Agent | Where | Model role | Job | Tools it may use |
|---|---|---|---|---|
| **Voice agent (Live)** | `agent/agent.ts` (turn state machine) → `ai/live/supervisor.ts` → `ai/live/session.ts` (raw WebSocket to Gemini Live, `gemini-3.8-live`) | `live` (not routed through text roles) | Talk with you: push-to-talk, hands-free conversation, wake greeting, typed turns | 16 tools (`ai/live/surface.ts`): get_context, read_selection, type_text, switch_window, open_app, open_url, web_search, media, set_volume, schedule, list_tasks, remember, recall, briefing, undo, **do_task** |
| **Degraded voice ("basic voice")** | `agent/agent.ts` | `main` | When Live is unusable: typed requests answered as text captions; push-to-talk transcribed with `transcribe` first | same voice tool list |
| **Worker (general)** | `brain/tasks.ts` + `brain/loop.ts` | `main` | Background jobs started by `do_task`, scheduled routines | groups core, files, web, screen (`brain/roles.ts`); asks for more with `use_tools` |
| **Researcher** | same | `main` | Web research, cites sources | core, web |
| **Writer** | same | `main` | Drafts text, saves files | core, files, web |
| **Operator (screen)** | `brain/operator.ts`, `brain/uia.ts`, sidecar `Services/Uia.cs` | `main` loop + `ground` (screenshot/UIA grounding) | Drives the PC by numbered UIA elements and screenshots; batches of up to 3 actions, re-verifies between actions | `computer`, `finish` |
| **Coder** | `brain/cli.ts` | `heavy` | Hands a coding task to your own installed Claude Code / Codex CLI (task on stdin) | `files` |
| **Second screen (Android)** | `app/src/mobile/secondScreen.ts` + `BgService.kt` (Shizuku) | `main` | Runs apps on a virtual display with a deny-list (banking, wallet, passwords...) | `second_screen_task`, `bg_apps`, `bg_stop` |
| **Learning / memory writer** | `brain/memory/learn.ts`, `ai/memory/*` | `fast` | One call per conversation: add/update/delete/no-op facts, consolidation | none (no tools) |
| **Triage** | `agent/triage.ts` | `fast` | Reads mail/calendar through whichever MCP server you connect, summarises, drafts (always confirmed) | MCP tools only |
| **Watcher** | `agent/watch.ts` | none | Records which apps you open (opt-in) into replayable routines | none |
| **Dictation** | `agent/dictation.ts` | `transcribe` | Hold-to-dictate: audio to cleaned text typed into the focused field | none |
| **Lasso (circle-to-ask)** | `agent/lasso.ts` | `vision` | Screenshot region + your question | none |
| **Nudges / weekly review** | `agent/nudge.ts`, `brain/weekly.ts` | `fast` | Proactive, rate-limited suggestions; weekly summary | none |

Limits: at most 3 background jobs run at once (`brain/tasks.ts` MAX_RUNNING). The Live voice cannot call the other tools directly: anything beyond its 16 tools goes through `do_task`, which starts a worker. MCP tools are reachable only through `do_task`.

## 3. Model roles and providers (the AI gateway)

`ai/gateway.ts` is the only code that calls a model (`pnpm check:gateway` fails if anything else does). `ai.call(role, request)` picks providers for the role in your order, applies quota, health/circuit breaker and retry/fallback, records a trace row, and returns text/tool calls.

Roles (`ai/catalog.ts`): `live` (voice socket), `fast`, `main`, `heavy`, `vision`, `ground`, `transcribe`, `search`, `embed`. When a role has no provider, stand-ins are used: fast→main, heavy→main, vision→main, ground→vision→main. Per-attempt deadlines: fast 15 s, main 60 s, heavy 120 s, vision 45 s, ground 20 s, transcribe 30 s, search 45 s, embed 15 s (25 s when a fallback is waiting).

Providers (`shared/bridge.ts` defaults, your `settings.json brain.providers`): Gemini Flash (main, heavy, vision, ground, transcribe, search), Gemini Flash-Lite (fast), Gemini embeddings, OpenRouter free models (off by default; you enabled one), FreeLLMAPI at localhost:3001, Ollama (off, local, offline mode), a local Ollama screen model slot (off). Two adapters: `ai/adapters/gemini.ts` and `ai/adapters/openai.ts` (any OpenAI-compatible endpoint). Admission gate: a newly added model is tested first (80% on main/screen sets) and only reorders, never blocks existing providers.

Offline mode: when every remote model fails on the network, the gateway switches to local providers, hides web tools, and checks every 30 s for the internet.

## 4. The guard (between model and tools)

Everything goes through `agent/tools.ts execute()`: `classify()` (what the call is worth alone) → `ai/guard/policy.ts` which can only make it stricter: kill switch/halt, taint flow and the Rule of Two (after reading untrusted content, every state change asks for 10 min, even in full control), hourly caps (10 sends, 20 deletions, 30 shell commands, 5 downloads), anomaly flags (first recipient, night hours, bulk), typed confirmation cards, takeover/watch (no typing in login, code, captcha or password fields), strikes, hash-chained audit log in `lokey.db`. Plus earned trust (`agent/trust.ts`), undo (`agent/undo.ts`), safety rules (`brain/safety.ts`: protected paths and commands, private hosts). Prompt Guard is a stub (off, nothing downloaded). Autonomy levels: ask-risky (default), ask-all, full control (timed, set only in Settings).

## 5. Memory and state

`lokey.db` (SQLite via node:sqlite): `traces`, `quota`, `health`, `usage`, `runs`+`steps` (durable job journal), `audit`, memory tables `m_facts`, `m_entities`, `m_relations`, `m_episodes`, `m_lessons`, `m_journal`, `m_ops`, `m_plans`, `m_proposals`, `m_meta`. Memory v2: bi-temporal facts with provenance and trust, quarantine for facts learned from untrusted content (never retrieved until you approve), core block (≤1200 chars always in the prompt), per-app plans, AES-256-GCM at rest with a DPAPI-held key, BM25+vector search. Optional read-only MCP server over memory (off by default, 127.0.0.1 + token). Other stores: `settings.json`, `conversation` (recent turns for continuity), `tasks.json`/scheduler, `routines.json`, `mcp-pins.json`, `prompts/*.md` (editable prompt sections), `undo/`, `clipboard/`, `lyrics/`.

Durable runtime (`ai/runtime/`): every model step and tool call of a background job is journaled with idempotency keys, so an interrupted job can be continued without repeating a send/write; verify-after-act for file operations; loop guards (3 identical calls); context compaction; structured outputs with one repair.

## 6. Interfaces

- **Desktop:** island overlay (`renderer/src/island`, black pill/notch, tabs, flyouts, 3D spirit `mascot/`), caption bar, dictation/lasso overlays, Settings and Main window (Loadout, Desk, Bond), tray. Confirmations are currently a separate always-on-top window (`agent/permissions.ts`, `ConfirmApp.tsx`); moving them into the island is in progress (0.8.4).
- **Android:** two APKs. *Classic* = Capacitor WebView UI. *Native* = Kotlin + Compose app (`ui/theme`, `ui/kit`, `ui/screens`, `ui/home`) over a `Core` seam (`core/Core.kt`) that talks to the TS core running headless in a hidden WebView (`core/WebCore.kt`, `src/mobile/headless.ts`). System island: full `notification.superx.*` sender (`VivoSuperX.kt`) verified to show on the user's T4 Ultra, plus Live Updates and an overlay pill as fallbacks.
- **Link:** phone ↔ PC over LAN (`main/link`): pairing code, device tokens, approvals, `/say` (capped at risky mode), clipboard, memory sync.

## 7. Native layers

- **Sidecar `Lokey.Host` (C#/.NET 8, ~5.3k lines):** named-pipe JSON protocol (`shared/protocol.ts`). Services: hotkeys (low-level hook), foreground tracking, text input (`TextInput.cs`), UIA tree/act (`Uia.cs`), clipboard history, audio, media (SMTC), Wi-Fi, Bluetooth, wallpaper, night light, wake listener (`Listener.cs`: double-clap + SAPI phrases).
- **Android plugin `LokeyNative` (Kotlin):** sidecar-protocol methods plus phone tools (intents, accessibility, notification listener, media session, screenshots), services (Bg/foreground, Wake, LinkClient), `Island.kt`/`IslandView.kt` overlay, `LiveUpdates.kt`, `VivoIsland.kt`/`VivoSuperX.kt`, Shizuku tier.

## 8. Size and layout

`app/src/main/agent` ≈ 4.1k lines, `main/ai` ≈ 4.1k, `main/brain` ≈ 3.2k, `main/link` ≈ 0.4k, `renderer/src` ≈ 11.7k, `src/mobile` ≈ 2.8k, sidecar ≈ 5.3k; Android Kotlin app under `app/mobile/android`. Docs: `docs/ARCHITECTURE.md` (desktop), `docs/MOBILE-PORT.md` and `docs/NATIVE-APP.md` (Android), `docs/VIVO-ISLAND.md`, `docs/SHIZUKU-TIER.md`, `docs/TESTING.md` (hand-test items 1-134), `docs/internal/RAKAZO-ANALYSIS.md`.

## 9. What is proven and what is not

| Area | Status |
|---|---|
| Live voice protocol (typed turn, push-to-talk, resume) | Verified against Google with the user's key in 0.8.3 (`--livetest`); the typed-turn 1007 bug was found and fixed. goAway, hands-free, wake not tested |
| Text models via gateway | Flash-Lite and embeddings verified; Flash overloaded/rate-limited at test time; OpenRouter free model timed out; FreeLLMAPI answers once then rate-limits |
| Guard, runtime, memory v2, MCP, watch, triage, operator logic | Mock-only self-checks (all pass); never run on real tasks |
| Computer use / browser control | Implemented (UIA + screenshots); never verified on a real task. No page-level (DOM) browser tool exists |
| Android native app | Compiles, JVM tests pass, screens rendered to PNG; native shell never booted by the user yet. System island full route verified to show on the user's phone; update cadence, outside-app, tap actions unverified |
| Wake word (clap, phrases) | Built; phrase spotter is weak; never tested outside mocks. Low-power wake and assistant-role trigger not built |
