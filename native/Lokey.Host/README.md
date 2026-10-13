# Lokey.Host

Headless .NET 8 sidecar for the Electron app. Speaks the protocol in `app/src/shared/protocol.ts` over a Windows named pipe
(one JSON object per line, UTF-8, camelCase, nulls kept as `null`).

## Build / run

```
dotnet build -c Release                     # zero warnings expected
bin\Release\net8.0-windows10.0.22621.0\win-x64\Lokey.Host.exe --pipe <name>   # \\.\pipe\<name>, current user only
bin\Release\...\Lokey.Host.exe --selftest   # one JSON report on stdout, exit 0 only if every check passed
```

`--pipe`: accepts one client; requests are `{id,method,params}`, each gets one `{id,result}` or `{id,error:{message}}`;
events are `{event,data}`. When the pipe closes (or `sys.quit`) the process exits. If nobody connects in 30 s it exits too.
Requests with the same method prefix run in order; different prefixes never block each other.

Env `LOKEY_DATA_DIR` redirects all state (default `%LocalAppData%\Lokey`); tests use it. With it set, `--selftest` also runs a
synthetic clipboard-store check. Log: `host.log` in the data dir (1 MB roll, no clipboard text, paths redacted).

## Services (one file each under `Services/`)

| Service | How it works |
|---|---|
| Pump (`Native/Pump.cs`) | One STA thread + hidden top-level window (not message-only: those miss WM_SETTINGCHANGE/WM_DISPLAYCHANGE broadcasts). Hotkeys, clipboard listener, wallpaper/display messages, appbar notice. |
| Foreground | WinEvent hook on its own thread. `Current` = last window of another app (host and its Electron parent are ignored). `fullscreen.changed` only on `IsRealFullscreen()` transitions (hook + ABN_FULLSCREENAPP). |
| Hotkeys | `register` = RegisterHotKey (NOREPEAT). `registerHold` = WH_KEYBOARD_LL on its own thread, installed only while a hold chord exists; callback only updates state and queues to a channel. A clean Ctrl+Win release is replayed behind a 0xFF key so Start does not open. |
| Media | GlobalSystemMediaTransportControls, events only. Emits only on real change or a position jump. |
| Audio / Visualiser | NAudio endpoint volume + IMMNotificationClient. Loopback capture + 30 Hz timer exist only while `audio.visualiser {on:true}`. |
| Stats | Ticker only between `stats.subscribe` and `stats.unsubscribe` (interval clamped to >= 500 ms); PDH counters are created/closed with it. |
| Status (`system.*`) | Network (WinRT), battery (WinRT), Bluetooth radio, brightness WMI event, foreground-driven keyboard layout; `system.changed` only when the status differs. |
| Apps | `shell:AppsFolder` enumerated on the STA worker, cached; FileSystemWatchers on both Start Menu dirs -> debounced `apps.changed`. Icons via IShellItemImageFactory, cached as PNG. Stars/last-used in `apps.json`. `apps.searchFiles` = Windows Search (OleDb), `[]` on any failure or after 4 s. |
| Clipboard | AddClipboardFormatListener. Skips private formats, password managers, bank-like titles. `index.dat` is DPAPI, pinned items are stored plain (`pinned.json`, plain PNG). Retention (default 30 d) + 500 cap, pruned at start and by one 24 h timer. Own pastes are ignored via the clipboard sequence number. `autoPaste` defaults to false until `clipboard.settings` sets it. |
| Wallpaper | IDesktopWallpaper (STA) with SPI fallback; history from the registry; thumbnails cached by path+mtime. |
| Desktops | Registry watched with RegNotifyChangeKeyValue; occupancy via IVirtualDesktopManager. Ctrl+Win+Arrow only on `desktops.switch`. |
| Machine | `display.*`, `user.get`, `power.do`, `sys.*`. |

## Idle behaviour

No polling. With no subscription the process sits blocked in message loops/queues (0 CPU in a 15 s measurement). Timers that exist:
the 24 h clipboard prune, short debounces that are armed by an OS event, and the 30 Hz visualiser/stats timers while subscribed.
