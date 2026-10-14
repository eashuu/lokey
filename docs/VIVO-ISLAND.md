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

## Honest expectation
Likely: no vivo island for a sideloaded, unapproved app. Possible: it works on a vivo test build or after vivo approval. Unknown until tried; nothing here was run on a phone.
