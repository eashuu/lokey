# LokeyNative (Capacitor plugin)

Kotlin sources: `app/src/main/java/app/lokey/link/`. Registered in `MainActivity`.

## Calling it

```ts
import { registerPlugin } from '@capacitor/core'
const Native = registerPlugin<any>('LokeyNative')
const { result } = await Native.call({ method: 'audio.get', params: {} })     // always {result}
Native.addListener('event', ({ name, data }) => { /* media.changed, wake.detected, ... */ })
```

- Method names and result shapes are the ones in `src/shared/protocol.ts`; the phone-only ones are below.
- A failure never rejects and never crashes the WebView: it resolves `{ result: { ok:false, reason } }`. Check `Array.isArray` / `ok === false` on list methods.
- Permission denied -> `{ ok:false, reason:"permission needed: contacts (perm.request contacts)" }`.
- Boot: call `app.launchAction` once. It returns `{ launch: {action:'ask'|'listen'|'wake'|'share'|'confirm', text?, id?} | null }` (what started the app: tile, widget, assistant gesture, share, wake). Later launches arrive as event `app.launch`.
- Events marked durable are queued on disk while the WebView is not alive and delivered when the plugin loads.

## Protocol methods (same names as the sidecar)

| Method | Android notes |
|---|---|
| `sys.hello`, `sys.quit`, `display.get`, `user.get` | `display.get` bounds/work in px; `dpi` = densityDpi*96/160 |
| `audio.get/setVolume/setMuted/setMicMuted/devices` | music stream; `audio.setDefault` opens the volume panel and returns ok:false |
| `audio.visualiser {on}` | event `audio.bands` ~30 Hz. `Visualizer` FFT when mic permission is granted, else synthetic (result `mode`: `fft` or `synthetic`; it also falls back per frame if the FFT is all zero) |
| `stats.subscribe {intervalMs}` / `stats.unsubscribe` | event `stats.tick`. Android hides /proc/stat from apps: `cpu.pct` is Lokey's own load when unreadable (`cpu.ownLoadOnly:true`), `top` is `[]`, `gpu` null, temp = battery temp |
| `system.get` | `network.kind` can also be `'cellular'`; `nightLight` null |
| `system.setBrightness` | system value with `write-settings`, else this window only while Lokey is open |
| `system.setKeepAwake` | keeps Lokey's screen on (foreground only) |
| `system.setDarkMode`, `system.setNightLight`, `system.setBluetooth`, `wifi.setOn/connect/disconnect`, `bt.connect/disconnect`, `audio.setDefault` | not allowed to apps on Android 10+: opens the right system panel and returns `{ok:false, reason}` (`system.setBluetooth {on:true}` shows the system enable dialog) |
| `system.openSettings {page}` | also `intent.settings`; pages: network wifi bluetooth sound display battery apps location nfc airplane date language storage privacy security data vpn developer notifications default-apps main + every special permission name |
| `wifi.get`, `wifi.scan` | scan needs `location` (or `nearby`); throttled by the OS (4 scans / 2 min) |
| `bt.get/devices/discover/pair/forget` | needs `nearby` on Android 12+. `connected` and `battery` use hidden APIs (degrade to false / null) |
| `apps.list/search/icon/launch/star/searchFiles/openPath` | `id` = package name. `lastUsed` needs `usage-access`. `searchFiles` is MediaStore and needs `media` |
| `clipboard.list/get/pin/delete/clear/paste/settings`, `clipboard.set {text}`, `clipboard.read` | text and links only. Android 10+ lets only the foreground app read the clipboard, so history is captured while Lokey is open. `paste` also pastes into the focused field when autoPaste is on and accessibility is enabled |
| `wallpaper.get/set/recent/folder/thumb` | `set` takes a content:// or file path (MediaStore listing via `recent`/`folder`, needs `media`); `get` always null |
| `desktops.*`, `power.do` | one desktop; `power.do lock` uses the accessibility lock action, other actions open the power menu; `process.*` refuse |
| `hotkey.*` | refuse (no global hotkeys) |
| `media.get`, `media.control {action}`, `media.selectSession {id}` | needs `notification-listener`; without it `hasSession:false, needsListener:true`. Event `media.changed` (positionMs is as of `sampledAt`) |
| `foreground.get` | accessibility service (event `foreground.changed`), else usage stats |
| `text.insert {text}`, `text.focusRect`, `text.selection` | accessibility; `hwnd` ignored; refuses password fields |
| `windows.list/focus/forceForeground` | accessibility windows; `hwnd` = window id, focus launches the app |
| `input.chord {name}` | back home recents notifications quick_settings power_menu split_screen lock screenshot volume_up volume_down mute play_pause next prev |
| `input.keys {combo}` | back/esc, home, recents, enter, ctrl+a/c/x/v, volume and media keys; anything else refused with a reason |
| `input.mouse {action,x,y,toX,toY,amount}` | gestures: click, double, right/middle = long press, scroll, drag; `move` is a no-op |
| `wake.set {claps,phrases,confidence,clapSensitivity,paused}`, `wake.status` | event `wake.detected {kind,phrase,confidence}` (durable) |
| `secret.get {name}` -> `{value}`, `secret.set {name,value}`, `secret.clear {name?}`, `secret.list` | AES-GCM key in the Android Keystore; `key` / `ref` accepted as the name |

