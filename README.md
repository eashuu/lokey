# lokey

A [Caelestia](https://github.com/caelestia-dots/shell)-style desktop shell for **Windows 11**, built natively with WinUI 3.

Caelestia is a Quickshell/Hyprland shell for Linux. lokey brings its look and motion to Windows: drawers that grow out of the screen edges, Material You colours from your wallpaper, and a fixed side bar. It runs as an overlay on top of Explorer and does not replace it.

> The project and executable are currently named **Hitodama** (`src/Hitodama.Shell`, `Hitodama.exe`).

## Features

**Top island (dashboard)**

A small live pill at the top of the screen showing the clock, now-playing art and the focus timer. Hover it, scroll on it or press the hotkey and it morphs into Caelestia's dashboard:

- **Dashboard**: weather, user card (with your account picture), date, month calendar, CPU/RAM/disk bars, media card with a progress arc.
- **Media**: round cover inside a live audio visualiser ring, controls, seek bar and a player switcher (Spotify, browsers, anything using Windows media controls).
- **Performance**: CPU, GPU and memory ring gauges, storage and a network sparkline.
- **Clipboard**: Windows clipboard history with search, filters and click-to-paste.

It also briefly expands for volume changes and track changes.

**Bottom launcher**

App search over every installed app (Win32 and Store), and `>` commands:

| Command | What it does |
|---|---|
| `>wallpaper` | Wallpaper carousel with a live colour preview |
| `>variant` | Material You variant |
| `>light` `>dark` `>auto` | Light, dark, or following the wallpaper |
| `>palette` | Surface palette: `neutral`, `monochrome` or `tinted` |
| `>transparency 0.85` | Surface opacity |
| `>scale 1.1` | UI scale (restarts) |
| `>timer 25` | Focus timer in minutes |
| `>session` `>lock` `>sleep` | Power actions |
| `>settings` `>quit` | |

**Left bar**

A fixed bar like Caelestia's, reserving screen space like the taskbar, so maximised windows stop at its edge. Autohide mode is also available, and the bar can sit on the left or right. Its entries can be reordered or turned off:

- Logo
- Virtual-desktop pills with a stretching active indicator
- The active window title
- Clock
- Status icons: network, Bluetooth, battery, audio, mic, keyboard layout
- Power

Hovering an entry opens a popout for audio, network, Bluetooth, battery, the active window or the calendar. Scrolling on the bar changes volume on the top half, brightness on the bottom half, and switches desktops over the pills.

**Right drawer**

- Vertical volume, mic and brightness sliders.
- Wi-Fi, Bluetooth, microphone and keep-awake toggles.
- A session menu (lock, sleep, sign out, hibernate, restart, shut down) that dims the screen behind it. Destructive actions need a second click.

**Look and motion**

- **Theme.** Light and dark modes, either set by hand or chosen from the wallpaper's brightness. The default palette is *neutral*: true white or charcoal surfaces with the accent colour taken from the wallpaper. *Monochrome* and wallpaper-*tinted* palettes are also available.
- **Motion.** Caelestia's curves and durations. Every animation runs on the Windows compositor, so nothing redraws in a loop.
- **Style.** Material Symbols icons, Rubik for numbers, Google Sans Flex for text, ripple feedback on buttons.
- **Scaling.** Sizes scale to the screen, so on smaller screens everything stays compact.

**Everything is configurable**

Each surface can be turned on or off: island only, drawers only, bar only, or any mix. You can also change hotkeys, tab order, bar entries, edge triggers and delays, palette, opacity, animation speed and UI scale.

## Requirements

- Windows 11, or Windows 10 19041+ (the bar's desktop switching targets Windows 11).
- x64.
- To build from source: the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0). Nothing else; the Windows App SDK comes from NuGet and is bundled in the output.

## Build and run

```powershell
git clone https://github.com/eashuu/lokey.git
cd lokey\src\Hitodama.Shell
dotnet build -c Release
.\bin\Release\net8.0-windows10.0.22621.0\win-x64\Hitodama.exe
```

The build is unpackaged and self-contained, so no installer is needed. To have it start at sign-in, turn on **Start with Windows** in settings.

## Usage

| Action | Default |
|---|---|
| Toggle the island | `Ctrl+Alt+Space`, hover the pill, or scroll down on it |
| Toggle the launcher | `Ctrl+Alt+A`, or hover the bottom-centre edge |
| Session menu | `Ctrl+Alt+End`, or the power button on the bar or dashboard |
| Right drawer | Hover the right-centre edge, or change the volume |
| Switch dashboard tabs | Click, scroll over the tabs, or `Ctrl+Tab` |
| Close any surface | `Esc`, click elsewhere, or move the pointer away |
| Settings | Run `Hitodama.exe` again while it's running, or `>settings` |

Settings are stored in `%LocalAppData%\Hitodama\settings.json`.

### Command line

| Flag | Effect |
|---|---|
| `--settings` | Open settings on start |
| `--open island[:Tab]` | Start with the island open, e.g. `--open island:Media` |
| `--open launcher[:query]` | Start with the launcher open, e.g. `--open launcher:>wallpaper` |
| `--open side` / `--open session` | Open the right drawer or the session menu |
| `--selftest [dir]` | Run the self-test (below) and exit |

## Self-test

`Hitodama.exe --selftest <dir>` drives every surface, tab, popout, theme and palette through the app's own API. It never sends mouse or keyboard input and never takes focus. For each state it saves a screenshot to `<dir>`, then writes `report.txt`, which includes:

- page sizes and overflow and trimmed-text checks
- work-area reservation by the bar
- the fullscreen check
- idle CPU and memory

It exits with code 0 when every check passes.

## How it works

- **One small window per surface** (`IslandWindow`, `LauncherWindow`, `SideWindow`, `BarWindow`, `BarPopout`). Each is a borderless, topmost, transparent window. Only the visible shape takes clicks (`SetWindowRgn`); the rest is click-through.
- **`EdgeSurface`** draws the surface as a Composition shape: a rounded body joined to the screen edge by concave fillets, like Caelestia's frame. Only a small property set is animated; expressions derive the shape, clip, slide and fade from it on the compositor thread.
- **Theme.** `Theme` extracts a seed colour from the wallpaper with [MaterialColorUtilities](https://github.com/albi005/MaterialColorUtilities). It builds the light or dark scheme and recolours every surface live.
- **Event-driven, no polling.** One hidden message window handles hotkeys, wallpaper changes, display changes and appbar notifications. WinEvent hooks track the foreground window and real fullscreen apps; registry change notifications track virtual desktops; system events track network and power. At idle the app wakes only once a minute, for the clock.
- **System services:**

  | Feature | Windows API |
  |---|---|
  | Media | `GlobalSystemMediaTransportControls` |
  | Audio | Core Audio (NAudio) |
  | Visualiser | WASAPI loopback + FFT |
  | Clipboard | Clipboard history |
  | GPU and thermal | PDH counters |
  | Laptop brightness | WMI |
  | Weather | [Open-Meteo](https://open-meteo.com) |

## Limitations

- **No system tray** in the bar: Windows has no public API for reading other apps' tray icons.
- **No notification popups:** reading Windows notifications requires a packaged (MSIX) app.
- **Brightness** works on laptop panels only; external monitors would need DDC/CI.
- **Virtual-desktop switching** sends `Ctrl+Win+←/→`, and only when you click or scroll the pills.

## Project layout

```
src/Hitodama.Shell/
  App.xaml(.cs)        coordinator: surfaces, hotkeys, settings changes
  EdgeSurface.cs       edge drawer engine (shape, motion, input region)
  Motion.cs Tokens.cs  Caelestia motion curves and size tokens
  Theme.cs             Material You / neutral / monochrome schemes
  *Window.*            island, launcher, side drawer, bar, settings
  Tabs/                dashboard pages
  Services/            media, audio, stats, weather, desktops, ...
  Assets/Fonts/        Material Symbols, Material Icons, Rubik, Google Sans Flex
```

## Credits

- Design and motion based on [Caelestia](https://github.com/caelestia-dots/shell) by caelestia-dots.
- Fonts:
  - [Material Symbols / Material Icons](https://github.com/google/material-design-icons) (Apache-2.0)
  - [Rubik](https://github.com/googlefonts/rubik) (OFL)
  - [Google Sans Flex](https://github.com/google/fonts) (OFL)

  Licence files are in `Assets/Fonts`.
- Libraries:
  - [Windows App SDK](https://github.com/microsoft/WindowsAppSDK)
  - [WinUIEx](https://github.com/dotMorten/WinUIEx)
  - [NAudio](https://github.com/naudio/NAudio)
  - [MaterialColorUtilities](https://github.com/albi005/MaterialColorUtilities)

## License

[GPL-3.0](LICENSE), the same licence as Caelestia.
