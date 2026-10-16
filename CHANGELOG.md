# Changelog

All notable changes to lokey. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/) once 1.0 is reached.

## [0.9.0] - 2026-10-16

A model failure no longer cancels a request. Implements docs/AI-FAILSAFE.md sections 3, 4, 5, 7 and the backend of 6.

### Added
- **Never-fail gateway** (`ai/gateway.ts`): every ready model that has the abilities a request needs is a candidate (role ticks are an order, not a filter); everything excluded by a cooldown, rest, failed probe, rejected key or spent quota becomes a last-resort tail tried once each, soonest-back first; the day quota is per (provider, key, role) so Flash's spent chat quota no longer blocks its transcribing and searching; a spent day is half-open (re-probed every 15 min); several keys per provider (`keyRefs`, migrated from `keyRef`), a bad key never rests the provider while another works; cooldown provenance (authoritative Retry-After / heuristic / 401 key / 402 credit / 403 tier); a failed host is skipped for the rest of the request; headroom steering; wait-in-gateway for a short cooldown on the only usable model; mid-stream resume (the cut-off text is continued by the next model; a streaming caller restarts cleanly); dead model ids (404) sink; `userMessage()` at the throw site and `failures[]` on the error so a notice names WHICH providers failed and why.
- **Parked jobs** (`brain/tasks.ts`, `brain/loop.ts`, `ai/runtime/*`): when no model can answer, a job is PARKED (journal status `parked`), the person is told once ("Waiting: Gemini Flash hit its daily limit; OpenRouter key was rejected; FreeLLMAPI is rate limited. I will carry on at 6:30 PM"), it resumes from the journal at the comeback time (backoff 2 s doubling, capped at 15 min, given up after about 6 h) and a resumed job never repeats a side effect that already happened. Retry in the Flow tab resumes a parked job now, Stop ends it, and parked jobs carry on after a restart. `failed` only for hard stops (no key at all, a request every model rejects, context overflow, repeated safety blocks). The plan-then-execute path parks too; the screen operator waits in place; learning retries (2, 4, 8... minutes) instead of forgetting a conversation.
- **Voice ladder** (`ai/live/supervisor.ts`, `ladder.ts`, `agent/agent.ts`): Live on other model ids (`voice.models`, or asked of Google once the first one fails) with a breaker per id; a socket that dies under a turn (1011, stall, watchdog, quota) no longer loses it: push-to-talk audio goes to speech-to-text (any model that hears audio, 8 s budget) and a text model answers, typed turns are answered as text, and the lasso picture is kept; spoken output with the system voice (`speechSynthesis` in the hidden audio page) when Live cannot speak, also for reminders and job reports. One notice per ladder drop. A stale resumption handle ("session not found or expired") is dropped and the connect retried fresh at once without counting as a failure; connects are serialized and a new one waits for the old socket to close ("already connected to an existing client").
- **Models status feed and commands** (`ai/modelsFeed.ts`, `shared/bridge.ts`, `bridge/modelsMock.ts`): `models.status` pushed on change (at most twice a second) and `models.addKey / removeKey / test / setPreset / setOfflineLocal`. Backend only; the Settings > Models page itself is not built yet. Settings migration v8 (keyRefs, voice.models, brain.preset); the old file is kept once as `settings.pre-0.9.0.json` (rollback: close Lokey and copy it over settings.json).
- **Delegation to Claude Code and Codex works end to end.** A new tool group `agents` (spawn_agent, agent_status, agent_stop, delegate_coding when a CLI is installed) that a worker asks for with `use_tools`; `do_task` takes `role` (general, researcher, writer, operator, coder) and `do_task(role: 'coder', folder, goal)` goes to the CLI through the confirm card (an island card) and shows in the Flow tab. Helpers still cannot start helpers but can start a coding agent. `brain/cli.ts` is checked against the real claude 2.1.301 (nothing was run but --version and --help): the permission mode for read-only is now `dontAsk` (`default` is not a choice in this version), the CLI is found in ~/.local/bin, %APPDATA%\npm and PATH (the packaged app may not have them), not signed in, not installed ("Codex is not installed..."), missing or unnamed folder, idle and total timeouts, progress lines stream into the job, stop = taskkill /T then /F. A mock CLI (`mockCli`) lets the self-check run the whole path without a model.
- **Captions**: every caption kind now has a lifetime (notice 6 s, error 10 s, said/reply 15 s after the last message, the "controlling" hold repeated by its owner and gone 60 s after the last repeat); the overlay window is destroyed and retried once when its page does not report ready in 3 s ("caption overlay not ready" in main.log); and the pill could never fade out because its entrance animation kept opacity 1 (fill-mode both): fixed. `--mock --shots <dir> --captionshots` renders the real bar.

### Self-checks
`failsafe` (120 checks, chaos matrix 56 cells: 14 faults x 1 and 3 providers x recovers/stays down), `overlays` (24), `captions` (18), `live` (47, including stale handle, already connected, alternate model ids), `cli` (17, against a mock CLI).

## [0.8.5] - 2026-10-16