Events: `display.changed` (not emitted yet), `foreground.changed`, `media.changed`, `audio.changed`, `audio.bands`, `stats.tick`, `system.changed`, `clipboard.changed`, `wifi.changed`, `bt.changed`, `audio.devices.changed`, `apps.changed`, `wake.detected`, `wallpaper.changed`.

## Phone-only methods

| Method | Params -> result |
|---|---|
| `intent.open` | `{url}` any URI |
| `intent.app` | `{package}` or `{name}` (label search) |
| `intent.timer` | `{seconds,label?,skipUi?=true}` |
| `intent.alarm` | `{hour,minute,label?,days?:[1=Sun..7],skipUi?=true}` |
| `intent.maps` | `{query}` / `{lat,lng}` / `{query,navigate:true}` |
| `intent.dial` | `{number}` (never calls silently) |
| `intent.sms` | `{number,text}` opens the composer |
| `intent.share` | `{text,subject?,type?}` |
| `intent.play` | `{query,package?}` play-from-search, falls back to a YouTube search |
| `intent.camera` | `{video?}` |
| `intent.settings` | `{page}` |
| `intent.start` | `{action,data,type,package,component:"pkg/cls",categories,extras}` |
| `reminder.set` | `{id?,at | inMs,title,text}` -> `{id,at,mode}`; `reminder.cancel {id}`; `reminder.list`. Event `reminder.fired` (durable). Re-armed after reboot |
| `flashlight.set` | `{on}` |
| `contacts.search` | `{query,limit}` -> `[{name,numbers:[{number,type}]}]` (`contacts`) |
| `sms.list` | `{box:'inbox'|'sent',limit,query?,address?}`; `sms.send {number,text}` sends for real: the trust layer must confirm first (`sms`) |
| `calllog.list` | `{limit,type?:'missed'|'incoming'|'outgoing'}` (`calllog`) |
| `calendar.list` | `{fromMs?,toMs?,limit}` (`calendar`); `calendar.insert {title,startMs,endMs?,description?,location?,allDay?,silent?}`: silent=false opens the calendar editor, true writes directly |
| `notifications.list` | `{limit}` -> `[{key,package,app,title,text,time,canReply}]` (`notification-listener`); `notifications.reply {key,text}`; `notifications.dismiss {key}`; events `notification.posted`, `notification.removed` |
| `notify.show` | `{title,text,id?}` |
| `notify.confirm` | `{id,title,detail,allowLabel?,denyLabel?,fullScreen?}` heads-up card (promoted ongoing on Android 16 by reflection); the buttons come back as event `confirm.action {id,allow}` (durable); `notify.cancel {id}` |
| `notify.progress` | `{id,title,text,pct,done?}` job progress (pct -1 = unknown) |
| `perm.status` | `{name?}` -> `{name,granted,kind}` or all in `{permissions:{...}}` |
| `perm.request` | `{name}`: runtime ones ask in place and wait (`{ok,granted}`; if it was denied before it opens the app settings); special ones open the exact settings screen and return `{granted:false,opened:true}`: re-check on event `app.resume` |
| `ui.tree` | `{maxNodes?=350}` -> `{pkg,w,h,count,nodes:[{id,cls,text?,desc?,res?,b:[l,t,r,b],click?,long?,edit?,scroll?,checked?,focus?,password?}]}` (ids valid until the next `ui.tree`) |
| `ui.click` / `ui.longClick` | `{id}` / `{text}` / `{x,y}` |
| `ui.setText` | `{id?,text}` (focused field when no id) |
| `ui.scroll` | `{dir:'up'|'down'|'left'|'right',id?}` |
| `ui.swipe` | `{x1,y1,x2,y2,durationMs?}` |
| `ui.back/home/recents/notifications/quickSettings` | `{}` |
| `screenshot` | `{maxWidth?=1080,quality?=70}` -> `{ok,mime:'image/jpeg',base64,w,h,screenW,screenH}` (Android 11+, about 1 per second, protected screens refused) |
| `service.set {on}`, `service.status` | keep the foreground service running / report it |
| `island.update`, `island.setEnabled`, `island.status`, `app.bringToFront`, `app.sendToBack`, `service.voice` | see "System-wide island" below (`island.set {on}` is kept as an alias of `island.setEnabled {overlay:on}`) |
| `widget.update {line,sub}` | text shown on the home widget |
| `app.launchAction`, `app.openSelf`, `app.methods` | see above; `app.methods` lists every method |

