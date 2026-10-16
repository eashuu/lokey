# Lokey for Android: native app (Kotlin + Jetpack Compose)

Decision (user, 2026-10-16): the phone app becomes a real native Android app. The Capacitor port (`docs/MOBILE-PORT.md`) stays buildable until the native app replaces it. Nothing here has been run on a phone yet.

## Why
Smoothness (no bridge, 120 Hz render thread), direct system APIs, and a UI layer that can live beside the services that already run natively (island, wake, link, Shizuku). The WebView limits (background suspension, latency) stop applying to the UI.

## Architecture (phased, so something always builds)

```
Compose UI (screens + design system)        <- phase N1
   | StateFlow / events
CoreHost (Kotlin interface `Core`)           <- phase N1: implemented by a hidden WebView running the existing TS core (bundle from vite.mobile.config.ts)
   |                                            phase N2+: pieces ported to Kotlin one by one (Gemini Live client first), WebView core retired last
Native services (already Kotlin): Island, VivoIsland, LiveUpdates, Wake, LinkClient, BgService, Notif, Access, Media...
```

- The UI never talks to the WebView directly; it only sees `Core` (state + commands). That is the seam that lets the core be ported without touching screens.
- The 3D spirit: phase N1 hosts the existing WebGL spirit in one small WebView composable (`SpiritView`). A native renderer (Filament) is a separate later phase; until then this is the one WebView in the UI.
- Not done in N1, stated up front: Kotlin port of the agent/brain/tools; native Gemini Live client; Filament spirit; release signing.