### Added
- **Flow tab in the island** (`tabs/AgentsTab.tsx`, tab id `agents`): a calm live map of what Lokey is doing. Lokey in the centre; around it the helpers working now and the recent ones (worker, researcher, writer, operator, coder, second screen), scheduled items and routines with their next run, open loops and your to-dos, the model(s) answering now (resting ones are marked) and the MCP connectors. Tap a node for a small sheet (goal, started, steps, last tool, model): Stop / Retry / Continue / Open for jobs, Cancel for schedules, Mark done for loops and to-dos. "Nothing running" with the next scheduled item when idle. Black panel, the one accent, no gradients; only opacity/transform animate, only while the tab is open.
- **`agents.graph` feed** (`main/agent/graph.ts`, `shared/graph.ts`): one aggregate of jobs, scheduler, open loops, gateway state and connectors. Pushed on change (agent, scheduler, loops, voice state, model-call trace events), throttled to 2 per second, and only while a view has the Flow tab open. Preload/bridge: `agents.graph()`, `watchGraph(on)`, `onGraph(cb)`, `retry(id)`; mock data in `bridge/graphMock.ts`.
- Layout is a pure function (`shared/graph.ts`: fixed regions with sticky slots, so nodes never jump; at most 24 nodes, overflow becomes "+N"); self-check `graph: graph ok`. `--mock --shots <dir> --flowshots` renders it.
- **Flow redesign (live map).** Read left to right: *Coming up* (schedules with countdown rings) and *Waiting on you* (open loops, to-dos) flow into **Lokey** in the middle, which sends **helpers** out on the right. Lokey is a living core: breathing when idle, ripples while listening, a spinning arc while thinking, a pulse while speaking, one orbiting dot per running helper, warm when something needs you ("2 need a look"). Helper cards show a role glyph (researcher, writer, operator, coder, Claude Code, Codex, second screen), a spinning progress ring, the full title (wraps to two lines, never cut with an ellipsis) and a one-line "now doing X" ticker; failed, stopped, interrupted and parked (waiting for a model, with the time it carries on) jobs have a one-tap Retry / Continue / Open on the card. Lines are thin orthogonal bus routes with small pulses travelling along active ones (dashed and dim for waiting items), so a line never crosses a card. Under the core: the **engines** (models; answering, resting with time left, and a dashed arrow when a call was rerouted to another model), the **connectors** (MCP) and a live **activity strip** with the last three things that happened ("Researcher finished", "Retrying on FreeLLMAPI"). Hover a card to light its line; tap for the focus sheet (the rest fades, Esc closes). New nodes fade in staggered, leaving ones fade out, state changes morph colour. Static with reduced motion, paused when the window is hidden, no polling. Feed additions are optional fields only: `events`, `reroutes`, job `until`/`waitKind`. Layout self-check now also proves that no slot overlaps anything and no line crosses a node, and that the same snapshot gives the same picture.
- Existing settings get the tab appended once (settings migration v7); it can be hidden in Settings > Island. The Desk lists (Jobs, Open loops, Learned routines) are unchanged. Not added to the phone UI (needs its own small layout).

## [Unreleased]

**Shizuku power tier (Android, optional; not run on a phone).** Tasks in other apps on a hidden second (virtual) screen while you keep using the phone: `second_screen_task`, `bg_apps`, `bg_stop`, Settings > You > Power tier (Shizuku) with a 3-step guide and a "Test second screen" button, a live preview card on Home, a confirm card with the current picture for buy/pay/send/post/delete steps. Banking, payment, wallet, password-manager and authenticator apps are never operated; passwords and codes are never typed; no earned trust. Plugin: `shizuku.*`, `bg.*`, `priv.*` (PLUGIN.md), Kotlin user service in a Shizuku shell process (`BgService`). The Windows operator loop got optional hooks (`OperatorOptions`), jobs got `taskRunners`. See docs/SHIZUKU-TIER.md for how it works and what is unverified.

## [0.8.4] - 2026-10-16

Requests for you now appear inside the island.

### Added
- **Asks inside the island** (`agent.confirmIn: 'island'`, the default). Confirmation cards (Allow / Deny), the policy engine's typed cards (send, purchase, publish, delete, personal info, credential, run), the "stop asking about this?" trust offer and MCP definition-changed reconfirms open the island as one calm card: a chip with the kind, one title, the exact detail, a line saying where the data came from when it was not you (a web page, a file, a mail), Allow / Deny, a countdown that ends in Deny, "+N more" when others wait. It is clickable only where it is drawn, never takes the keyboard focus from the app you are in, works on any edge, in dark and light, and without animation when reduced motion is on.
- **Hand-off cards.** On a login, verification or password screen the assistant now stops with a "This step is yours" card (`I'm done` / `Skip`, 2 minutes) instead of only refusing; after `I'm done` it looks at the screen again and still refuses if it is a login screen. Unattended runs still just refuse.
- **Keyboard**: Esc denies when the island has the keyboard; Enter and Space only act on a focused button. Global chords answer the card from any app (`agent.allowKey` Ctrl+Alt+Shift+Y, `agent.denyKey` Ctrl+Alt+Shift+N; they do nothing when no card is showing).
- The spirit reacts when a request arrives (alert pose and emote); an optional soft two-note sound (`agent.askSound`, off by default).
- Settings > Permissions: where requests appear, the sound, the two chords.