Permission names (`perm.*`): runtime `mic notifications contacts sms calendar calllog location nearby media`; special `overlay accessibility notification-listener battery-optimisation-exempt usage-access write-settings exact-alarm full-screen-intent assistant autostart app-info`. `assistant` opens the default-assistant picker; `autostart` tries vivo/iQOO's background-start manager and falls back to the app info page (unverified on OriginOS).

Sideloaded APKs: Android 13+ greys out Accessibility / Notification access until "Allow restricted settings" is chosen in App info (three-dot menu). `perm.request app-info` opens that page.

## Android pieces

Foreground service `LokeyService` (specialUse + microphone: wake listening, island, keep-alive; stops when none is wanted), `BootReceiver`, `LokeyAccess` (accessibility), `LokeyNotifs` (notification listener + media sessions), `LokeyWidget`, tiles `AskTile` / `ListenTile`, assistant role (`LokeyVoiceService`, `LokeySessionService`, ASSIST / VOICE_COMMAND filters), `ReminderReceiver`, `ActionReceiver`, `Island` overlay.

## Manifest permissions

INTERNET, network/wifi state, FINE_LOCATION, NEARBY_WIFI_DEVICES, BLUETOOTH(_CONNECT/_SCAN), RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, FOREGROUND_SERVICE(+_SPECIAL_USE/_MICROPHONE), RECEIVE_BOOT_COMPLETED, WAKE_LOCK, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, SYSTEM_ALERT_WINDOW, POST_NOTIFICATIONS, POST_PROMOTED_NOTIFICATIONS, USE_FULL_SCREEN_INTENT, USE_EXACT_ALARM, SCHEDULE_EXACT_ALARM (<=32), SET_ALARM, READ_CONTACTS, READ_SMS, SEND_SMS, READ_CALL_LOG, READ_CALENDAR, WRITE_CALENDAR, READ_MEDIA_IMAGES, SET_WALLPAPER, PACKAGE_USAGE_STATS, WRITE_SETTINGS. Runtime ones are only asked through `perm.request`, never at install.

## Not verified on a phone

Everything: the APK builds and the manifest components were checked with aapt2, and the clap detector has JVM unit tests (`gradle testDebugUnitTest`). No method has been run on a device. Specifically unsure: phrase spotting (`SpeechPhraseSpotter`, heavy and probably beeps), mic foreground service start from background, Live Update / Origin Island promotion, vivo autostart component names, Bluetooth hidden APIs, Visualizer on Android 16, taps from `dispatchGesture` on vivo, starting the app from the background on `wake.detected` (needs overlay access).

## System-wide island (v0.7.0)

Two parts, both driven by one payload from the page:

