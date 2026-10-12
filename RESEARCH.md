# Hitodama clone: research notes

Reference sources are in `ref/`:
- `ref/caelestia-shell`: the Quickshell/QML shell, GPL-3.0
- `ref/caelestia-dots`: the Hyprland config, GPL-3.0

## Hitodama (hitodama.in), what it publicly shows

- **Product:** a native Windows 10/11 app sold once for ₹499 or $9 ("Founders Edition"), one active install per account.
- **AI:** Gemini Live, using the user's own Google AI Studio key, which is stored encrypted on the PC. Gemini handles speech and understanding; the app's own tools do the actual work.
- **Features:**
  - Circle to ask: hold Ctrl+Shift, lasso part of the screen, ask about it out loud.
  - Dictation: hold Ctrl+Win anywhere, talk, release. The cleaned-up sentence is typed into the focused field.
  - Scheduled one-off tasks and recurring routines.
  - To-do list and memory.
  - App, desktop and browser control through UI Automation and synthetic input. Terminal and raw automation are off by default.
- **"Island":** a pill at the top centre. Scroll down on it to open a menu with these tabs:
  - Controls: clock, weather, week calendar, next scheduled task, focus timer, to-dos
  - Today: system stats (CPU, GPU, RAM, disk, network, uptime, top apps by RAM, speed test)
  - Stats
  - Clipboard: search, All/Text/Images/Links filters, pinned items, grouped by day
  - Apps
  - Wallpaper: Recent / My folder, carousel
  - Power
- **"Soul" loadout:** four customisable slots (Soul, Personality, Voice, Abilities). Voice names are Gemini voices, e.g. "Charon".
- **Site stack:** Next.js App Router behind Cloudflare. Fonts are EB Garamond (display), Figtree (body) and JetBrains Mono.
- **Site design tokens:**
  - Page colour `#ffffeb`.
  - Glass: `rgba(255,254,242,.72)` with `blur(16px) saturate(1.4)`.
  - Radii: 12, 16, 20, 28, and 999 for pills.
  - Easing: `cubic-bezier(.16,1,.3,1)`.
  - Drawer easing: `cubic-bezier(.32,.72,0,1)`.
  - Spring: `cubic-bezier(.3,1.8,.55,1)`.
  - Durations: .16, .32 and .8 s.

## Caelestia, what to port

- **Entry and drawers.**
  - Entry point is `shell.qml`.
  - All drawers live in one fullscreen transparent window per screen (`modules/drawers/`). An input mask makes only the drawn parts clickable.
  - Open/close is driven by `offsetScale`, which goes from 0 (open) to 1 (closed). It controls the slide and the opacity together.
- **Triggers** (`modules/drawers/Interactions.qml`):
  - Hover the top edge to open the dashboard; hover the bottom edge for the launcher.
  - Corners and the right edge open utilities, OSD, sidebar and session.
  - Dragging works as well.
- **Frame:** a screen border plus the panel shapes, merged with an SDF smooth-min (smoothing 20, border 10, radius 25/28). Panels also wobble with velocity on a spring (stiffness 200, damping 16). See `plugin/src/Caelestia/Blobs`.
- **Tokens** (`plugin/src/Caelestia/Config/`):
  - Rounding, spacing and padding scale: 4, 8, 12, 16, 20, 28, 32, 48.
  - Font sizes: 11, 12, 13, 15, 18, 28.
  - Fonts: Google Sans Flex, CaskaydiaCove NF, Rubik, and Material Symbols Rounded for icons.
- **Motion:**
  - Default spatial: 500 ms, `0.38,1.21,0.22,1`.
  - Fast spatial: 350 ms, `0.42,1.67,0.21,0.9`.
  - Effects: 200 ms, `0.34,0.8,0.34,1`.
  - Standard: `0.2,0,0,1`.
- **Colours:** Material You colours generated from the wallpaper and written to `scheme.json`. The fallback dark palette is surface `#191114` and primary `#ffb0ca`.
- **Dashboard tabs:** Dashboard (user, weather, clock, calendar, resources, media), Media (cover art, visualiser, lyrics from lrclib), Performance, Weather (Open-Meteo).
- **Bar orientation:** Caelestia's bar is a vertical strip on the left, while Hitodama uses a top island. Keep the drawer mechanics and move the bar's content into the island.

## Linux to Windows mapping

| Caelestia | Windows |
|---|---|
| MPRIS (`services/Players.qml`) | `GlobalSystemMediaTransportControlsSessionManager` |
| Pipewire audio | Core Audio (`IAudioEndpointVolume`, `IAudioSessionManager2`) |
| cava | WASAPI loopback capture plus FFT |
| brightnessctl / ddcutil | WMI `WmiMonitorBrightnessMethods`, DDC/CI `SetVCPFeature` |
| Hyprland IPC | `SetWinEventHook`, `EnumWindows`, `IVirtualDesktopManager`, `RegisterHotKey` |
| nmcli | WinRT `Windows.Networking.Connectivity`, `WiFiAdapter` |
| notification daemon | `UserNotificationListener` (read-only) |
| `/proc` stats | PDH counters, `GlobalMemoryStatusEx`, `GetIfTable2`, NVML/DXGI |
| UPower | `GetSystemPowerStatus` |
| cliphist | `Clipboard.GetHistoryItemsAsync` |
| wallpaper CLI | `IDesktopWallpaper` |
| gpu-screen-recorder | `Windows.Graphics.Capture` |
| tray (SNI) | no public API, so skip it |

## Licence

Caelestia is GPL-3.0.
- **Reusing or translating its code** (QML, C++ or the `blob.frag` shader) means the port must be GPL-3.0 with its source published.
- **A closed-source port** must re-implement everything from scratch.
- **Not covered by the GPL:** the visual design, the token values and the Material 3 curves.
