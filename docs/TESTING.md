# Testing lokey end to end

## Run
Newest build: `app\release\Lokey-<stamp>\Lokey.exe` (self-contained, no install; the folder with the latest stamp). Quit any other copy first (tray icon, Quit). Logs: `%LocalAppData%\Lokey\main.log` and `host.log`. Start with `--diag` to log main-thread stalls: `Lokey.exe --diag`.
Rebuild the package: `cd app; pnpm package` (never kills a running copy: if `release\Lokey` is in use it builds a new stamped folder next to it).
Developer check without touching your input: `Lokey.exe --uitest <dir>` injects hover/scroll/click events into the page only and writes `<dir>\uitest.json` (do not move the mouse over the island while it runs).

## Things to try (note "ok / wrong / how")
1. **Open**: hover the thin bar at the top-centre, scroll down on it (music island first, scroll again for Controls), or click it. Hotkey `Ctrl+Alt+Space` toggles the menu (it is "already registered" if another app, such as the old Hitodama.exe, owns it). A click on a tab or control no longer pins the island. Typing in a search/to-do box pins it; it then closes on `Esc`, when another app becomes active, or with the hotkey.
2. **Stability**: with the island visible use Alt+Tab, Win+Tab, switch browser tabs, Start/Search, Win+Shift+S. The island must stay or come straight back, and nothing near the top edge should feel blocked.
3. **Transitions**: opening, switching tabs and closing should feel immediate: the content fades in together with the shape, no delayed pop-in.
4. **Tabs**: Controls, Today, Stats, Clipboard (copy text/an image first), Apps (type, Enter), Wallpaper, Power (Lock/Sleep only).
5. **Player** (Music island and the Controls media card): start a song in Spotify/a browser. Title, art, progress that advances, play/pause (should flip instantly), next/previous, seeking by clicking the bar. Tell me which app you used. Apps with no title (Snipping Tool etc.) must not appear as the player.
6. **Wallpaper tab**: click the centre card: the new wallpaper should grow as a circle from where you clicked and then stay applied.
7. **Controls tiles**: Wi-Fi/Bluetooth/Audio chevrons open the in-app flyouts (list, connect, pair, device switch); Dark mode toggles the Windows theme; **Night Light** shows "Unavailable" unless Windows has already written its state (toggle Night Light once in Windows Settings, restart lokey, then try the tile).
8. **Loadout / main window**: tray menu -> "Open lokey": Loadout with the orbiting cards (click a card for the picker; drag a card), Home, Bond, Desk, Settings pages.
9. **Edge glow**: Settings -> Appearance -> "Preview screen glow" (Thinking / Speaking / Off).
10. **Settings** (tray menu): island size, trigger, resting shape, accent.

## What to send back
For each failure: what you did, what you expected, what happened, plus the last ~30 lines of `main.log` and `host.log`. For hangs: whether the pointer froze system-wide or only the island, and for how long.