1. **Live Updates** (`LiveUpdates.kt`): a promoted-ongoing notification per activity (voice, timer, job, approval, pc, reminder), updated in place under one id and cancelled when the face disappears. Uses POST_PROMOTED_NOTIFICATIONS, channels at DEFAULT/HIGH (new ids `live_v2`, `asks_v2`, `remind_v2`), ongoing + title + standard styles only (BigText, setProgress, chronometer countdown; no custom views), `setRequestPromotedOngoing(true)` and `setShortCriticalText` by reflection (compileSdk is 35). Timers use the notification's own countdown chronometer instead of a static `mm:ss` chip. `Notification.ProgressStyle` is not used (needs SDK 36); a plain progress bar is.
2. **Overlay island** (`Island.kt`, `IslandView.kt`): black capsule in a TYPE_APPLICATION_OVERLAY window at the DisplayCutout (top-centre under the status bar when there is none), springs open into a 28dp card. Native Canvas, no WebView. Shown only while Lokey is not on screen. Hidden over fullscreen apps (status bar hidden, from window insets), on the lock screen / screen off (an approval still shows), and in landscape. Music is derived natively from the MediaSession listener (face id `native-music`, needs notification access) so it works with the page asleep.

`island.update {faces:[{id,kind,title,subtitle,progress?(0..1),startAt?,endAt?(epoch ms),icon?(png/jpeg data URL),actions?:[{id,label,primary?}],priority}], primary:id|null, spirit?:dataUrl}`
- kinds: voice music timer job approval pc reminder charging idle (idle only shows with `alwaysVisible`). Highest `priority` (primary first) is shown; swipe left/right cycles.
- `spirit` (96px) is the face image for faces without their own `icon`; a glyph is drawn when there is none. Repeated updates with the same faces only refresh the image (cheap, safe at 8 fps).
- Default controls when `actions` is empty: timer toggle / plus1 / stop, job stop, approval deny / allow, reminder snooze / done, pc ask. Music card: prev / toggle / next / seek (native music handles them itself).
- A new approval face auto-expands the island.

`island.setEnabled {overlay?, liveUpdates?, alwaysVisible?}` toggles the two parts (call it on visibilitychange: overlay only while the app is hidden).
`island.status` -> `{overlayGranted, promotedGranted, promotedSupported, cutout:{left,top,right,bottom}|null, overlayRunning, sdk, overlayEnabled, liveUpdates, visible, faces, fullscreenHidden, promotable:{faceId: Notification.hasPromotableCharacteristics()}, atomicIsland}` (`promotable` is the debug read: if it is false the OS will not promote that notification).

Events (both spellings are emitted, all durable): `island.action {faceId, face, actionId, action}` (overlay card buttons and Live Update notification buttons), `island.tap {faceId, face}`, `island.hold {state:'start'|'end', down}`, `island.double {}`.
Gestures: tap expand/collapse, swipe left/right cycle, swipe up collapse, long press = hold-to-talk, double tap = `island.double`.

Background voice: Android blocks background microphone capture, so a hold on the overlay emits `island.hold start` and brings Lokey forward (`app.bringToFront {voice:true}`, allowed from the background by the overlay permission). The page then opens the mic and calls `app.sendToBack` (moveTaskToBack) when the turn ends. `service.voice {on}` starts the foreground service with the microphone type and a partial wake lock (10 min cap) for the session; call it while Lokey is in front. Capacitor keeps JS timers running when paused (KeepRunning is true) and the renderer is set to important priority; Chromium may still throttle a hidden page's timers. The page is translucent-free: bringing Lokey forward shows it fully.

Permissions the UI should request: `overlay`, `live_updates` (opens Settings > Live updates for the app, `ACTION_MANAGE_APP_PROMOTED_NOTIFICATIONS`), `battery` (= `battery-optimisation-exempt`), `notifications`, `notification-listener` (music).

### vivo Atomic Island
`AtomicIslandAdapter` (no-op `NoopAtomicIsland`) is the hook. vivo's third-party Atomic Island API is a push-based partner programme on the vivo developer platform, not self-serve, so nothing is implemented and no whitelisted package name is spoofed. On OriginOS the supported route is the Android 16 Live Update above; whether Origin Island shows it is up to vivo.

