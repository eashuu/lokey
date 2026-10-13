# Development guide

## Prerequisites

Windows 10/11 (64-bit), [Node.js](https://nodejs.org) 22+, [pnpm](https://pnpm.io) 11, the [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0). Optional: ffmpeg + Python 3 to regenerate README art.

## First run

```powershell
git clone https://github.com/eashuu/lokey.git
cd lokey
pnpm run bootstrap     # = pnpm --dir app install  +  dotnet build native/Lokey.Host -c Release
pnpm dev               # electron-vite dev server + Electron
```

`pnpm dev` finds the sidecar at `native/Lokey.Host/bin/Release/net8.0-windows10.0.22621.0/win-x64/Lokey.Host.exe`. Set `LOKEY_HOST_EXE` to use a different build (handy when a running copy locks the default one). If the sidecar cannot start the app runs on mock data and logs why in `%LocalAppData%\Lokey\main.log`.

## Everyday commands

| Command | |
|---|---|
| `pnpm dev` | development run with renderer hot reload |
| `pnpm typecheck` | `tsc --noEmit` for main, preload, renderer and shared code |
| `pnpm build` | production bundles in `app/out` |
| `pnpm sidecar` | `dotnet build` of the sidecar (must stay at zero warnings) |
| `pnpm package` | full build → `app/release/Lokey/Lokey.exe` (a stamped sibling folder if a copy is running) |
| `pnpm verify` | typecheck + build + sidecar build, the same as CI |

Run from `app/` instead if you prefer: `pnpm dev`, `pnpm package`, and so on.

## QA modes

All of them avoid real mouse and keyboard input and never take focus, so they are safe to run while you work.

| Flag | What it does |
|---|---|
| `--selfcheck` | Scheduler (fake clock) and tool-parsing checks; writes `selfcheck.txt` |
| `--bench <dir>` | Drives the island through every tab 3×, records frame times, CPU, memory and writes a screenshot per view and a `report.json` |
| `--uitest <dir>` | Injects hover/wheel/click events into the page only and checks the state machine; writes `uitest.json` with a trace. Keep your pointer away from the top of the screen while it runs |
| `--lab <dir> [--lab-page p] [--lab-query q]` | Renders an offscreen page to `lab.png`: the spirit pose sheet, the glow check, a settings page (`--lab-page settings --lab-query section=shortcuts`), the animation reel, mock backdrops |
| `--demo schedule\|dictation\|lasso [--capture dir] [--record dir]` | Replays a voice scenario with scripted text (no mic, no network); overlays are click-through |
| `--shots <dir>` | README stills and frame sequences on fake data only |
| `--theme dark\|light\|auto`, `--accent #rrggbb`, `--soul <skin>` | In-memory overrides for the above |
| `--diag` | Logs main-thread stalls over 150 ms |

Sidecar: `Lokey.Host.exe --selftest` calls every read-only method once and prints one JSON report (exit 0 only if everything passed). With `LOKEY_DATA_DIR=<temp>` it also runs a synthetic clipboard-store check.

Manual test checklist for a release: [TESTING.md](TESTING.md).

## README art

```powershell
pnpm build
bash scripts/readme-art.sh stills      # screenshots (dark and light) from fake data
bash scripts/readme-art.sh spirit      # pose sheet and skins
bash scripts/readme-art.sh voice       # voice demo frames (shows brief overlays on screen)
```

Needs ffmpeg on `PATH` and Git Bash. The scripts only use the app's own fake-data mode (`--lokey-demo-data`), so no personal data can leak into images. Animated demos are written to `assets/demos/`, which is git-ignored for now.

## Adding things

- **A tab**: component in `tabs/`, entry in `tabs/registry.tsx`, size in `island/shapes.ts` (`MENU_SIZE`), tab width in `island/Panel.tsx`, default order in `shared/bridge.ts`.
- **A native feature**: method/event in `shared/protocol.ts`, a service in `native/Lokey.Host/Services`, `Register()` in `Boot.cs`, a `SelfCheck` if it can be tested safely.
- **An assistant tool**: declaration and `runTool` case in `app/src/main/agent/tools.ts`. Keep it reversible, validate arguments, and add a case to `toolsSelfCheck`.
- **A spirit action**: a function in `mascot/poses.ts` (and an entry in `GALLERY` to preview it), render it with `--lab`.
- **A skin**: an entry in `island/skins.ts` (`form: 1` puffball, `0` water drop).

## Releases

Push a tag `vX.Y.Z`: `.github/workflows/release.yml` builds on a Windows runner, runs `pnpm package`, zips `app/release/Lokey` as `Lokey-X.Y.Z-win-x64.zip` and attaches it (with a SHA-256 file) to a GitHub release.
