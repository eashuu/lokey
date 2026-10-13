# Hitodama product analysis (from hitodama.in, 2026-10-13)

Source: the public marketing site, its /requirements and /legal/privacy pages. The app itself was not available, so everything below is what the site claims or demonstrates. The site's demos are scripted web mock-ups, not captures of the real app.

## What it is
A Windows-only (10/11), voice-first AI companion built on Gemini Live with the user's own Google AI Studio key. Sold once for INR 499 ("Founders Edition"). Its UI is an "island" at the top of the screen (a Caelestia-like dashboard). The site calls it "a native Windows application".

## Feature inventory
Voice / AI
- Push-to-talk and live conversation (Gemini Live, speech in and out), type from a console, mute mic.
- **Lasso** (Ctrl+Shift): circle part of the screen, ask about it aloud; the cropped screenshot goes to Gemini. Can then act ("open the store page of this game").
- **Dictation** (hold Ctrl+Win anywhere): speech cleaned of false starts and corrections, inserted into the focused text box.
- **Routines / scheduling**: "open Netflix at 7:00 AM"; it wakes itself, acts, reports.
- **Computer control**: opens apps, moves around the desktop, reads the screen, types and clicks via Windows synthetic input and UI Automation. Terminal and raw desktop automation are off by default. Cannot touch UAC, lock screen, some anti-cheat games.
- **Memory** panel (facts it remembers; read, edit, delete), conversation history, to-do list, calendar, snippets, reminders, research (optional Tavily key), world headlines, weather, Insights (daily usage counts), internet speed test (M-Lab).
- **Loadout**: four slots around the "soul": Soul (name/avatar), Personality (e.g. "True Chad"), Voice (e.g. "Charon"), Abilities.
- Settings: Privacy ("let it see what's going on"), Delete all my data, console.

Island (non-AI, works without a key)
- Tabs: Controls, Today, Stats, Clipboard, Apps, Wallpaper, Power.
- Stats: CPU/GPU/RAM rings with model names, disk, network, uptime, top apps by RAM, speed test.
- Apps: launcher search ("Win+A") for apps, files and snippets; starred and recent; games.
- Clipboard history: 30 days, DPAPI-encrypted, skips password managers and banking, pinned items.
- Wallpaper: carousel of skewed cards, Recent / My folder.
- Music island, scroll-down on the island opens it.

## Look and motion
- Island: near-black rounded panel attached to the top edge, warm gold accent, small tab labels, ring gauges, dark progress bars.
- Mascot: a blue flame/water-drop spirit ("soul") that floats, blinks and sits in the island pill.
- Marketing site: cream background, EB Garamond headlines with italic blue/grey accents, Figtree body, Noto Sans JP for the kanji, JetBrains Mono. Lenis smooth scroll, pinned scroll scenes, 16 canvases.

## Technical facts from the privacy page
- API keys stored with Windows DPAPI. Clipboard history DPAPI-encrypted.
- GeoNames data bundled for offline place names; location from Windows Location, else ipwho.is; weather from a public API.
- No telemetry; only a licence check against the vendor.
- Browser control "depends on what the browser exposes through Windows accessibility" (UI Automation).
- One active installation per licence.

## Gap against what we built
Built: the island shell (dashboard, media, performance, clipboard, launcher, drawers, bar). Missing: the entire AI layer (Gemini Live voice, lasso, dictation, routines, computer-control tools, memory, loadout/soul, personalities), the mascot, Today/Wallpaper-as-island-tab polish, snippets, calendar, to-do.