## Design system (matches desktop)
Source of truth: `app/src/renderer/src/design/tokens.css` plus `app/src/renderer/src/ui.tsx` and `phone/ui.tsx`. Port, do not reinvent:
- colour roles: bg, s1, s2, s3, line, text, muted, dim, accent (#d9b556) and accent-ink, accent-soft, ok/warn/bad, panel (#07090d, island black), the overlay-ink fills `fill-0..4` (white on dark, black on light), `glass-stroke`. Dark and light themes, accent animates when it changes.
- type: Inter (UI), Rubik (island text), JetBrains Mono (numbers); label style = 10 px, 0.08 em tracking, uppercase, 600.
- shape and motion: card radius 20 dp, row radius 10 dp, field radius 12 dp, press scale 0.92 on icon buttons, 280 ms ease-out enter (`lk-in`), springs for panels.
- principles: minimal, one accent, no gradients or shadows for decoration, black island pill is the only high-contrast object, density low, touch targets >= 48 dp.

## Screens (parity with the current phone UI in `app/src/renderer/src/phone/`)
Onboarding, Home, Inbox, Today, PC, You (incl. Island and Background-health cards), Settings sections, approval cards, live-activity faces (voice, music, timer, job, approval, pc, reminder, charging, idle). Desktop-only panels stay out.

## Rules
- Windows app untouched. One Gradle build at a time. No real-device claims. No spoofed package names.
- Every new Kotlin file gets a JVM test only where there is logic (state reducers, mappers); UI gets `@Preview`s and a showcase screen.

## Phase N1 step 2: the Core seam and the app shell (what exists)

Nothing below has run on a phone. It compiles, the pure logic has JVM tests, and the TypeScript side typechecks.

### Which activity is the launcher
`MainActivity` (the Capacitor UI) stays the launcher. `LokeyActivity` (Compose, single activity, edge-to-edge, cutout-aware) is declared in the manifest and becomes the launcher only with `gradle assembleDebug -PnativeShell=true` (build flag; it also sets `BuildConfig.NATIVE_SHELL`, which makes `Launch.intent()` target `LokeyActivity`). Not flipped by default because it has never been booted on a device. Known gap before the flip: the ASSIST / VOICE_COMMAND / SEND intent filters still live on `MainActivity`. Run only one of the two activities at a time (each boots its own core).

### Layers
```
LokeyApp (ui/app)  ->  Core (core/Core.kt)  <-  FakeCore (previews, showcase)
                           ^
                       WebCore  --JSON messages-->  hidden Capacitor WebView, page /?headless=1 (src/mobile/headless.ts)
                                                     the existing TS core (boot.ts) + the LokeyNative plugin (unchanged)
SpiritView (ui/home)  -->  plain WebView, page ?spirit=1 (src/mobile/spiritPage.tsx): only the renderer's WebGL Spirit
```
`LokeyActivity` extends `BridgeActivity` so the core's WebView is the Capacitor one and `LokeyNative` answers native calls; the Compose content is added on top of it. The start path `/?headless=1` is injected into the Capacitor config at load time. `entry.ts` routes `?headless=1` to `headless.ts` and `?spirit=1` to `spiritPage.tsx`; without them it boots the UI as before.

### Core protocol (WebCore <-> headless page)
JSON, one object per message. Kotlin sends with `webView.evaluateJavascript("window.__lokeyHost.recv(<json string>)")`; the page answers through the `LokeyCoreHost.post(json)` JavascriptInterface. Code: `src/mobile/hostProtocol.ts` (checked in `pnpm mobile:check`) and `core/Protocol.kt` (JVM tests).
```
Kotlin -> JS  {t:"call",  id, path, args?}   run the function at path, answer with res
              {t:"sub",   sid, path, args?}  run it with a callback appended to args; each callback call becomes an ev
              {t:"unsub", sid}               call the unsubscribe function the sub returned
JS -> Kotlin  {t:"res", id, ok:true, v?} | {t:"res", id, ok:false, err}
              {t:"ev", sid, v}               v = the callback's argument (several arguments = an array)
              {t:"ready", ok:true, kind:"android"} | {t:"ready", ok:false, error}      once, after the core booted
```
`path` is `<root>.<member>...`; roots: `bridge` (window.lokey, i.e. everything in `src/shared/bridge.ts`: `bridge.voice.say`, `bridge.settings.get`, `bridge.link.approve`, `bridge.on` / `bridge.call(method, params)` for the sidecar protocol and phone-only plugin methods), `confirm` (`onRequest`, `answer`), `overlay` (`on("dictation", cb)`), `native` (`onEvent(cb)`: plugin events such as `reminder.fired`). Names `__proto__`, `constructor`, `prototype` are refused; unknown paths answer `ok:false`, never throw. Payloads must be JSON (undefined becomes null). Calls time out after 60 s; the boot after 45 s (`CoreStatus.Failed`, `Core.retry()` reloads the page).

### Core interface
Typed flows: `status, assistant (state, convo, caption), messages, dictation, activities, approvals (local and PC), jobs, today, pc, media, settings (theme, accent, skin, flags), notices`. Commands: `say, hold, toggleConversation, stopAll, stopJob, answerApproval, dismissDictation, retry`. Generic: `call(path, args)`, `subscribe(path, args, cb)`, `nativeCall(method, params)`, `patchSettings(patch)`. The reducers (`core/Reducers.kt`: chat transcript, approvals, activity priority, today, settings, PC status) are pure and tested; they port `phone/chat.ts` and `phone/activities.ts`.

### Step 3 (screens, island faces, intent filters)
- Screens in `ui/screens` and `ui/home`: Home (spirit, transcript, timer / music / charging / reminder / PC cards, quick actions: torch, volume, timer, screen, call or message, navigate, remind me, camera), Inbox (grouped notifications, summarise, reply as me), Today (calendar, reminders, open loops, focus timer, routines), PC (pair, status, approvals, ask, sync, unpair), You with Spirit, Bond, Voice, Wake-up, Brain, Appearance, Island (system island, Live Updates, vivo test, Background health), Permissions, Privacy, Shizuku, OriginOS tips, About, and a real onboarding flow (key, language, permissions, pairing).
- Island faces: the WebView UI published `island.update` from React (`nativeIsland.tsx`); the native app does it in `core/IslandBridge.kt` + `IslandFaces.kt` (timer, charging, music with controls, approval, voice, job, reminder, PC) and runs the buttons (`FaceActions`). In headless mode `boot.ts` no longer publishes its own voice/job faces, so there is one publisher.
- Extra protocol roots: `core` (`window.__lokeyCore`, used for `core.linkClient.say`) and `page` (`page.setScreenshot`, the picture the agent's screen tool reads).
- Intent filters (ASSIST, VOICE_COMMAND, SEND) follow the launcher through manifest placeholders: `MainActivity` has them by default, `LokeyActivity` with `-PnativeShell=true` (the other gets an inactive action).
- Permission names are the plugin's (`mic`, `notification-listener`, `battery`...). The renderer's Onboarding.tsx asks for `microphone` and `notification_listener`, which `perm.request` does not know ("unknown permission"): a bug in the WebView UI, not copied here.

### Not ported / not verified
Weather on Today, the Shizuku live preview card on Home, accent-from-wallpaper (uses the spirit's glow, as the phone UI does), the lyrics window, the loadout pose bar. Everything is compiled and unit-tested for its logic only; no screen has been looked at on a device or in a rendered preview.

### Screenshots (`gradle recordScreens`)
Roborazzi 1.32.2 (test scope) renders every screen and kit component on `FakeCore` at 1260x2800 px / 480 dpi, dark and light, with a drawn status bar and punch-hole, into `C:\lokey-android-tools\shots\native` (outside the repo). Code: `app/src/test/java/app/lokey/link/shots/ScreenShots.kt`; the normal unit tests skip it. The spirit is a placeholder disc there (a WebView cannot render in Robolectric). Not a pass/fail test: it is for looking at.
