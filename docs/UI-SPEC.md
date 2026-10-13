# Hitodama UI/animation spec (reverse-engineered from hitodama.in)

Source: the site's public JS/CSS bundles and its rendered demos (2026-10-13). The site has **no video files**: every demo is code-driven (DOM + 16 canvases + Motion), over static stock photos (wallpapers, posters) and the logo. The demos are choreographed scripts, so this document is the authoritative reference for look, motion and timing. Values are from the demo's 1440x810 reference stage; the real app's pixel scale is unknown, so treat sizes as proportions.

## 1. The island is a notch with four shapes, not a pill

One SVG path, redrawn every frame from five animated numbers: `depth` (height), `width`, `corner` (bottom corner radius), `rampW`, `rampH` (concave fillets where the notch meets the top edge).

| State | depth | width | corner | rampW | rampH | Notes |
|---|---|---|---|---|---|---|
| sleep | 16 | 210 | 17 | 9 | 11 | thin sliver at the top edge, soul hidden (opacity 0) |
| awake | 75 | 210 | 17 | 18 | 22 | notch with the flame soul inside (soul box 210x91, y = depth-91) |
| held (push-to-talk) | 36 | 168 | 16 | 10.8 | 13.2 | soul scaled 0.44; 5 white voice bars (3 px wide) |
| menu:`view` | 0.9*h | 0.9*w | 22.95 | 27.54 | 26.01 | content laid out at (w,h) then scaled 0.9 |

Menu sizes (w x h): music 380x150, controls 640x390, today 880x442, stats 880x338, clipboard 880x446, apps 720x638, wallpaper 1040x314, power 640x166.

Path (centre x = stage centre, `r = cx - w/2`, `l = min(corner, w/2)`, `c = min(rampH, depth-0.5)`):
- start `M (r-rampW) -4`, `L (r-rampW) 0`
- ramp: cubic `C (r-rampW+0.72*rampW) 0, d (c-0.72c), d c` where `d` = x of the body edge at height c
- left edge straight down to `depth-l`
- bottom corner: points `(r + l*a^2, depth - l*(1-a)^2)` for a = 0..1 in 24 steps (a soft squircle, not a circle), mirrored for the right side, straight bottom between them, mirrored ramp, close.
- Fill: vertical gradient `#101012 → #000000` for the notch states; solid panel colour in menu state (fill transitions `.8s ease`); in menu state stroke `rgba(255,255,255,.10)` 1px and no drop shadow; otherwise `drop-shadow(0 6px 14px rgba(0,0,0,.35))`.
- The menu content is clipped with `clip-path: path(<same path>)`, so content and shape morph together.

Transitions between shapes (all animate the same five numbers together):
- notch → menu: 0.42 s, ease `cubic-bezier(.215,.61,.355,1)`
- menu → notch: 0.42 s, ease `cubic-bezier(.65,0,.35,1)`
- menu → menu: 0.22 s, ease `(.215,.61,.355,1)`; 0.38 s when the music view is involved
- notch ↔ notch (sleep/awake/held): 0.55 s, ease `(.215,.61,.355,1)`
- soul position/scale/opacity use the same 0.55 s curve (opacity 0.3 s).
This is a tween with an out-cubic ease, not a spring. No overshoot.

## 2. Opening the menu: progressive scroll
Scrolling down on the island opens the **music island** (380x150) first; scrolling down again opens **Controls**; the tab bar then switches views. Hover is not used in the demo. (Hotkey/hover can still be offered as settings.)

## 3. Visual system (island menu)
- Font: **Rubik** (the whole menu). Sizes: tabs 13, titles 14, body 13, small 12, micro 10-11.
- Colours: text `#F4F5F8`, muted `#8A92A3`, soft `#A3AAB8`/`#C8CFDB`/`#D3D9E3`; surfaces are flat translucent white on the near-black panel: `rgba(255,255,255,.063)` cards, `.047`-`.055` sub-rows, `.078` tiles, `.102`-`.118` buttons; **no borders**.
- Accent: `--accent` and `--accent-ink`, derived from the wallpaper; changes animate `.8s ease`. Active tab: pill height 28, radius 14, `color-mix(accent 16%, transparent)` background, accent text; inactive `#8C8791`; tab gap 6 px; tab widths 83/64/60/90/58/94/67.
- Radii: cards 18-20, tiles 16, rows 10-12, chips 14 (pill), buttons 9-15.
- Hover: rows `rgba(255,255,255,.086)`; power buttons `.063 → .118` in 0.1 s linear; tiles toggle `.18s cubic-bezier(.33,1,.68,1)`.
- Selected rows: `color-mix(accent 18-20%, transparent)`.