Unverified: all of this on a device (cutout geometry, insets-based fullscreen hiding, promotion, the spring animation, starting the app from the background).

## vivo Origin Island experiment (v0.7.1)
`VivoIsland.kt` puts vivo's documented `notification.superx.*` extras on the Live Update notifications (see `docs/VIVO-ISLAND.md`; needs vivo's approval, unverified, no spoofing). New: `island.setEnabled {vivo:bool, vivoScenes:{kind:scene}}` (vivo default true), `island.status.vivoSuperx`, and the debug method `island.vivoProbe {kind?, end?}`. `AtomicIslandAdapter` is now implemented by `VivoIsland`.

## v0.7.2 island fixes (found with the Robolectric render harness)
`IslandRenderTest` (Robolectric native graphics, vivo T4 Ultra metrics) draws every state to `app/build/island-shots/` and drives touches. Found and fixed: the overlay hid itself (INVISIBLE + FLAG_NOT_TOUCHABLE) because the window-insets "status bar visible" test, meant to spot fullscreen apps, reported false for the overlay window, so the pill could not be touched (that heuristic is removed; the island now also shows over fullscreen apps); the avatar was clipped to a 21 dp circle and stretched into a square box (now fitted, aspect kept, never cut, 28 dp, capsule >= 38 dp tall, centred on the hole centre, hole width only sets the gap); corner radius is clamped to half the shape and spring geometry is capped so frames stay inside the window (window inflated to 24 dp / 28 dp); long-press now uses the main handler so it also fires reliably.

## v0.7.3: the native layer runs the background (no WebView needed)
Root cause (confirmed in code): the overlay was only turned on by the page (`island.setEnabled {overlay}` from `visibilitychange`), had no native default, and showed nothing without page faces; the wake service only ever started from a page call; the PC link lived in the page. Now:
- **Overlay**: `IslandPolicy.decide` (native) shows it whenever Lokey is not in front (`MainActivity` onStart/onStop count), the setting is on (default on) and the overlay permission is granted; hidden in landscape and on the lock screen (approvals still show). It always shows at least an idle Lokey capsule (`alwaysVisible`, default true). Fullscreen apps are not detected. **The page must send the user switch as `island.setEnabled {systemIsland: bool}` (from Settings only, never from visibility handling).** The legacy `overlay:true` switches it on, `overlay:false` is ignored.
- **Faces**: page faces are kept natively (survive process death) and expire after 2 min without `island.update` (timers/reminders with `endAt` run on until 30 s after the end, max 8 h). Native sources: music (needs notification access), reminders (countdown within 15 min, then a Due card with Snooze / Done), wake "Listening", the PC link, the idle capsule.
- **PC link, native** (`LinkClient`): `link.credentials {base, token}` (null / empty = unpaired) stored sealed with the Keystore; SSE `/events` with backoff, `/status` every 60 s, 401 = unpaired (event `link.unpaired`). Approval cards become island approvals + Live Updates; Allow/Deny from the overlay or notification POSTs `/approve` natively. `link.status` -> `{paired, connected, lastEventAt, cards}`. If the page shows the same approval (same title + text) the native copy is dropped.
- **Wake**: the config (`wake.set`, optional `list:[{text,action}]`) is persisted natively and the foreground service restarts it (app open, `onTaskRemoved` alarm, START_STICKY). Detection with the app in front -> `wake.detected` event. Not in front -> "Listening" face + Live Update, then `MainActivity` is started with extras (overlay permission, else a full-screen-intent notification); the page reads `app.launchAction` -> `{action:'wake', kind:'clap'|'phrase', phrase, wakeAction}` and starts the conversation, then calls `app.sendToBack`. Detection pauses while `service.voice {on:true}`. The microphone service cannot start from the background (boot / after being killed): the notification then offers "Start listening" (opens Lokey) and `wake.status.error` says so.
- **Foreground notification**: Ask / Pause listening (Resume) / Stop (Stop lasts until Lokey is opened again).
- **Permissions**: `perm.request battery` (ignore battery optimisation), `autostart`, `background-power` (vivo / iQOO screens, best-guess component names, fall back to app info).

