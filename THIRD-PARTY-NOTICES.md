# Third-party notices

lokey is licensed under GPL-3.0. It uses the following open-source components under their own licences. Run `pnpm --dir app licenses list` for the exact transitive set of the app, and see each project for the full licence text.

## Application (npm)

| Component | Licence |
|---|---|
| [Electron](https://github.com/electron/electron) | MIT |
| [React](https://github.com/facebook/react), React DOM | MIT |
| [Motion](https://github.com/motiondivision/motion) | MIT |
| [zustand](https://github.com/pmndrs/zustand) | MIT |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) (`lucide-react`) | ISC |
| [Material Color Utilities](https://github.com/material-foundation/material-color-utilities) | Apache-2.0 |
| [electron-vite](https://github.com/alex8088/electron-vite), [Vite](https://github.com/vitejs/vite), [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 |
| [rcedit](https://github.com/electron/rcedit) | MIT |

## Fonts (bundled through Fontsource)

| Font | Licence |
|---|---|
| [Inter](https://github.com/rsms/inter) | SIL OFL 1.1 |
| [Rubik](https://github.com/googlefonts/rubik) | SIL OFL 1.1 |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | SIL OFL 1.1 |

## Android native UI (`app/mobile/android`)

| Component | Licence |
|---|---|
| Jetpack Compose, Material3, Activity/Lifecycle (AndroidX) | Apache-2.0 |
| [Inter](https://github.com/rsms/inter), [Rubik](https://github.com/googlefonts/rubik), [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) variable TTFs in `res/font` (copied from github.com/google/fonts `ofl/`) | SIL OFL 1.1 |

Reference only (no code copied): the vivo full-schema island route (`VivoSuperX.kt`) uses the `notification.superx.*` key names and semantics documented by [OriginOS Toolkit](https://github.com/cameleonnbss/originos-toolkit) (MIT, (c) 2026 cameleonnbss) and the [CunnyPlayground](https://github.com/theVakhovskeIsTaken/CunnyPlayground) `originos-experimental` branch it ports (no licence file published; only facts were taken, the implementation is ours).

## Native sidecar (NuGet)

| Component | Licence |
|---|---|
| [NAudio](https://github.com/naudio/NAudio) (`NAudio.Wasapi`) | MIT |
| [System.Speech](https://www.nuget.org/packages/System.Speech) (wake phrases, Windows speech recogniser) | MIT |
| System.Management, System.Drawing.Common, System.Data.OleDb | MIT (.NET) |
| .NET 8 runtime (bundled in the self-contained build) | MIT |

## Legacy prototype (`legacy/winui-prototype`, not part of the shipped app)

| Component | Licence |
|---|---|
| Material Symbols / Material Icons (Google) | Apache-2.0 |
| Google Sans Flex, Rubik | SIL OFL 1.1 |

The licence texts for these fonts are kept next to them in `legacy/winui-prototype/Assets/Fonts/`.

## Artwork

The spirit (3D character), the logo and all README art are original work, generated from this repository's own code, and are covered by the repository licence.

## Lyrics

- **LRCLIB** (https://lrclib.net): free, open lyrics database queried over HTTPS for synced lyrics (title, artist, album and length are sent; nothing else). Each song's result is cached locally.
- **Spicy Lyrics** (https://github.com/Spikerko/spicy-lyrics, AGPL-3.0, by Spikerko): the lyrics window's look (gradient-lit words, the swell/float/glow keyframes and spring tuning, distance blur, three-dot interludes, art-tinted sliding background) is modelled on its behaviour, which the author of this project uses in Spotify. Lokey's implementation (`app/src/shared/lyricsAnim.ts`, `app/src/renderer/src/lyrics/`) is written from scratch for this app; no source code was copied. If you copy any part of Spicy Lyrics itself into this project, its AGPL-3.0 terms apply to that part.
- The spring formulation is the standard damped harmonic oscillator (the same maths as Fraktality's MIT-licensed `spr`).
