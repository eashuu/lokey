# Testing lokey end to end

## Run
`app\release\Lokey\Lokey.exe` (self-contained, no install). Quit any other copy first (tray icon, Quit). Logs: `%LocalAppData%\Lokey\main.log` and `host.log`. Start with `--diag` to log main-thread stalls: `Lokey.exe --diag`.
Rebuild the package: `cd app; pnpm package` (stops running copies, builds, publishes the sidecar, writes `release\Lokey`).

## Things to try (note "ok / wrong / how")
1. **Open**: hover the thin bar at the top-centre, then scroll down on it (music island first, scroll again for Controls). Hotkey `Ctrl+Alt+Space` toggles the menu. Click the island to pin it (keyboard focus); `Esc` or clicking another window closes a pinned island.
2. **Stability (the bug we fixed)**: with the island visible, use Alt+Tab, Win+Tab, switch browser tabs, open Start/Search, snip with Win+Shift+S. The island must stay or come straight back. Click right next to the island and anywhere near the top edge: nothing should feel blocked. Watch for pointer lag or stalls.
3. **Tabs**: Controls, Today, Stats, Clipboard (copy some text/an image first), Apps (type to search, Enter to launch), Wallpaper (wheel and arrows, Enter sets it), Power (Lock/Sleep only; Restart/Shut down need a second click, do not confirm).
4. **Hover and press**: buttons, tiles, rows, chips: do they react like the reference (fill step on hover, slight scale on press)?
5. **Sizes and spacing**: anything cut off, misaligned, too tight, or visually different from the Hitodama site.
6. **Wi-Fi flyout** (Controls, Wi-Fi tile): list of networks, connect to a saved one, connect to a new secured one (password field), disconnect, radio switch. If it says Location services are needed, turn them on in Windows privacy settings.
7. **Bluetooth flyout**: paired devices and their state, connect/disconnect a headset, scan and pair a new device, forget (two clicks).
8. **Audio flyout**: output/input devices, switching the default, volume.
9. **Dark mode tile** toggles the Windows app theme.
10. **Settings** (tray menu): island size, trigger, resting shape, accent.

## What to send back
For each failure: what you did, what you expected, what happened, plus the last ~30 lines of `main.log` and `host.log`. For hangs: whether the pointer froze system-wide or only the island, and for how long.
