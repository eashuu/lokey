# AI v2: fail-proof routing and simple model settings (spec)

Status: sections 3, 4, 5, 7 and the backend of 6 are built in 0.9.0 (desktop; the Android core shares the TypeScript code). Not built: the Settings > Models page itself, a sidecar speech.say (System.Speech) and Kotlin TextToSpeech (the page speechSynthesis is the spoken rung), Windows SAPI / Android SpeechRecognizer as the last speech-to-text resort, hedged requests for a stalled first byte, real SSE in the OpenAI adapter, static free-tier preset JSON. Sources: an audit of Lokey's failure paths (2026-10-16, from code and the user's own traces) and a read of FreeLLMAPI (MIT, github.com/tashfeenahmed/freellmapi). Ideas and algorithms are re-implemented; no FreeLLMAPI code is copied.

## 1. What is wrong today (confirmed)
1. The gateway only walks the list `pick()` builds; a short or empty list throws and every caller (loop, task, operator, plan, dictation, voice) treats one thrown `AiError` as final. A real job died this way: Gemini Flash daily quota, OpenRouter key expired (silent), FreeLLMAPI 429 "all models exhausted" -> status `failed`, not resumable.
2. Providers that are cooling, resting, probe-failed, auth-blocked or quota-exhausted are dropped, not tried as a last resort (only "every candidate breaker-open" has a last resort, one attempt).
3. `quota.canUse()` checks the provider-wide daily exhaustion, so Flash's chat quota blocks its transcribe/search roles ("no model can take this request").
4. `transcribe`, `search`, `embed` have no stand-in roles and `forRole()` only lists providers that ticked the role, so a capable model (Flash-Lite hears audio and searches) is never a candidate.
5. Voice uses one Live model id, never another model or provider; the fallback is text-only; a push-to-talk turn is lost when the socket drops although `turnAudio` holds the audio; there is no spoken output fallback; Android has no TextToSpeech.
6. Notices show raw status text; an expired key fails silently; one key per provider; failed learning/summary calls are dropped; probe failures and dead model ids stay first.

## 2. Principles
- A model failure never cancels the user's request. The order is: retry elsewhere -> wait briefly -> park and resume -> tell the user plainly. A hard stop only for: no key at all for any capable provider, `CONTEXT_OVERFLOW` after compaction, repeated safety blocks.
- Role ticks are a preference order, not a filter. A request needs capabilities (tools, vision, audio in, search, embed, context); any enabled provider that has them can serve it.
- Truth stays inside Lokey: per-provider quota, health and traces remain per provider and per key.
- One status line per episode, never per attempt.

## 3. Gateway changes (`app/src/main/ai`)
1. **Candidate chain**: every enabled, ready provider (non-empty model, has a key) whose `capsOf()` meets `needOf(role, request)`; order = healthy first, then demerits, then the user's order, with the role's ticked providers first within equal health. Append everything else excluded by cooling, rested, probe-false, breaker-open, auth-off and quota-exhausted as a tail of last-resort entries (one attempt each, soonest-back first), reserving a slot for the tail in `MAX_CANDIDATES`. Never skip for BG share when the call is user-initiated.
2. **Quota keys**: `canUse()` must use `quotaKey(c, role)`; a `QUOTA_DAY` ledger entry is half-open (re-probe once per 15 min); classify `QUOTA_DAY` only with a `PerDay` quotaId or a retry delay > 1 h (drop the bare "billing details" rule). Shared pool key for providers that share one (e.g. `openrouter::free`).
3. **Keys per provider**: `ProviderConfig.keyRefs: string[]` (migrate from `keyRef`). Inner key loop: ordered by health, then least-used; cooldown, auth and quota scoped to (provider, key[, model]); a bad key never rests the provider while another key works.
4. **Cooldown provenance**: `source: authoritative (Retry-After/quotaId) | heuristic | credit (402) | tier (403) | key (401)`; heuristic cooldowns are re-probed early (cheap validate). Distinguish 401/402/403 instead of folding into AUTH.
5. **Per-request host skip**: on 5xx/timeout skip every model on the same host for the rest of this request.
6. **Headroom steering**: rank lower at >= 80% of rpm/rpd/tpm instead of waiting for the 429; in-flight leases so voice plus background jobs do not oversubscribe; learn rpm/tpm limits from error text (only tightening).
7. **Wait-in-gateway**: interactive call, sole candidate, `RATE_MINUTE`/`OVERLOADED` cooldown <= 20 s -> sleep and retry within the call's total deadline instead of throwing. Total wall-clock budget per call plus a hedge for a stalled first byte (idle timeout 20 s, separate from the total deadline).
8. **Mid-stream resume**: keep partial text and completed tool calls from a `STREAM_DROP`; on the next candidate send the partial as an assistant prefix ("continue exactly from here") for text and re-ask tool calls; streaming callers (dictation) restart cleanly and replace the partial. Real SSE in the OpenAI adapter.
9. Penalise `BAD_REQUEST`/404 so a dead model id stops being first; `probe=false` expires after 10 min or on the next Test; localhost routers (FreeLLMAPI) are not "local" for the offline latch unless marked local; FreeLLMAPI specifics: its own budget is 45 s (treat `fast` 15 s deadline accordingly), treat its 429 `Retry-After` as authoritative, map its 502 `upstream_failed` to `OVERLOADED`.
10. **Error text** goes through `userMessage()` at the throw site (never raw status text); AUTH failures are shown once in the island.

