# Lokey Link (phone companion)

Lokey Link lets an Android phone talk to Lokey on your PC over your home Wi-Fi: approve the confirm cards, type or dictate a request, search memory, check status and push text to the PC clipboard. It is a web app (PWA) served by the PC. There is no native APK yet.

Android only. Distribution is GitHub Releases only; there is nothing to install on the phone from a store.

## Pair

1. PC: Settings > Devices > turn Lokey Link on (default off). Windows may ask to allow Lokey on private networks; allow it.
2. Settings shows the LAN URL (for example `http://192.168.1.20:47831`) and, after "Pair a phone", a 6-digit code valid for 2 minutes and 5 tries.
3. Phone (same Wi-Fi): open that URL in Chrome, type the code and a device name. The PC issues a random 256-bit token. The phone keeps it in localStorage; the PC keeps only its SHA-256 in `%LOCALAPPDATA%\Lokey\devices.json`.
4. Revoke in Settings > Devices cuts the phone immediately (its live stream is closed and the next call gets 401).

## Install on the home screen (Chrome, Android)

Chrome only registers a service worker and offers "Install" on a secure origin. An `http://192.168...` page is not one, so it works as a normal web page but is not installable by default. To install it:

1. On the phone open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
2. Add the PC's URL (for example `http://192.168.1.20:47831`), set Enabled, relaunch Chrome.
3. Reload the page, menu > Add to Home screen / Install app.

Give the PC a fixed IP (router DHCP reservation), or the URL will change and the flag entry with it. Without the flag, just bookmark the page.

## vivo T4 Ultra, OriginOS 6

Background web pages get frozen aggressively. For approvals to arrive while the screen is off:

- Settings > Battery > Background power consumption management > Chrome (and the installed Lokey Link): Allow high background power consumption.
- Settings > Apps > Autostart (or Permission management > Autostart): allow Chrome.
- Open Recents, long-press the Chrome / Lokey Link card and lock it.
- Settings > Notifications: allow Chrome and the site's notifications. Allow when Chrome asks.
- Keep Lokey Link in the foreground when you expect a prompt; the stream reconnects on its own every 3 s after being frozen.

None of this is verified on a real device yet (see limits).

## Security model

- Off by default. When on, the server listens on one port (default 47831) and drops any connection whose remote address is not loopback, RFC1918 (10/8, 172.16/12, 192.168/16), link-local or IPv6 unique-local. It is plain HTTP, so anyone on your Wi-Fi can sniff the token: use it on a network you trust, never port-forward it.
- Pairing: one-time 6-digit code, 2 minutes, 5 attempts, then it is dead. Pair attempts and bad tokens are rate limited per address with exponential backoff.
- Every API call needs `Authorization: Bearer <token>`; compared by SHA-256 with a constant-time compare.
- Scopes: `agent` (approve, say, clipboard), `view` (status, memory), `notify` (push events). There is no control scope: no remote mouse or keyboard in this version.
- `/say` runs the same typed-text path as the island, tagged `remote:<deviceId>` in the action log. It does not touch settings, so it cannot raise autonomy; whatever the PC's confirm mode is, the PC still asks (and the card goes to the phone and the PC).
- All Link actions (pair, approve, say, clipboard) are written to the action log shown in Desk.

API: `POST /pair`, `GET /events` (SSE: `confirm`, `confirm-done`, `job`, `nudge`), `POST /approve {id, allow}`, `POST /say {text}`, `POST /clipboard {text}`, `GET /status`, `GET /memory/search?q=`.

## Honest limits

- Verified: typecheck and the pure self-check (pairing expiry and attempt limit, token hashing and verify, revoke, non-private address rejection, backoff). Not verified: the web app on a real phone, the service worker install, Web Speech mic on Chrome, OriginOS background behaviour, the Windows firewall prompt.
- Notifications are in-page only: while Chrome is frozen or the tab is closed nothing reaches you. Real background push needs a native app (FCM) or an https push service; not in this version.
- Confirm cards time out after 30 s on the PC; a frozen phone will often miss them.
- Battery is shown only if the sidecar has emitted a stats tick; now playing and agent state come from the PC.
- No https: no service worker or install without the Chrome flag above.
- Remote prompts reach the PC's assistant like typed text. If the PC is on "Full control (never ask)", nothing asks, so keep Link and Full control apart.