### Safety
- Allow (click, Enter on the button or the chord) is ignored for the first 650 ms after a card appears, so a click aimed at something else cannot land on it; Deny always counts at once.
- While any request waits, the sidecar refuses the assistant's own `input.*` calls (mouse, keys, chords): it cannot click Allow or press the chord for you. This also closes the same hole for the old window.
- Nothing ever approves by itself: a timeout, a lost island page, a closed window or a failed hand-over all deny. The answer protocol is unchanged (`answerConfirm(id, ok)`, the same `req`/`done` events for Lokey Link, the same audit, trust and strike hooks); guard-forced cards are still forced.
- The old confirm window stays as the fallback: `agent.confirmIn: 'window'`, the island disabled or hidden for a full-screen app, the island window outside every display (screens changed), a card with a picture (second screen), or an island page that does not confirm within 1.5 s.
- Only the island page itself may answer through the new channel; answers must be real booleans.

### Tests
- `--selfcheck` has `ask: ask ok (43 checks)`: card text and height, arming, keys, display topology, queue and count, expiry, answer parity with the window path, every fallback, the input gate and the hand-off in `execute()`. `--mock --shots <dir> --askshots --edge E --theme T` renders every card state.

## [0.8.3] - 2026-10-16

The 1007 is found and fixed, measured against Google with the person's own key (`Lokey.exe --livetest`, authorised by them).

### Root cause (measured, not guessed)
gemini-3.8-live closes the session with 1007 "Precondition check failed." when an **activity has no audio in it**. A typed turn in push-to-talk mode was sent as `activityStart`, `text`, `activityEnd` (since 0.5.1), which is exactly such an activity. Results of the live run on `gemini-3.8-live`:

| Flow | Result |
|---|---|
| connect, setupComplete, idle 3 s | accepted |
| typed turn as activityStart / text / activityEnd (0.5.1 to 0.8.2) | **1007** |
| the same with no tools, a 2-line prompt, minimal setup | **1007** (so tools and prompt are innocent) |
| activityStart then activityEnd with no audio | **1007** |
| typed turn as `realtimeInput.text` alone | accepted, answered with audio |
| typed turn as clientContent + turnComplete | accepted |
| push-to-talk with real speech (activityStart, audio, activityEnd) | accepted, answered |
| push-to-talk with only 150 ms of audio | accepted, answered |
| text note inside the audio activity (the 0.8.0 shape I first suspected) | accepted, answered: **that suspicion was wrong** |
| resume with the handle of a good session | accepted |
| the 2.5 native-audio models | accept every flow |