## 4. Never-fail tasks (`brain/loop.ts`, `brain/tasks.ts`, `ai/runtime/*`, `brain/operator.ts`, plan, learn/summary)
- `loop.ts`: on `AiError` of kind RATE/QUOTA/OVERLOADED/TIMEOUT/NETWORK/STREAM_DROP/NO_PROVIDER return `{reason:'wait', until, kind}` instead of `error`.
- `RunStatus` gets `parked`. `TaskManager` keeps the run, schedules a resume at `until` + jitter (exponential backoff, cap 15 min, give up after ~6 h), notifies once ("Waiting for Gemini Flash, back ~19:05; I will carry on") and resumes from the journal (idempotency keys already prevent double side effects). `failed` only for the hard-stop kinds. Resume accepts `parked`.
- Same treatment in `plan.ts`, `operator.ts` (first throw no longer ends the operator), `extraTools`, scheduler jobs. Failed learn/summary/journal calls go to a small retry queue instead of being dropped.

## 5. Voice ladder (desktop; Android shares the logic)
Each rung drops to the next after one failed try, at most ~8 s of added delay overall; the user is told once which rung is active.
1. **Live, other model ids**: `voice.models[]` (primary + alternates, from `listLiveModels`), per-model breaker ids `live:<model>`; cycle on 1007/1011/model-not-found/per-model quota.
2. **Cascade**: speech-to-text on the kept push-to-talk audio (`turnAudio`) -> text model -> reply. Salvage `turnAudio` on 1011/stall/watchdog/quota close instead of "Lost the connection". STT candidates come from the new capability chain (Flash-Lite etc.); last STT resort: Windows SAPI recognition in the sidecar / Android SpeechRecognizer.
3. **Any text model** answers (`degradedTurn`), now passing `images` (lasso keeps its picture) and using the new chain so it cannot dead-end.
4. **Spoken output** (missing today): first `speechSynthesis` in the hidden audio page (Chromium uses the system voices; on Android the WebView uses TextToSpeech), honouring `speakReplies` and half-duplex through `AgentAudio`; later a sidecar `speech.say` (System.Speech.Synthesis, already referenced) feeding PCM to `AgentAudio` for lip-sync, and a Kotlin `TextToSpeech` method for the phone. Also used for reminders and job reports when Live is down; hands-free runs as a degraded loop.
Notices: "Voice is using backup (text + spoken) until Live recovers."

## 6. Simple settings: Settings > Models (replaces the Brain provider matrix)
Default view only:
1. **Status line**: "Using Gemini Flash. 2 backups ready. Today: 38 requests."
2. **Keys**: one row per provider family (Google Gemini, OpenRouter, other OpenAI-compatible incl. FreeLLMAPI, Ollama local); status dot (ok / resting until 14:20 / key rejected / daily limit used, back ~00:00 PT); Add key (auto-detect provider by prefix, fills base URL, auto-discovers models and capabilities), Test, Remove. Several keys per provider allowed (listed under the row).
3. **One preset**: Best quality | Fastest | Save free quota (orders the chain; no role matrix).
4. **Toggle**: Use my local model when offline.
Everything else behind one collapsed, remembered **Advanced**: per-role provider/model table (live, fast, main, heavy, vision, ground, transcribe, search, embed) and ordering, per-provider limits, background share, voice model list, Model calls viewer (with the fallback trail "used OpenRouter after Gemini limit"), admission Test, add custom endpoint. Static free-tier presets (Gemini, OpenRouter `:free`, Groq, Cerebras) ship in the repo as small JSON; no remote catalog feed.

### Status contract (main -> renderer, pushed on change, throttled to 2/s; mock in bridge/mock.ts)
`models.status`: `{ mode: 'online'|'offline'|'degraded', using: {providerId, model, label}|null, backups: number, requestsToday: number, voice: {rung: 'live'|'live-alt'|'cascade'|'text'|'spoken-text', model: string, note?: string}, providers: [{id, family, label, enabled, keys: [{ref, hint: 'last4', state: 'ok'|'resting'|'rejected'|'limit', until?: number, note?: string}], model, caps: string[], state, usedToday, note?: string}], preset: 'quality'|'fast'|'save' }`. Commands: `models.addKey({family, key, baseUrl?})`, `models.removeKey(ref)`, `models.test(providerId|ref)`, `models.setPreset(p)`, `models.setOfflineLocal(bool)`.

## 7. Tests (extend `ai/selfcheck.ts` with FaultProvider, a loop/tasks harness with a fake clock, and a voice harness with a mock Live socket)
- Gateway, 1 and 3 providers x each fault (429 minute with/without Retry-After, 429 day, 503, hang past deadline, malformed tool call, 401, stream cut, all open): success within the deadline once the provider recovers, or `parked`; never a thrown `AiError` to an interactive caller.
- Quota keys: exhaust Flash chat, then transcribe and search still try; capability stand-ins (transcribe with only Flash-Lite; vision/search pick a capable provider); multiple keys with one bad key; host skip; headroom ordering.
- Loop/task: fault every candidate for N ms mid-run -> `parked` -> `done` after recovery with no repeated side-effecting step; `failed` only for hard-stop kinds. Operator ground timeout then recovery continues.
- Voice: 1011 mid-PTT -> audio salvaged -> text answer; 1007 x3 -> alternate model id; quota close -> cascade; STT quota out -> alternate STT or a clear notice; degraded + images -> lasso answered; TTS rung when `speakReplies`.
- Dictation: stream drop mid-transcript retries on another provider and replaces the partial.
- Regression: replay the user's real failure (Flash QUOTA_DAY, OpenRouter AUTH, FreeLLMAPI 429) and assert the job parks until the cool ends and then finishes.
- `--livetest` is extended with a fault-free pass over each rung that can be exercised for real (alternate Live ids, cascade STT, text answer).