## 4. Per-tab layout (design px)
- **Music** (380x150): 46 px cover (radius 10), title 14/500, artist 12 muted, time labels 10, 3 px progress bar.
- **Controls** (640x390): media card 604x132 radius 18 (device label, 52 px cover, 20 px title, prev/play(44, `#EDE3C8`)/next, bar 488x3); volume slider 604x38 pill with accent fill and value at right; tile grid (Wi-Fi, Bluetooth, ...), tiles 58 high: 34 px icon circle, title 13/500, subtitle 11; **on = filled accent, ink text**; a thin divider at right of each tile.
- **Today** (880x442): clock card (46 px numerals with an accent dot between), temperature 28, weather line; week range + 7 cells (today = accent fill); "next" row with a pink `#F28BB6` 5 px bar; focus timer ring (84 px) with presets 38x28 (active amber `#F5A524` 20% fill), Start (amber `#F5A524`, ink `#2A1800`) and Reset buttons; to-do rows (40 high, radius 12, strike-through when done, count ring `#C1EA86`), dashed "add" field.
- **Stats** (880x338): CPU/GPU/RAM dials (92 px, label 14/500, sub 11, chips radius 7), facts row (disk, network, uptime; 184x58), top apps list (22 px letter tile, 12 px name, 4 px bar `#8ED92F`), internet-speed card.
- **Clipboard** (880x446): search 844x42 with chips (All/Text/Images/Links) at right; list 372 wide (headers PINNED/TODAY/YESTERDAY 11 uppercase, rows 36 high with 26 px type tile, title, timestamp); **preview pane 460x280 radius 18** (body text 14/1.5, rule, Type/Size/Copied meta); **keyboard hint bar** (Paste, Ctrl C Copy, Ctrl P Pin, Del Remove, ↑↓ Move, Ctrl/Shift pick several, Tab Filter) with 20 px kbd chips.
- **Apps** (720x638): search 684x46 with magnifier and "Win+A" hint; chips; sections (STARRED, RECENT, APPLICATIONS); rows 42 high with 28 px tile, name 14, kind label right, star; selected row accent 18%; "↵ Open".
- **Wallpaper** (1040x314): pills Recent / My folder, count, folder button; track 1004x196 of **skewed cards** (`skewX(-11.86deg)`, radius 12, 1 px inner ring `rgba(255,255,255,.118)`, image counter-skewed and oversized), non-centre cards dimmed by a black overlay; applying = 2.2 px accent ring; centre pitch ~211 px.
- **Power** (640x166): row of buttons 92 high radius 20 (icon + label 13/500), hover `.118`.

## 5. The soul (the mascot)
The island's mascot is a **flame** ("hitodama" = soul fire), drawn on canvas, not a face. Palette per skin: `core #FFFFFF`, `mid #BFE9FF`, `glow #5CB8FF` for the default "Hitodama" skin. Modes with intensity: TALKING .85, THINKING .55, LISTENING .26, YAWNING .70 (wake-up), MUTED .06 (asleep). `hearing` and `speaking` flags modulate it. Skins add particle auras: ember, wisp, shard, glint, void (the void skin pulls particles in). The brand logo (blue droplet with a smug face) is separate artwork used for the app icon.

## 6. Screen-edge state glow
While THINKING or SPEAKING the **whole screen edge** glows: four gradients (top/bottom/left/right, `reach` 0.21 of the short side for speaking, 0.30 thinking, colour = soul glow, base opacity .20/.19). The opacity breathes: speaking cycle 1700 ms, default 2600 ms, research 4200 ms; amplitude speaking +85%, thinking ±35%. Fade-in 120 ms, fade-out 450 ms (smoothstep).

## 7. Voice/typing surfaces
- **Held voice**: notch shrinks to 168x36 with 5 white bars; a **black pill** (`DictateStage_pill`) with blue level bars sits at the bottom centre while dictating; on completion it shows a check mark.
- **Captions**: spoken text appears in a frosted white bubble (`blur(18px) saturate(1.9)`, radius 20, "YOU" label) with the raw words blurred out and cleaned words fading in word by word (`delay .05 + .032*i`, `0.5 s`, `blur 7→0`, `y 7→0`, ease `(.22,1,.36,1)`); replies use a black 90% bubble. Height of the bubble is spring-animated (stiffness 190, damping 27, mass .9).
- **Key hints**: keycaps ("Ctrl + Win") appear above the action (`kbd` 26 px high, radius 8, inset `0 3px 0 #000`).
- **Lasso**: hold Ctrl+Shift, draw a freehand loop (glowing stroke), release, then ask; the cropped region goes to the model.
- **Schedule**: a toast confirms ("Scheduled: I will open Netflix today at 7:00 AM"), time lapses in the demo.