## Roadmap

1. Native app: Kotlin (or Expo) APK on GitHub Releases, FCM or a foreground service for real notifications, same API.
2. Optional https with a self-signed pinned certificate shown as a QR code at pairing; QR instead of the typed code.
3. Wake-on-home: when the phone joins your home Wi-Fi it pings the PC (`POST /home`) and Lokey runs a "daddy's-home" routine (greeting, media, lights). Optional, off by default.
4. Optional control scope with a per-session on-PC approval, only after the input layer hardening in Phase A.


## Native Android app (prototype, `android/`)

A small native app for the same Lokey Link, built for the vivo T4 Ultra (OriginOS 6 = Android 16), min Android 8. No libraries; plain Android APIs.

Install: copy `app/release/android/Lokey-android-0.1.0-debug.apk` to the phone and open it (allow "install unknown apps" for your file manager or browser). It is debug-signed; a proper release key comes later.

What it uses on the phone
- **Pair screen**: PC address (shown in Settings > Devices) and the 6-digit code.
- **Heads-up notification** with Allow / Deny buttons when the PC asks for permission; it asks for a "Live Update" (promoted ongoing) on Android 16 so vivo's Origin Island can show it. Whether the island accepts a third-party app is vivo's choice and is **unverified**: if not, you get a normal heads-up notification.
- **Popup dialog** over whatever you are doing (tap the notification) to read the whole request and Allow / Deny.
- **Toasts** confirm each answer ("Allowed on your PC").
- **Home-screen widget** (4x2, long-press the home screen > Widgets > Lokey): PC state, now playing, PC battery; shows Allow / Deny when the PC is waiting; Ask button.
- **Quick Settings tile** "Ask Lokey" (edit the tile list to add it) opens a small ask popup; the widget's Ask button opens the same popup.
- **Share > Lokey** sends shared text to the PC clipboard.
- Finished jobs and nudges from the PC arrive as notifications while the app's connection notification is running.

Keep it alive on OriginOS: Settings > Battery > Background power consumption management > Lokey > allow; Autostart > Lokey on; lock the app in recents; allow notifications (and "pop-up on lock screen" if offered).

Limits: LAN only (same Wi-Fi); no remote screen/mouse control; no voice on the phone yet (type your request); the connection service may be stopped by the OS after a reboot until you open the app once.

Build it yourself: install JDK 17 + Android SDK (platform 35), then `gradle -p android assembleDebug` (needs Gradle 8.9), or run the `android` GitHub workflow.


### Standalone first, linked second (APK 0.2.0)
The phone app is its own assistant. **Without a PC** it works with your own free Google AI Studio key (Settings > "This phone's own assistant"; the key stays on the phone):
- chat by typing or by voice (the phone's own speech recogniser, English or Tamil in Settings; replies are spoken in Tamil when they are in Tamil script, otherwise Indian English)
- it acts on the phone with tools: open apps, timers, alarms, reminders, flashlight, volume, web search, open links, maps navigation, play music, open the dialer or the SMS composer (you press call/send, it never sends by itself), battery and time
- it keeps its own memory on the phone (short facts, never passwords/codes), and recalls it in later chats

**Once paired** the same assistant gains the PC:
- tools `ask_pc` (hand any computer task to Lokey on the PC) and `pc_status`
- memory syncs both ways (on connect and every ~5 minutes; duplicates merge), so what you tell either one is known to both
- PC approvals, finished jobs and nudges arrive on the phone; the widget shows the PC state
- unpairing keeps the phone's key, settings and memory

Not yet: Gemini Live voice (the phone uses its own recogniser, so no barge-in), a wake word on the phone, reading other apps' screens (accessibility agent), remote screen control, shared conversation history. The model name is editable in Settings (default gemini-2.5-flash).
