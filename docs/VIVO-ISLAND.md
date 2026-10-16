# vivo Origin Island (原子岛) in Lokey: an experiment

## What is what
- **Android 16 Live Update** (official Android API): what Lokey posts for voice / timer / job / approval / pc / reminder. Works on any Android 16 phone if the user allows "Live updates" for the app. It is not vivo's island API.
- **Our overlay pill** (`Island.kt`): our own imitation, drawn by Lokey around the camera. Not the system island.
- **vivo Origin Island** (this document): vivo's own island, driven by vivo-specific extras on a normal notification. Implemented as an experiment in `VivoIsland.kt`; the same Live Update notification carries both the Android 16 promotion flags and the vivo extras.

## The official route (as publicly documented)
Source: help.aliyun.com/zh/document_detail/3030718 (quotes vivo's guide). vivo's own pages, dev.vivo.com.cn/documentCenter/doc/894 (integration) and /doc/895 (design spec), are single-page apps that could not be read from here, so everything below is from the Aliyun copy only.

Local create / update / end (the app posts the notification itself while its process is alive):
- Channel `IMPORTANCE_HIGH`; ordinary title / text / small icon; extras on the notification:
  `notification.superx.operation` (int 0 create, 1 update, 2 end; same notification id for all three), `.showNotify` (boolean, true = fall back to a normal notification), `.template` (int; 1 priority info, 2 progress visualisation, 4 basic), `.clickResp` (PendingIntent), `.scene` (String), `.baseInfos` (Bundle holding `notification.superx.baseInfos.icon`, `.title`, `.content`).
- Scenes named in the page: MOVIE, HEALTH_REGISTER, TAXI, TAKEOUT, DELIEVERY (sic), NAVIGATION, CAR_STATE, METTING (sic), TRAIN, FLIGHT (the page says there are more).
- Limits: 1 update per 10 s per activity (extra updates are dropped); removed after 2 h without update; 8 h maximum; if the user deletes the island from the shade / lock screen it does not return for that activity.
- Remote (server push) route uses vivo Push with a `liveMessage` JSON (templateData, capsuleData, islandData, displays bit mask...). That needs a vivo push channel, appKey and a server; Lokey has none and does not use it.
- **Not documented for the local route:** the Bundle schema for capsule / island / progressInfo / subInfo data (those names exist only in the remote JSON). Lokey does not guess them: it sends only the documented keys above, and logs (tag `LokeyVivo`) when a progress / basic template is used without them.
- `getSceneStatus` (check the user's scene switch) is in vivo's push SDK, which Lokey does not bundle, so `sceneStatus` is reported as null.

## Permission: required, and we do not have it
vivo says access must be approved: create a developer account at dev.vivo.com.cn, register the app package (`app.lokey.link`), apply for the 原子通知 / 原子岛 permission as described in doc 894 (email vivo as that page says; the Aliyun page also says to email vivo when creation fails), and for remote updates integrate vivo Push (test push mode exists). Without approval the system may ignore the extras: the notification then simply appears as a normal one (`showNotify=true`) or as an Android 16 Live Update.

## What Lokey implemented
- Extras exactly as above on every island notification (`VivoIsland.extras`), operation 0 on first post, 1 on updates, 2 (then removal after 1.5 s) when the activity ends, `clickResp` = open the app.
- Kind -> scene is an **experimental guess**, none of vivo's scenes is an assistant: voice METTING, timer TAKEOUT, job DELIEVERY, approval HEALTH_REGISTER, pc CAR_STATE, reminder FLIGHT. Change with `island.setEnabled {vivoScenes:{timer:'TRAIN'}}`. This does not mean vivo approved any of it.
- Template: timer / job 2, approval 1, others 4.
- Updates are coalesced to one per 10 s per activity (latest wins) while vivo extras are on; creates and ends are immediate.
- Switch: `island.setEnabled {vivo:bool}` (default true). `island.status.vivoSuperx` = `{attempted, enabled, vivoDevice, sceneStatus:null, scenes, manufacturer, brand}`.
- No package names are spoofed.

## Testing it on the phone
Call `island.vivoProbe {kind?:'approval'|'timer'|'job'|'voice'|'pc'|'reminder'}` (a Settings button should call it). It posts one test island notification carrying the extras, reads it back through `NotificationManager.activeNotifications`, and returns `{posted, extrasReadBack, extrasKept, scene, template, channelImportance, canPromote, promotable, vivoDevice, sceneStatus, note}`; it ends itself after 30 s (`{end:true}` ends it now). Then look at the screen:
- Island appears: vivo honours the extras for this sideloaded app.
- Only a normal notification / Android 16 Live Update chip: the extras were accepted as plain data but vivo ignores them (most likely: no vivo approval for this package).
`extrasKept:true` only proves the notification carries the extras, not that the island shows.

## New: route "vivo-full" (full schema, `VivoSuperX.kt`)
Beside the documented-subset route above (kept, still the default). Same idea, but it sends the whole `notification.superx.*` / `island.superx.*` schema that the OriginOS Toolkit (MIT, github.com/cameleonnbss/originos-toolkit) documents and that it ports from CunnyPlayground's `originos-experimental` branch (github.com/theVakhovskeIsTaken/CunnyPlayground, **no licence file**: all rights reserved by default, so we took only key names and semantics, which are facts, and wrote our own code; nothing copied). Credit to both.
- Wire: `operation` 0, `showNotify`, `template` (1 base / 2 progress), `scene` TRAIN, `changedRecord`, `clickResp`, bundles `baseInfos`, `capsule` (state, content, icon), `infos`, `shortInfos`, `island` (leftTemplate 1, rightTemplate 1..6, leftInfo, rightInfo). One shared `Icon` instance in all bundles.
- Face -> right template: voice listening RHYTHM, thinking LOADING, speaking TEXT_ICON (short reply, 24 chars), timer / job PROGRESS (percent), approval CAPSULE ("Approve?"), pc ICON_TEXT, reminder TEXT_ICON. Left = icon + title (12 chars). Icon = the latest spirit frame the page sent (the project has no static per-state spirit bitmaps), else the app icon.
- Dedicated LOW silent ongoing channel `vivo_full_v1`, one fixed notification id (one pill, the first live activity), scene registered by reflection on the hidden `NotificationManager.setSuperXInfosSceneList` (failure ignored), end = one write with operation 2, then cancel. Updates are coalesced to one per 10 s.
- When the route is "full", the subset extras are not added to the Live Update notifications (the plain Live Update chip still posts: that is the fallback).
- Settings > You > Island > vivo Origin Island: Test full island, Test documented subset, Test both (subset now, full 22 s later), "Send with" (subset / full, stored `vivo_route`), "Island style" System (vivo) / Overlay pill / Both (stored `island_style`), and after each test "It showed / It didn't" (stored `vivo_showed`). The same controls exist in the WebView settings source (`phone/settings.tsx`; needs a web rebuild to appear). Natively: `island.vivoProbe {route:'subset'|'full'|'both'}`, `island.setEnabled {vivoRoute, vivoStyle, vivoShowed}`.
- Style System hides Lokey's own overlay pill only when you answered "It showed"; before that, or after "It didn't", the overlay pill keeps showing. Nothing is assumed.

**Verified:** only the wire format and the face mapping, by JVM tests (`VivoSuperXTest`, a recording sink). **Not verified:** everything on a device (whether OriginOS 6 on a vivo T4 Ultra honours it, whether the key names and TRAIN scene are right for our package, whether the reflection call exists). vivo's renderer is closed and ignores unknown keys; approval of the package may still be required.

**How to test:** Settings > You > Island > "Test full island", look at the top of the screen for 30 s, tap "It showed" or "It didn't". Then "Test documented subset" and compare, or "Test both". Switch "Send with" to Full schema to try real activities (timer, voice, approval). The probe result (`extrasReadBack`, `nestedReadBack`) shows which extras the system kept; `island.status.vivoSuperx.lastFullProbe` holds the last full one.

**Fallback:** if it does not show, answer "It didn't": the overlay pill and the Android 16 Live Update keep working as before; switch "Send with" back to Documented subset.

## 0.9.1: the full route as the default on vivo / iQOO
**Verified on the user's vivo T4 Ultra (classic APK):** the full-schema test pill ("Test full island") makes the real Origin Island appear with proper layout. So the key names, scene TRAIN and the Icon sharing are accepted by OriginOS 6 for this package. **Still unverified on a device:** update cadence and trailing updates for real activities, the pill outside the app (native wake / service driven), the end/unmount and stale-pill cleanup, the tap target, and the native-shell behaviour of all of it.
- **Defaults:** `vivo_route` unset = `full` on vivo / iQOO, `subset` elsewhere. Our overlay pill keeps showing until the user answers the Island check, so no assumption is made.
- **Island check** (vivo / iQOO only): a step in the native onboarding, a sheet at the first launch after install/update for existing installs (until answered; "Later" keeps it due), and "Island check" in You > Island. It posts the full test pill and asks "Is the pill around the camera showing? Yes / No". Yes = route full, style System, showed yes (overlay pill hidden, no double pill). No = route subset, style Overlay. Non-vivo phones skip it (overlay + Live Update). Anyone who already answered in the probe UI is not asked again.
- **Faces on the pill:** the first non-idle face of the island order. voice listening RHYTHM, thinking LOADING (both text-free so the changing transcript costs nothing), speaking TEXT_ICON (reply), timer / job PROGRESS, approval CAPSULE, pc and charging ICON_TEXT, reminder and music TEXT_ICON. The pill is built from the native layer (`Island.syncLive`), not the page; a 5 s native tick (also when no overlay is drawn) notices expired faces and music, wake "listening" schedules its own expiry.
- **Update budget:** a post only when the wire content changed (signature), at most once per 10 s per activity; a change inside the window becomes one trailing update (latest state wins); a 10 s tick re-checks timers. First create and ends are immediate.
- **End / cleanup:** operation 2, then cancel (1.5 s later); the service ending or the task being swiped away with nothing left to do ends it at once; one fixed id (2900) so there is never a second pill; the first publish of a new process cancels a pill left by a dead one.
- **Tap:** the pill opens Lokey on Home (approvals and the voice card live there); approval uses the confirm action, everything else the ask action. Unverified that vivo honours `clickResp` for the pill.

## Honest expectation
Likely: no vivo island for a sideloaded, unapproved app. Possible: it works on a vivo test build or after vivo approval. Unknown until tried; nothing here was run on a phone.