## 8. Loadout hub ("Shape your Hitodama")
Four cards (Soul, Personality, Voice, Abilities) orbit the soul at angles 140/40/-40/-140 degrees, each tethered by a 19-segment spring rope (stiffness 15, ~0.6 critical damping; ropes drawn with quadratic smoothing, a travelling spark every 3.2 s). Cards launch outward 0.18 s + 0.16 s apart and hit-test softly against the frame. Clicking a card opens a picker sheet (enter `opacity 0, y 14, scale .97 → 1` in 0.26 s `(.33,1,.68,1)`; exit 0.18 s). The product sells skins/voices with an in-app currency; **we will not copy the shop**, only the picker UI.
Voices (Gemini): Charon (default), Puck, Leda, Aoede, Enceladus, Algenib, Laomedeia, plus custom ones. Personalities are user-defined prompts ("True Chad" built in). Abilities: Collapse (void skin), Sidearm.

## 9. Sync notes
- Demo clock: scripted `ms` per step; the demo plays its timeline at 1.5x faster for non-speech steps (`ms/1.5`), speech steps keep real time.
- Hover/click on tabs: tab switch = 0.22 s menu→menu morph; content swaps inside the moving clip.
- Cursor moves 620 ms by default, click ring 300 ms.
- State changes always animate the shape and the soul with the same 0.55 s curve, so they land together.

## 10. Findings from the screen recordings (hitodama.mp4, hitodama-2.mp4, 30 fps)
Both recordings are the site's hero demo, the complete scripted tour. Frame-by-frame observations:
- **Opening**: sleep sliver (very thin) → scroll → the island drops and grows into the music island in about 0.3 s; the music content is already drawn inside while it opens.
- **View changes (music→controls, any tab→tab)**: the shape morphs first as an *empty black panel*; the old content is gone at once and the new content fades in (about 0.25 s) while the shape is still growing. Content never slides or scales.
- **Closing**: the content dims/fades while the panel shrinks upward back into the sliver (~0.4 s), ending in the sleep sliver.
- **Mascot**: the soul is a cute glowing water-drop character with a face (two dot eyes, tiny mouth, blush, two small round hands, a curled tip). It idles with a gentle bob and blinks. When *held* (voice) it shrinks to the left of a wider notch with white voice bars at the right; while *thinking* the bars become three pulsing dots; when finished a white check mark. While speaking it bounces and the mouth opens.
- **Keycap hints** ("Win + Alt", "Ctrl + Shift", "Scroll ↓") appear as black rounded chips over the screen while the matching action happens.
- **Captions**: "YOU ..." white bubble with the raw words blurred, then cleaned words fade in; replies in a black pill with a small "HITODAMA" label.
- **Wallpaper apply**: clicking the centre card starts a **circular reveal**: the new wallpaper grows as a circle from the click point until it covers the screen (~1.0 s, ease-out), the accent colour of every chip/pill then shifts to the new wallpaper's colour (0.8 s), and the Recent list reorders.
- **Controls tab** (this is the real content): row 1 = Wi-Fi (sub: network name), Bluetooth (On/Off), Audio (sub: output device); each tile has a divider and a chevron at its right that opens a picker; row 2 = Night Light and Dark mode (the latter accent-filled when on); then a volume pill ("64%"), then the media card ("Speakers" label, cover, bold title, round light play button, times). Accent-filled = on.
- **Today tab**: three columns: (clock: hour above minute with three dots, "AM · Tue 29"; weather "32°C Mostly clear") | (This week with range "Sep 28 – Oct 4"; "Next · 11:00 AM" row; focus timer ring "05:00" with "0 h" / "05 min" fields, presets 1m 5m 10m 15m 20m, Start/Reset) | ("Today" with a 0/1 ring, to-do rows, "+ Add a to-do..." with an accent arrow button).
- **Power**: four buttons only: Lock, Sleep, Restart, Shut down.
- **Accent** follows the current wallpaper (tan on the rice terraces, salmon on the autumn hills, blue on the lake).