### Fixed
- A typed turn is now just `realtimeInput.text` (no activity messages).
- A push-to-talk turn that ended with (almost) no audio is no longer ended with `activityEnd`: the session is dropped and you get "I did not hear anything" (with circle-to-ask pictures the question goes as a typed turn). This is also what a mic that is slow to start would have produced.
- **A transient error no longer fails a model's tool-call test**: a probe that hit "overloaded" or a rate limit used to mark the model as unable to call tools and keep it out of main until restart; now the result is inconclusive.
- **A spent daily quota of search grounding, speech-to-text or embeddings no longer switches the chat model off** (they are separate quotas on Google's side).
- A slow model with another one waiting behind it gets 25 s, not a minute (your OpenRouter free 550B model took longer than that on every call in the live run).
- Error messages now use the name you gave the provider; the Test button can no longer hang forever on a model that never answers.
- `Lokey.exe --livetest <report.txt> [--only-live] [--only-model] [--speech clip.wav]`: a headless check of the real services with your saved keys (opens no window, starts no sidecar, no input, writes none of your data, never prints a key), used to find the above.

### Live run, model side (your real settings, 2026-10-16)
Gemini Flash-Lite: chat, tool calls and JSON ok. Gemini embeddings: ok (256-d). Gemini Flash: JSON ok; chat hit a Google "overloaded" answer, then rate limits during the burst; the free daily limit of search grounding is used up until about 12:30. OpenRouter nemotron-3-ultra-550b:free: every call timed out (30 to 60 s, no answer). FreeLLMAPI (model dots3-note-preview): reachable, one call ok, then its own rate limit. See TESTING.md 130 to 134.

## [0.8.2] - 2026-10-16

Urgent fix: voice sessions were being closed by Google right after they started (close code 1007, "Precondition check failed"), and nothing then fell back to the text models.

### What was wrong
- **The 1007** (6 of 6 sessions on 2026-10-16, see `main.log`): each session connected, then Google closed it 0.15 to 0.35 s later. The setup message was identical to 0.5.1. (Superseded by 0.8.3: this guess was refuted by the live run.) What changed in 0.8.0 on a push-to-talk turn was one extra message: a short text note (time and program in front) sent as `realtimeInput.text` *inside* the open audio activity, immediately before `activityEnd`. The documented rules (one top-level field per message, activityStart/End only with automatic detection off, nothing before setupComplete) were all met, and Google's docs say nothing either way about text inside an audio activity, so this is the most likely cause but **not confirmed against Google's server** (I cannot call it with your key from here). It is removed: a push-to-talk turn is again exactly activityStart, audio, activityEnd. The clock went back into the system prompt (sessions end after 3 idle minutes, so it stays fresh enough). Typed turns keep the note, inside the same activityStart/text/activityEnd shape 0.5.1 used.
- **No text-model calls at all in the traces**: a 1007 is a "bad request" error, which did not count as Live failing, so the basic-voice text mode never switched on and no dictation/text model call was ever attempted. It also left no trace row when a role had nothing to use.

### Fixed
- **Self-healing after a refusal**: the first refusal right after a session starts makes the next session go without tools; the second also cuts the system prompt to two lines; the third puts the voice in text mode for 10 minutes (with the reason). A new key or a new voice model starts from the full setup again. This tells apart a bad tool list, a bad prompt and a bad account/model, and it keeps you working meanwhile.
- **The request is not lost**: when a push-to-talk or typed turn is refused, the audio (kept for the turn) is transcribed with the dictation model and answered as text; a typed request is answered as text at once.
- **Diagnostics that stay**: on any close that is not a normal one, `main.log` gets the close code and reason plus the last 8 messages sent (types, sizes, time offsets, e.g. `realtimeInput.audio x44 (1.4 MB) +311ms`) and the last messages received. No audio, text, prompt or key is ever written. You also get a visible notice with Google's reason instead of a silent failure.
- **Admission gate no longer blocks anything**: a model that has not passed the eval yet is tried after the tested ones instead of being kept out (so your OpenRouter or local model keeps working as the fallback); Settings still says "not tested yet".
- **Providers with no model name** (FreeLLMAPI was enabled with an empty model): skipped, and Settings > Brain says "not used: no model name". Press Test and it asks the server what it offers ("This server offers: a, b, c").
- **Readable reasons**: when a role has nothing to use, the error and the Model calls viewer now say why per provider ("Gemini Flash: no key saved; FreeLLMAPI: no model name"); a call that cannot even start is traced.
- The lasso question's text hint is not sent inside a voice activity either.

### Self-checks
`live ok (35 checks)`: a mock Live server that enforces the documented rules plus the suspected one reproduces the 0.8.0 flow being closed with 1007 (and checks the log line), accepts the fixed flow and a typed turn, and walks the refusal ladder. `roles ok (23 checks)`: the gate ordering, empty model names, the missing-key message.

## [0.8.1] - 2026-10-16

Round 9, steps R7 (computer use v2) and R8 (evals). Built and checked with a fake sidecar, a recorded UI Automation fixture, scripted models and a throw-away local server. **Nothing in this release was run against a real window: the new sidecar code (`ui.tree`, `ui.act`) compiles but has never listed or clicked a real element, and no screen-grounding model was tried.** That is for you to test (TESTING.md 116 to 124).

### Computer use v2
- **Elements, not just pixels**: the sidecar has two new methods, `ui.tree` (the numbered, visible, interactive elements of the window in front, at most 200, in reading order, passwords flagged) and `ui.act` (invoke / focus through UI Automation patterns, so the pointer does not have to move; it refuses a stale list, a window that is no longer in front and password fields). The screen operator shows the model the screenshot AND that list and the model answers with an element number; pixels are used only when the window exposes no elements (games, canvas apps, remote desktops).
- **Pure test mode**: `Lokey.Host.exe --uia-fixture <file>` compacts a recorded fixture and prints it without touching any window or UI Automation. The recorded Save-dialog fixture in `app/evals/uia/` was produced that way and CI checks it still matches.
- **Speculative batches**: the model may chain up to 3 actions in one answer. Before each later action the element list is read again and the named element must still exist (same role, name and id, exactly once); a click by position cannot follow another action blindly; the first mismatch or failure stops the batch and the model is told.
- **API first**: the screen tool is described to the model as the last resort after connectors, commands and files, and the operator prompt prefers shortcuts and element numbers.
- **Screen model slot (decision D8)**: the `ground` role can be served by a local model (a new off-by-default "Local screen model (Ollama)" entry; give it a vision model that can point, such as a UI-TARS or Qwen-VL build you have pulled yourself) or by a cloud one (tick "screen" on an OpenRouter or other provider). Nothing is downloaded.
- **"Lokey is controlling" indicator**: while the operator runs, a caption stays up ("Lokey is controlling your mouse and keyboard · <stop key> stops it"); the stop key and the kill switch work as before. It is the caption bar, not a separate pill window.
- Fixed a mistake from 0.7.1: the "screen did not change after 3 actions" guard in the operator was accidentally commented out together with its explanation.
- **Background agent desktop: not built.** Driving windows on a second virtual desktop cannot be done without switching or moving things on your real desktop; UI Automation invoke already works without moving the pointer, which is the useful part.

### Evals (R8)
- **Per-role scores and the admission gate**: each role has its own small set (`app/evals/roles`: tool choice for main, valid JSON for fast, choosing the right element for the screen role, ordering of related and unrelated texts for memory search). Pressing Test on a provider now also scores it; a model you add must reach 80% on main / screen before it may serve that role (stock models and everything already set up are admitted by the upgrade, so nothing stops working). Settings > Brain shows the scores and a "not tested yet" note; "brain.admission" can be switched off.
- **50 starter prompts** (`app/evals/samples/starter-50.json`: English, Tamil, Tanglish) and a `private/` folder (git-ignored) for your own; `--eval` runs them all through the current model and prints per-role scores for each configured model. With no model set up it says "skipped" instead of printing a fake 1/10.
- **CI**: the app job now also runs the gateway guard, the injection suite headless (mock model, no key; fails unless every attack is stopped), the phone bundle and its check, and the sidecar job checks the UI Automation fixture.

### Score trend (offline checks; model-based scores need your key and are not filled in)
| Version | New self-checks | Injection suite (attacks stopped / controls) | Model eval (`--eval`, main role) |
|---|---|---|---|
| 0.5.1 | brain, memory, trust and the 24 older ones | none | 10 fixtures, never scored here (no key) |
| 0.6.0 | ai 89, live 26 | none | not measured |
| 0.7.0 | guard 45 | 240/240, 11/11 (84% with the Rule of Two disabled) | not measured |
| 0.7.1 | runtime 33 | 240/240, 11/11 | not measured |
| 0.8.0 | memory2 51 | 240/240, 11/11 | not measured |
| 0.8.1 | operator 19, roles 18 | 240/240, 11/11 | not measured: run `Lokey.exe --eval` with a key and add the line |

## [0.8.0] - 2026-10-16

Round 9, step R6: memory v2. Built and checked by self-checks (`memory2: memory2 ok (51 checks)`); not tried with a real model, a real migration of your memory, a real Claude Code client or a long period of use.

### Memory v2
- **Real tables in `lokey.db`** (`m_facts`, `m_entities`, `m_relations`, `m_episodes`, `m_lessons`, `m_journal`, `m_ops`, `m_plans`, `m_proposals`, `m_meta`) replace the single JSON document of 0.6.0. On first start the old document is imported, counted against the new rows and then kept as a backup (`kv` row `brain.v1.migrated`). Where there is no database (the Android build) the JSON file is used as before.
- **FTS5 search**: retrieval ranks with SQLite's BM25 over the facts (and the names of the people and places they mention), combined with meaning vectors, recency, importance and the relationship graph. Tamil words are kept whole (the word splitter used by the old ranking also was fixed for Tamil vowel signs).
- **Encryption at rest (decision D6, on by default)**: the content of memory (fact text, names, lessons, episodes, journal, core block, vectors) is sealed with AES-256-GCM using a random key that Windows protects for your account (DPAPI via Electron safeStorage). The search index lives only in memory, so no plaintext index is written to disk. Settings > Brain > "Encrypt memory on this PC" turns it off (and on again; every row is rewritten). If the key cannot be read, the store locks itself and never writes over the encrypted memory. A Windows Hello gate for the Brain page is NOT built (the setting exists as a stub): it needs the sidecar to show the Hello prompt, which cannot be tested without interaction.
- **Bi-temporal facts with provenance**: every fact has `validFrom`/`validTo` and `recorded at`, a trust level (confirmed / inferred / untrusted) and an origin (you said it, I worked it out, screen, web, email, MCP, phone, import). A changed fact starts a new row and closes the old one; history is kept. Bond shows where each thing came from and since when.
- **Quarantine**: anything learned right after reading outside content (a web page, mail, the screen, an MCP result) is held, marked untrusted and NEVER retrieved, put in a prompt, exported or shared until you approve it on Bond ("To review": It is true / Discard), or until you say the same thing yourself. Such a conversation also cannot change or delete facts you can rely on, and writes no lessons, relations or promises. The remember tool does the same when called right after outside content.
- **One-call learning**: one cheap-model call per conversation returns ADD / UPDATE / DELETE / NOOP operations (replacing the extract-then-decide pair), with structured-output repair.
- **Core block**: a short profile (max 1200 characters) that is always in the prompt; only you can edit it on Bond, or approve a refreshed version that the nightly consolidation proposes.
- **Consolidation** (daily, on the background share of the free quota): gives vectors to facts that lack one, folds duplicates, closes contradicted facts (the older one gets a `validTo`) and proposes a new core block. It never sees quarantined facts, so it cannot promote them, and never drops pinned ones.
- **Per-app plan memory**: a screen task that ended in confirmed success (started by you, not unattended) is stored as a short plan for that program and offered as a hint next time in the same program (5 plans per program).
- **Lokey as an MCP server over your memory (decision D9)**: Settings > Brain > "Let my other AI tools read my memory", off by default. When on it listens on 127.0.0.1 only, needs a secret token (the Copy button gives the `claude mcp add` command), refuses web pages and rebinding host names, has three read-only tools (`search_memory`, `get_profile`, `list_recent`) and goes through the same retrieval as the assistant, so quarantined facts are never returned. Each call is written to the audit log.
- **`Lokey.exe --memcheck`**: a short headless measurement of the memory engine (no windows, no sidecar, no input, throw-away database in the temp folder).

### Not done
Windows Hello gate (stub), AC-power-only scheduling of consolidation, a separate quarantine for the phone's memory sync, per-client approval for the MCP server beyond the token, encrypting the older files (`conversation`, `style`, `trust`, `actions.jsonl`), and measuring the whole app's idle memory (only the engine is measured).

## [0.7.1] - 2026-10-16

Round 9, step R5 (durable runtime) and offline mode. Built and checked by self-checks (`runtime: runtime ok (33 checks)`, including a simulated kill and restart); not tried with a real model, a real kill, a real Ollama or a real network drop.

### Durable runtime (`ai/runtime/`)
- **Step journal**: every model answer and every tool call of a background job is written to `lokey.db` (tables `runs` and `steps`) before it is used, with an idempotency key `run:step:callId`. A job that was running when Lokey closed or crashed shows on Desk > Jobs as interrupted, with Continue (rebuilds the conversation from the journal and carries on after the last complete step) and Discard; a notice says so at start-up.
- **No double side effects**: a tool call that was started without a result is never repeated blindly. A reading tool is simply run again; a side-effecting one is checked (a file written, a folder made, a file moved or deleted is verified on disk and counted as done) or reported to the model as "interrupted, may or may not have happened, check first". A completed or uncertain side-effecting call with the same tool and arguments (keys in any order) is never run twice in one job, even if the model repeats it.
- **Verify after act**: write/make-folder/copy/move/delete results are checked against the disk; if a tool reports success but the file is not there, the model is told it failed and the model that chose it earns a demerit.
- **Loop guards**: identical calls are compared with sorted keys and cut after 3; jobs stop after 20 minutes; the screen operator stops when the picture is unchanged after 3 actions and its step cap is 25.
- **Context compaction**: results older than the last 2 steps become one-line stubs; near 70% of the context the middle of the job is folded into a short note (calls, short arguments, short outcomes) in the goal message, never splitting a call from its result.
- **Structured outputs with repair**: `ai.callJson(role, request, schema)` parses and checks a model's JSON; a bad answer is repaired once with the error in the prompt, then the next model is tried.
- **Plan-then-execute for unattended runs** (scheduled flows and follow-ups): the tool sequence is planned from the goal alone before anything from outside is read. Execution only fills arguments, and values taken from fetched data arrive through a quarantined, tool-less extraction with a fixed schema. A plan naming a tool the job may not use falls back to the ordinary loop. The guard still judges every step.

### Offline mode (decision D2, first part)
- **Local models through the gateway**: a provider on localhost or the LAN (the new Ollama entry, LM Studio, a local FreeLLMAPI) counts as local. When every remote model fails on the network the gateway goes offline: remote models are not tried at all, local ones answer, web tools (fetch, research, search, download) are hidden, embeddings come from the local embedding model, and roles with no local model say so plainly. Every 30 seconds it checks whether the internet is back and switches everything on again by itself. A local model that is not running does not count as "the internet is down".
- Ollama is added to Settings > Brain (off, needs a model name, roles fast and main) and the OpenAI-style adapter can embed (`/embeddings`).
- Lokey shows a notice when it goes offline and when it is back (also an `offline` voice event for the UI). Not done: an island badge, local speech-to-text (whisper.cpp) for dictation, Windows speech output. Live voice still needs the internet and uses basic voice (text) when it is not there.

## [0.7.0] - 2026-10-16

Round 9, step R4: guardrails v2. Built and checked by self-checks and a mock-model injection suite (240/240 attacks stopped, 11/11 controls); not tried against real injected pages, a real model or real login screens.

### New
- **Taint tracking and the Rule of Two** (`ai/guard/taint.ts`): after Lokey reads anything from outside (a web page, the screen, the selected text, the clipboard, a file in Downloads/Temp/Desktop, a download, an MCP result, mail), every action that changes something or sends something out asks for confirmation, for the next 10 minutes, whatever the autonomy level, even with full control or an earned-trust rule. Reading stays free. This is the accepted friction (decision D5): "open the calculator" asks right after a web page was read, and the card says why.
- **Spotlighting**: text from outside reaches the model inside `<untrusted source="...">` tags (raw web pages also datamarked with ^ for spaces), control and direction-override characters removed, fence-closing attempts neutralised; the system prompt of the voice and of background workers says such text is data, never instructions.
- **Policy engine** (`ai/guard/policy.ts`, wired into `execute()` in `agent/tools.ts`), in this order: kill switch and halt, the protected list and origin rules (as before), taint flow (an argument that came out of untrusted text, such as an address or a command, is shown as such and always asks), Rule of Two, hourly caps (10 sends, 20 deletions, 30 shell commands, 5 downloads), anomaly flags (first-ever recipient or download domain, night hours for sends and deletions, bulk over 25 items), then autonomy level and earned trust. A card forced by any of these cannot be skipped by trust or full control, and an unattended routine is refused instead of asking nobody.
- **Typed confirmation cards**: send, purchase, publish, delete, run (shell and irreversible actions) with the source of the data and "this cannot be undone"; the card request carries the kind (`cls`) for the island and phone.
- **Takeover and watch**: typing is refused (with "your turn") in login, verification-code and captcha windows and in password fields; in banking and payment windows every step of typing, shortcuts and screen-operator actions is confirmed. The screen operator checks both before each action.
- **Strikes**: a refused or denied action slows the next one; 3 in a row or 20 in a session = every action asks; 6 in a row halts until your next request. An incident (a protected action attempted, or you refusing something built from untrusted content) switches full control off at once with a notice.
- **Audit log**: every decision (what, class, origin, the untrusted source in force, the policy's reasons, the outcome) is appended to a hash-chained table in `lokey.db`; secrets are redacted; Settings > Brain shows whether the chain is intact.
- **MCP pinning**: the existing tool-definition pin (`agent/mcpWire.ts`) is reused: a changed definition still always asks, and the policy engine records it and makes it un-skippable.
- **Prompt Guard 2 is deferred (decision D2)**: only the classifier interface, a null implementation and the setting `guard.promptGuard` (off, does nothing) exist; no model is downloaded.
- **Injection evals** (`app/evals/injection/cases.json`, run by `--selfcheck` and `--eval`): a mock model reads injected content, then tries 20 different state-changing or exfiltrating tool calls (shell download, email, open attacker URL, write to Startup, delete, shutdown, schedule, memory poisoning, settings, MCP share...), in every autonomy level, with and without earned trust: the attack must not reach the tool. Controls check ordinary actions still run without a card when nothing untrusted was read.

### Limits
Prompt injection cannot be solved by this; the design assumes the model WILL follow an injection and limits the damage. Not done: a real injection classifier, per-origin session tracking (the taint is one global window), the "model" column of the audit rows, an audit viewer beyond the integrity line, the island badge for takeover, WhatsApp/phone-side cards.

## [0.6.0] - 2026-10-16

Round 9, steps R1, R2 and R3: one database, one gateway for every model call, and a supervisor for the Live voice socket. Built and checked by self-checks (89 gateway checks: chaos, quota, breaker, migration); nothing here has been tried with a real key, mic or network failure.

### New
- **`lokey.db`** (SQLite, WAL) replaces the loose JSON stores. It comes from Node itself (`node:sqlite`, SQLite 3.53 with FTS5, verified inside Electron 44), so there is no native add-on and no new dependency. On first start `brain.json`, `conversation.json` and `usage.json` are imported, each read back and compared before the old file is renamed to `<name>.migrated` (that is the backup; rename it back to return to an older build). A damaged file, or a document already in the database, is left alone. Where `node:sqlite` is missing (the Android build) everything keeps using the JSON files.
- **Model gateway** (`app/src/main/ai/`): every model call goes through `ai.call(role, request)`. Roles: fast, main, heavy, vision, ground (screen operator), transcribe (dictation), search (Google grounding), embed (memory search). Each role walks the providers you ticked for it, in your order, skipping any that lack an ability the request needs (tools, pictures, audio), are out of quota, or are resting. Dictation, conversation summaries, embeddings, web research, see-screen, the agent loop, the screen operator, learning and drafting all use it; no code outside `ai/` names a provider host or a model id (`pnpm check:gateway` enforces it). The Gemini Live voice socket is covered by step R3 below.
- **Error taxonomy**: adapters turn what a provider said into one kind (rate limit per minute, daily quota, overloaded, timeout, network, bad key, bad request, context overflow, safety block, recitation, malformed tool call, empty, truncated, stream drop, aborted). Gemini, OpenAI-style, OpenRouter and Groq wording are understood, including `Retry-After`, `retryDelay` and reset headers. Callers no longer read message text.
- **Retry and fallback rules**: a short Retry-After (up to 8 s) is waited out and retried; a daily quota is never retried and the provider is skipped until its reset (Pacific midnight for Google); 5xx and network errors get one jittered retry; a malformed tool call is repaired once with the error in the prompt; an empty reply is retried once; a cut-off answer is asked again with twice the room; a stream that drops restarts on the next model; the person's stop is never counted as a failure. At most 2 attempts per model and 4 models per request, with a time limit per role.
- **Quota ledger**: per provider today's requests and tokens, your own daily limit and rpm (new per-provider fields), OpenRouter's free-model rate, and a daily limit learned from a 429. Background work (learning, summaries, embeddings of new memories) may use at most 30% of a known daily budget and 70% of the minute window.
- **Health**: circuit breaker (3 failures in a row, or over half of the last 20, opens it; 30 s, 1, 2, 5, 15 min cooldowns; one trial request when half-open) and demerits for bad tool calls (24 h half-life; 5 sinks a model below healthy ones, 10 rests it from main and screen jobs). When every candidate is resting, exactly one is tried. State survives a restart.
- **Tool-call probe**: Test on a main/screen provider also checks that it really calls a tool; one that does not is kept out of main and screen.
- **Model calls viewer** (Settings > Brain): every attempt with role, provider, error kind, attempt number, time, tokens and the chain of earlier failures; per-provider quota and rest notes. Only metadata is stored, never prompt or answer text. Each failed attempt also writes one line to `main.log`.
- **Chaos self-check** (`--selfcheck`, line `ai:`): a scripted `FaultProvider` plays each failure and the check asserts the gateway's response.

### Step R3: Live voice supervisor
- **Live supervisor** (`ai/live/supervisor.ts`, the socket moved to `ai/live/session.ts`): owns the Gemini Live connection. Close codes are understood (1011/1006 reconnect and keep the resumption handle; 1007 is never retried the same way and drops the handle; 1008 and quota texts are typed as key or quota problems). A connection first tries the saved handle and falls back to a fresh one if it is refused; a resumed session that dies within 10 s drops the handle. `goAway` replaces the connection between turns (never in the middle of one). A server that goes silent after a turn is detected (15 s) and the session replaced; a typed request is retried once on a fresh connection after a drop or stall.
- **Basic voice**: when Live cannot be used (its quota is spent, it keeps failing, the model is refused) typed requests, and push-to-talk (transcribed with the dictation role) are answered as text through the gateway with the voice tool list, shown as captions without speech. Hands-free conversation needs Live. It returns by itself when Live recovers.
- **Smaller Live tool surface**: 16 tools (context, selection, typing, windows, open app/link, web search, media, volume, schedule, tasks, remember/recall, briefing, undo) plus `do_task`; everything else (files, shell, settings, MCP tools, helpers) goes through `do_task` to a background worker that has the full catalog. MCP tools are no longer declared to the voice directly.
- **Fresh context per turn**: the current time and the program in front are sent with each push-to-talk or typed turn instead of being baked into the system prompt at connect time (not in hands-free conversation mode).
- **Live metering**: each connection and session is traced and counted in the gateway ledger under the id `live` (audio seconds as estimated tokens at 25 per second), with its own circuit breaker and quota state (Settings > Brain > Model calls shows them; role "live voice"). The allow-list exception for the Live socket in `check:gateway` is gone.
- **Chaos self-check** (`live:` line, 26 checks): a local WebSocket server plays Google's side (resumption handles, rejected handle, 1011 and 1007 closes, goAway idle and mid-turn, silence, a pulled network, a daily-quota close) against the real session and supervisor.
- Not done: the island has no "basic voice" badge (only a notice); no spoken fallback (Windows TTS); `NON_BLOCKING` tool behaviour is not used; live audio is estimated, not read from the server's usage.

### Changed
- Settings: providers can serve vision, screen, dictation, web search and memory-search roles; existing settings are upgraded (Gemini Flash gains those roles, a Gemini embeddings entry is added). The "Dictation model" and embedding-model text settings are gone: pick models per role in Settings > Brain. A custom dictation model you had typed is not carried over.
- The screen operator now uses the `ground` role and see-screen the `vision` role (both fall back to main).
- `brain/router.ts` and `brain/providers/` are replaced by `ai/gateway.ts` and `ai/adapters/` (the old module remains as a re-export).

### Features (desktop: slider hook, MCP refresh, learn by watching, inbox/calendar triage)
Built and covered by `--selfcheck` (new line `desktop:` plus a rewritten `mcp:`); nothing here has been used with a real mail account, a real MCP server on the internet, real clicks or a real person at the keyboard.
- **One slider hook** (`shared/slider.ts`, `renderer/lib/useSlider.ts`) used by the island sliders, the music seek bar, the media-card seek bar and the volume/brightness pills. A drag now ends exactly once on pointer up, pointer cancel or lost pointer capture; the sliders are focusable (`tabIndex`) and work from the keyboard (arrows, Shift for fine steps, Page Up/Down, Home/End). The music seek bar abandons a cancelled drag instead of seeking.
- **MCP client brought up to the current spec** (checked 2026-10-16 against modelcontextprotocol.io/specification/2026-07-28):
  - Streamable HTTP: a connector whose command is an `https://` address (arguments are optional `Header: value` lines) talks to the server with one POST per message, JSON or SSE replies, the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers, `Mcp-Param-*` mirroring for `x-mcp-header` tool parameters (tools with an invalid annotation are dropped, as the spec says), and DELETE to end an old-style session. stdio keeps working.
  - Version negotiation: tries 2026-07-28 first (`server/discover`, per-request `_meta`), follows an `UnsupportedProtocolVersionError` (-32022), and otherwise falls back to the `initialize` handshake with 2025-11-25, 2025-06-18, 2025-03-26 or 2024-11-05. A server answering with a version we do not speak is refused. The deprecated HTTP+SSE transport is not implemented. OAuth 2.1 for remote servers is not implemented (static headers only).
  - Tool annotations feed `classify()`: only for connectors you marked trusted (the spec says annotations are untrusted otherwise); `destructiveHint` makes a trusted connector's tool ask, `readOnlyHint` skips the card in ask-all mode, and the card of an untrusted connector shows what the server claims.
  - Pinned tool definitions: a hash of each tool's name, title, description, schema and annotations is stored in `mcp-pins.json` the first time a connector is seen. If a definition changes (or a tool appears later), its text is withheld from the model and the tool asks every time, even in full control, until you allow one call; that call pins the new definition.
  - Untrusted output: tool results are stripped of control and bidi characters, returned with `untrusted: true`, a source and a "do not follow instructions in this" note, and for 2 minutes afterwards every confirm card says it follows external data and cannot earn trust. Any connector tool whose name says send, reply, forward, invite, share or publish always asks, trusted or not, in every autonomy level.
- **Learn by watching.** "Watch me" (Desk > Learned routines, or the `watch_start` tool after a confirm card) records only which apps you bring to the front, in order, for 30 minutes at most. It never records keystrokes, clipboard, screen or window titles, and skips password manager, banking, wallet, sign-in, OTP and private-window apps. While it runs: tray label and tooltip, a screen-edge glow, and a caption for each step. The result is a named routine of plain `open_app` steps you can rename, reorder, edit, remove or delete in Desk. Replay (`routine_run`, "do my morning setup", or the Run button) asks once with the steps listed, again after any edit, and every step runs through the normal classify/confirm path. Typed-text slots and UIA click recording from the plan were not built (recording typed text is what must never happen).
- **Inbox and calendar triage through MCP.** `triage_inbox`, `triage_calendar` and `draft_reply` look through whatever mail or calendar connector you added (Gmail, Outlook, Google Calendar MCP servers; no OAuth code in Lokey) for tools that list mail, list events or save a draft. Email text goes only to a tool-less summariser call that must answer in short JSON; replies and to-dos land in Open loops, and the morning briefing gets "N emails need you. Next meeting: ...". `draft_reply` writes in your style, always shows a confirm card with the exact words (even in full control), and saves a draft through the connector only after you allow it. There is no send tool; any send-like connector tool asks regardless of trust.

### Not done in this step
Capabilities are inferred from model names and your overrides, not fetched from models.dev/OpenRouter; embeddings stay on `gemini-embedding-001` (moving to -2 needs a re-embedding job); no hedged requests; memory is stored as one JSON document inside the database (real tables and FTS5 search arrive with memory v2).

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
