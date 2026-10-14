# The Shizuku power tier: tasks on a second screen

Optional, Android only. Lokey can run a task in another app on a **hidden second (virtual) screen** while you keep using the phone, the same idea as scrcpy's `--new-display`. It needs [Shizuku](https://shizuku.rikka.app/) (a free app that lets other apps use shell-level privileges; not root). Target: vivo T4 Ultra, OriginOS 6 (Android 16).

**Status: everything below is built and compiles, and the JS loop is tested against a fake plugin. Nothing has run on a phone, with Shizuku, or on OriginOS.** The list of what is unverified is at the end; read it before trusting any claim here.

## What the user does (once per boot)

1. Install Shizuku (shizuku.rikka.app or its GitHub releases; not on Play Store). Settings > You > Power tier (Shizuku) has buttons for each step.
2. Start it: Developer options > Wireless debugging on, then in Shizuku "Start via wireless debugging" > Pairing, then Start. Needs Wi-Fi once. **Shizuku stops at every reboot** (without root) and must be started again.
3. Allow Lokey when Shizuku asks. Then press **Test second screen**: it creates a small display, opens Settings on it, takes one picture and closes it, and says pass or fail with the reason.

## How it works

```
page (src/mobile/secondScreen.ts)   second_screen_task / bg_apps / bg_stop, the loop (main/brain/operator.ts reused), safety rules
   | plugin calls bg.* / shizuku.* / priv.*
Kotlin plugin (ShizukuApi.kt, BgUi.kt)   permission, binds the user service, bg.ui through the accessibility service
   | Shizuku bindUserService  (AIDL: IBgService.aidl, JSON call + a pipe for pictures)
BgService.kt   runs in a process Shizuku starts with shell privileges (uid 2000)
   |- DisplayManager.createVirtualDisplay  -> an ImageReader surface (the pictures)
   |- InputManager.injectInputEvent + InputEvent.setDisplayId  -> touch, keys, text on that display
   '- `am start --display <id>`  -> opens an app there; `cmd package`, `dumpsys`, `uiautomator` for the rest
```