### diag.status / diag.beat
Call `diag.beat {}` every 20 s while the page is alive. `diag.status` -> `{serviceRunning, serviceMic, overlayShown, overlayReason, overlayGranted, systemIsland, appForeground, jsHeartbeatAgeMs|null, lastIslandUpdateAgeMs|null, wakeListening, wakeEnabled, wakePaused, wakeError, wakeLastEventAt|null, wakeLastDecision, linkPaired, linkConnected, linkLastEventAt|null, batteryExempt, sdk, manufacturer, brand}`.

Unverified: all of it on a phone.

## Shizuku power tier: `shizuku.*`, `bg.*`, `priv.*` (v0.8)

Optional second (virtual) screen, driven by Shizuku. Files: `ShizukuApi.kt` (methods), `BgService.kt` (the user service in the shell process, `IBgService.aidl`), `BgUi.kt`, `ShizukuAllow.kt` (shell allow-list, package deny-list). How it works and what is unverified: `docs/SHIZUKU-TIER.md`. Failures are `{ok:false, reason}` as everywhere; "Shizuku is not running", "Shizuku is not installed" and `permission needed: shizuku (shizuku.request)` are the usual ones.

| Method | Params -> result |
|---|---|
| `shizuku.status` | `{probe?=true}` -> `{installed, running, permissionGranted, version, uid (0 root / 2000 adb), serviceBound, canCreateDisplay (true / false / null), reason?, probe?:{ok,displayId,ime,uid,inputReady,release}, display?, sdk, brand, model}`. The probe creates and destroys a 360x640 display (cached 60 s; first call starts the service, about 1-3 s) |
| `shizuku.request` | asks Shizuku to allow Lokey (waits up to 60 s) -> `{ok, granted}` |
| `shizuku.openGuide` | `{page: app / dev / web / get}` open Shizuku, Developer options, the setup guide, the download page |
| `bg.start` | `{width?=720,height?,dpi?=320,idleMs?=20000,decorations?=false}` -> `{displayId,width,height,dpi,ime,flags}` (reuses a running one) |
| `bg.state` | -> `{active, display}` |
| `bg.launch` | `{package, activity?, fresh?}` opens an app on the display (`am start --display`); `fresh` force-stops it first. Refuses deny-listed packages (banking, payment, wallet, password, authenticator) |
| `bg.frame` | `{quality?=60,maxWidth?=720}` -> `{jpegBase64,mime,w,h,ageMs,black,stale,seq,displayW,displayH,note?}`. `black:true` = nothing drawn yet or a FLAG_SECURE window |
| `bg.tap {x,y}`, `bg.longPress {x,y,ms?}`, `bg.swipe {x1,y1,x2,y2,ms?}`, `bg.key {key}`, `bg.text {text}` | pixels of the virtual display; keys: back home enter tab delete escape menu recents search space up down left right pageup pagedown. `bg.text` types ASCII as keys, other text through accessibility `ACTION_SET_TEXT` (never into a password field) |
| `bg.ui` | `{maxNodes?=350}` -> same node shape as `ui.tree` plus `{pkg, displayId, source: accessibility|uiautomator}` (accessibility `getWindowsOnAllDisplays`, else `uiautomator dump --display`) |
| `bg.foreground` | -> `{pkg, activity}` (dumpsys, best effort) |
| `bg.stop` | `{keepService?}` destroys the display and unbinds the service |
| `priv.shell` | `{command}` allow-listed (see ShizukuAllow.kt) -> `{ok, code, output}` |
| `priv.input` | `{action: tap/longPress/swipe/key/text, display?=0, ...}` silent input on the real screen or any display id |

Events: `bg.state {active, displayId?, pkg?, width?, height?, dpi?, reason?}`, `bg.frame {jpegBase64,w,h,black,seq}` (emitted by `bg.frame` calls, at most 2 per second; there is no background polling), `bg.error {reason}` (Shizuku died, the service did not start or the binder was lost; ordinary failures arrive as results).

Manifest additions: `ShizukuProvider`, `uses-permission moe.shizuku.manager.permission.API_V23`, `<queries>` for `moe.shizuku.privileged.api`. Gradle: `dev.rikka.shizuku:api` and `:provider` 13.1.5, `buildFeatures.aidl`. Not run on a phone.
