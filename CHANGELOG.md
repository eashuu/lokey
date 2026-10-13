# Changelog

All notable changes to lokey. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/) once 1.0 is reached.

## [0.1.0] - 2026-10-13

First public release of the Electron + .NET rewrite.

### Added
- **Island**: one animated shape that morphs between a thin bar, an awake notch, a music island and 11 menu sizes; opens on hover, scroll, click or hotkey; region-shaped overlay window so the rest of the screen stays clickable.
- **Tabs**: Controls (Wi-Fi, Bluetooth, audio, Night Light, dark mode, volume, brightness, media), Today, Stats, Clipboard, Apps, Wallpaper, Power, plus in-island Wi-Fi, Bluetooth and audio-device flyouts.
- **Themes**: dark, light and follow-Windows, with accent and panel tint derived from the wallpaper.
- **Voice assistant** over Gemini Live: push-to-talk, tools (open app or site, search, schedule, media, volume, brightness, remember), persisted scheduler, Desk and Bond pages.
- **Dictation** into any text field with live raw transcript, clean-up rewrite and Unicode typing.
- **Circle to ask**: freehand loop on screen, whole-screen and crop sent with the question.
- **The spirit**: a WebGL2 raymarched 3D character with a spring rig, behaviour brain, 35+ actions and postures, 14 emotes, 10 skins and eye contact.
- **Settings**: per-tab global shortcuts with conflict detection, trigger and size options, voice settings, loadout (skin, personality, voice, abilities).
- **Tooling**: `--bench`, `--uitest`, `--lab`, `--demo`, `--selfcheck`, sidecar `--selftest`; README art generator.

### Known limits
See the status table in the [README](README.md#-status-and-known-limits) and [docs/REVIEW-AND-ROADMAP.md](docs/REVIEW-AND-ROADMAP.md).

[0.1.0]: https://github.com/eashuu/lokey/releases/tag/v0.1.0