- **Shizuku side.** `dev.rikka.shizuku:api` and `:provider` 13.1.5 (the latest on Maven Central; the Shizuku app itself is at v13.6.0, May 2025). The manifest has `ShizukuProvider` (authority `${applicationId}.shizuku`, permission `INTERACT_ACROSS_USERS_FULL`) and `uses-permission moe.shizuku.manager.permission.API_V23` so Lokey is listed under Shizuku's authorised apps. The status uses `Shizuku.pingBinder`, `checkSelfPermission`, `requestPermission`, `getVersion`, `getUid` (0 = root, 2000 = adb). The service is started with `Shizuku.bindUserService(UserServiceArgs(component).daemon(false).processNameSuffix("bg").version(versionCode).tag("lokey-bg"))`. `daemon(false)` means Shizuku ends the service when Lokey's process dies, so a crashed Lokey cannot leave a display running. `destroy()` is the reserved transaction 16777114 (calls `System.exit`). The service class has a `Context` constructor (Shizuku v13 builds that context with `ActivityThread.systemMain().getSystemContext().createPackageContextAsUser`).
- **The display (copied from scrcpy's server).** `DisplayManager` has a hidden constructor taking a `Context`; scrcpy gives it a `ContextWrapper` that answers `com.android.shell` as package and op package (and, on 12+, an `AttributionSource` for the shell uid), otherwise the system refuses a caller whose uid does not own the package. Flags (bits as in scrcpy's `NewDisplayCapture`): `PUBLIC | PRESENTATION | OWN_CONTENT_ONLY | SUPPORTS_TOUCH | ROTATES_WITH_CONTENT`; on Android 13+ also `TRUSTED | OWN_DISPLAY_GROUP | ALWAYS_UNLOCKED | TOUCH_FEEDBACK_DISABLED`; on 14+ also `OWN_FOCUS | DEVICE_DISPLAY_GROUP`. Lokey adds `DESTROY_CONTENT_ON_REMOVAL` (apps on the display end with it; they do not jump to your real screen). `SHOULD_SHOW_SYSTEM_DECORATIONS` is off by default (`decorations: true` turns it on; scrcpy notes some devices draw a broken UI with it, and with it off the display has no launcher, so apps are started explicitly). The surface is an `ImageReader` (RGBA_8888); the newest buffer is converted to JPEG on demand.
- **Input.** `InputManager.injectInputEvent(event, mode)` after `InputEvent.setDisplayId(id)` (scrcpy's `Device.injectEvent`). Taps and swipes are touchscreen `MotionEvent`s; text for ASCII is key events from `KeyCharacterMap`; anything else (Tamil, emoji) goes through the accessibility service's `ACTION_SET_TEXT` on the focused field of that display (never into a password field).
- **Opening an app.** `am start -W --display <id> --activity-multiple-task -n pkg/activity`: scrcpy does the same with `ActivityOptions.setLaunchDisplayId` (API 26+); the shell command is the lazy equivalent. `--activity-multiple-task` makes a task of its own so an app you have open on the real screen is not dragged over (apps with `singleTask`/`singleInstance` launch modes may still be reused).
- **Reading the screen.** `bg.ui` uses `AccessibilityService.getWindowsOnAllDisplays()` (Android 11+); if the accessibility service cannot see that display it falls back to `uiautomator dump --display <id>` inside the shell process (that flag is not confirmed to exist on every release). The front app comes from the UI tree, else `dumpsys activity activities`.
- **Hidden APIs.** The user service is a plain `app_process` started by Shizuku, not a zygote-forked app, so Android's hidden-API restrictions do not apply to it (this is why scrcpy's server can use the same reflection). The plugin side (Lokey's app process) uses none. Hidden APIs do change between releases (scrcpy's server crashed on an Android 16 QPR2 beta because a hidden listener interface gained a method; fixed in scrcpy 3.3.3, issue #6362), so a new OriginOS update can break it. The status/test shows the error rather than failing silently.
- **Performance guard.** If no picture is asked for for 20 s (`idleMs`, 0 = off) the service detaches the display's surface so nothing is composited; the next picture re-attaches it and waits up to 1.5 s for a fresh frame. Side effect (unverified): a display without a surface may count as off and pause its apps. Stopping (`bg.stop`) releases the display and, by default, ends the service process.
- **Soft keyboard.** By default a virtual display's IME shows on the real screen (scrcpy documents this). Lokey sets the display's IME policy to HIDE (Android 13+) or LOCAL (11-12) through `IWindowManager.setDisplayImePolicy`; typing goes in as key events, so no keyboard is needed. If that call fails the status line says `default`.

## What a task does and never does

`second_screen_task {goal, app?}` starts a job (it appears in Desk, as a job face on the island with "Working in the background in <app> · step n" and a Stop action, and as a live preview card on Home). Per step: read the UI tree (and stop if the app is forbidden), take a picture, ask the model for one action, run it. At most 25 steps and 8 minutes; the stop control, "stop everything" and the time limit all close the display immediately.

Fixed in code (not settings; autonomy "full control" does not reach any of it, and the earned-trust system excludes these tools):
- **Never operated:** apps whose package name looks like banking, payment, UPI, wallet, crypto, password manager, authenticator / 2FA (`ShizukuAllow.denyPackage` in Kotlin and `denyPackage` in `secondScreenSafety.ts`, same pattern, both tested). Checked from the UI tree before any picture is taken, so a forbidden app is never sent to a model, and again when launching. Goals that mention money, passwords or codes are refused before a display exists. It is a keyword list, not a database of apps: an unlisted bank app with an unrelated package name is not caught by the package check (the screen-text check below is the second layer).
- **Never typed:** into a password field; anything that looks like a code, card number or API key; anything while the screen is asking for a PIN, password, OTP, CVV or card detail (the task stops and says the user must do that step).
- **Needs a card with the current picture:** taps on buttons that read like buy, pay, checkout, book, subscribe, send, post, publish, share, reply, delete, remove, install, transfer, submit..., Enter in a message field next to a Send button, and anything the model flags with `confirm_reason`. The card is a normal confirm card (also on the island) with the frame attached; it times out as "no" after 30 s; two refusals end the task. The start of a task asks too (except in full-control mode, where the rules above still apply). Not from a schedule, not when the request came from the PC or the web.
- **Text on the other screen is data.** The system prompt says so and the UI list is clearly labelled; this is a prompt-level defence, it can be fooled.
- No earned trust: these tools are on the never list in `agent/trust.ts`, and the in-loop cards never go through the trust book.

## Generic privileged helpers (plugin only, not model tools yet)

- `priv.shell {command}`: a command line parsed into an argv (no shell, so no `;`, `|`, `$()`), accepted only if it matches the allow-list in `ShizukuAllow.kt` (checked in the plugin and again in the service): `settings get <system|secure|global> <key>`, `settings put` for a short list of keys with a number, `svc data|wifi|bluetooth enable|disable`, `cmd location set-location-enabled`, `cmd package list|resolve-activity|path`, `pm list packages|path`, `pm grant|revoke` (runtime permissions for other apps; a few more for Lokey itself, e.g. `WRITE_SECURE_SETTINGS`), `am force-stop <pkg>` (not system UI, Shizuku, Settings, Lokey itself), `wm size|density`. The unit test `ShizukuAllowTest` covers what passes and what is refused.
- `priv.input {action: tap|longPress|swipe|key|text, display?: 0}`: silent input on the real screen (no accessibility service), for the cases where a gesture is refused there.
- These are not exposed as model tools: giving a language model `pm grant` is a decision for the user, not a default.

## Limits you will hit

- **Shizuku must be started again after every reboot** (wireless debugging, Wi-Fi needed once). A task started while it is down fails at once with that reason.
- **Wireless debugging turns itself off** on some phones when Wi-Fi changes; Shizuku keeps running once started, but restarting it again needs Wi-Fi.
- **OEM restrictions.** OriginOS may block starting activities on another display, blank the display, or kill the Shizuku / user-service process in the background (set Shizuku and Lokey to "no restrictions" for battery). Nothing about vivo is verified; I found no vivo-specific report either way. The Test button is the only honest answer for your phone.
- **Apps that refuse a second display or a non-resizable window:** some apps relaunch on the main display, show a blank window, or crash. Apps that open on the real screen anyway are detected when the UI list shows a different front app (the test says so), but a task can still disturb you in that case.
- **Secure windows (`FLAG_SECURE`)** (banking, some streaming and messaging apps, Settings pages with passwords) are black in the picture. The plugin reports `black: true`; the task keeps going from the UI list if there is one, and stops after three black pictures when there is no readable UI list either. It cannot be bypassed and is not meant to be.
- **Camera, microphone, calls, screen recording** do not work the same way on a virtual display, and an app that needs the real screen being on (some games, players) may not run.
- **Battery and heat.** Compositing a second display plus a JPEG per step costs; it is meant for short tasks (minutes). The idle guard helps only while nothing asks for pictures.
- **Pictures cost model tokens** (each step sends one 720-px JPEG plus the UI list).
- **Soft limits:** one second screen at a time; 25 steps; 8 minutes.

## Unverified (be sceptical)

Everything on a device: that `createVirtualDisplay` with these flags is accepted on OriginOS 6 / Android 16 from the Shizuku user service; that the `FakeContext`-style context is accepted (Android 16 may check more); that apps start on the display with `am start --display`; that the IME policy call exists on this build; that `injectInputEvent` with a display id reaches the app; that `ImageReader` receives frames from a display with no apps drawing yet; that the accessibility service can read windows of a display it did not create; that `uiautomator dump --display` exists; the `dumpsys` parsing for the front app; what happens to apps when the surface is detached; Shizuku's behaviour with `daemon(false)` when Lokey is swiped away; the battery cost. The Kotlin compiles and the allow-list and deny-list have JVM unit tests; the loop, the cards and the safety rules have a Node test (`pnpm mobile:check`, "secondScreen"). Neither proves any of the items above.

## Sources I relied on

- Shizuku-API README and demo: https://github.com/RikkaApps/Shizuku-API (dependencies, `ShizukuProvider`, permission flow, `UserServiceArgs`, the destroy transaction 16777114, the `Context` constructor); `server-shared/.../UserService.java` (how the context is built); `starter/.../ServiceStarter.java` in https://github.com/RikkaApps/Shizuku; versions from https://repo1.maven.org/maven2/dev/rikka/shizuku/api/maven-metadata.xml and the GitHub releases API (manager v13.6.0).
- scrcpy server (Genymobile/scrcpy): `video/NewDisplayCapture.java` (flags), `FakeContext.java` (`com.android.shell`), `wrappers/DisplayManager.java` (hidden constructor), `wrappers/InputManager.java` and `device/Device.java` (`setDisplayId`, `injectInputEvent`, `startApp` with `ActivityOptions.setLaunchDisplayId`), `doc/virtual-display.md` (no launcher on some devices, system decorations, IME policy, destroy-on-close), issue #6362 (hidden-API breakage on Android 16 QPR2 beta).
- vivo: I found no documentation or report about virtual displays on OriginOS; treat vivo behaviour as unknown.
