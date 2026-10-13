# Island menu: exact layout (design pixels)

Extracted from the reference's own component code, so every number below is what the reference draws. Each view is laid out at its design size `W x H` (see `island/shapes.ts` MENU_SIZE) inside a box that is then scaled by `0.9 * k`. All positions are absolute within their parent, in design px. Text colours: `T = #F4F5F8`, `M = #8A92A3` (muted), `S = #A3AAB8` (soft). Fills are white at the given alpha over the panel. `C = cubic-bezier(.33,1,.68,1)`.

## Frame
- **Panel tint**: panel fill = accent colour x 0.078 per channel (autumn accent `#FF8E5F` gives `#140906`, tan `#CEAD60` gives `#0F0D08`, blue `#64BCF0` gives `#080E12`).
- **Palette per wallpaper** (accent / ink on accent / chest (GPU ring) / done (green) / ember): `#FF8E5F / #3A1000 / #DC9CFF / #98CE58 / #F0D03C`; `#CEAD60 / #2A1D00 / #D3A6ED / #A3C97D / #FFBFB1`; `#64BCF0 / #002235 / #C2ABFA / #8ACE8E / #EACF77`; `#8AAFFF / #0C1C44 / #C3AAFF / #81D187 / #EECF65`; `#FD8E6E / #3D0B00 / #DA9EFB / #9CCD66 / #F3CD55`. Colour changes animate `.8s ease`.
- **Tab bar**: top 15; left `18 + (W - 36 - 552)/2`; tabs 28 high, radius 14, font 13/500, gap 6, widths Controls 83, Today 64, Stats 60, Clipboard 90, Apps 58, Wallpaper 94, Power 67. Inactive colour `#8C8791`; active text accent on `accent 16%`.
- **Page** (the view body): left 18, top 56, width `W-36`, height `H-56-18`.
- **Open motion (menu views)**: the whole content scales `0.59375 -> 1` from the top centre (0.38 s, C) while fading in (0.23 s, delay 0.057 s); the page body also slides `y: -18 -> 0` and fades (0.22 s, C). Exit is instant (0 s). **Music island**: scale `0.4697 (=178.5/380) -> 1`, 0.42 s C, opacity 0.3 s delay 0.05 s.
- Hover/transition tokens: tiles colour `.18s cubic-bezier(.33,1,.68,1)`; power buttons `.063 -> .118` in `.1s linear`; to-do rows `.047 -> .086`; volume fill animates 0.9 s `(.45,0,.2,1)`; dial rings 0.6 s C.

## Music island (380 x 150), content box at (18,24) size 344 x 118
cover (0,0) 46x46 r10 gradient; title (58,3) w286 h20 14/500 ellipsis; artist (58,24) h18 12 M; time left (0,54) w36 h16 10px M; time right right:0 right-aligned; progress bar (40,60.5) 264x3 r1.5 bg .118 fill T; icons (no circles): previous 18px at (107,89), play/pause 24px at (160,86), next 18px at (219,89), colour T.

## Controls (640 x 390), page 604 x 316
- Tiles (height 58, r16, bg .078; on = accent): row 1 width `a = 584/3 = 194.67` at x = 0, a+10, 2(a+10), y 0: Wi-Fi (sub = network), Bluetooth, Audio (sub = device). Row 2, y 68: Night Light x 0 w 297; Dark mode x 307 w 297 (no chevron).
- Tile internals: icon disc (12,12) 34x34 r17 bg .07 (on: ink 14%), icon 16px; title left 56 top 11 h19 13/500, right = chevron ? 42 : 18; sub left 56 top 30 h16 11 M (on: ink 62%); divider right 36 top 12 w1 h34 bg rgba(244,245,248,.18) (on: ink 18%); chevron icon 12px at right 18 top 23. Title on-state colour = ink.
- Volume slider (0,136) 604x38 r19 bg .063; fill accent (min width 50); speaker icon 16px at (16,11) colour ink; value right 16, 12/500.
- Media card (0,184) 604x132 r18 bg .063: speaker glyph 11px at (16,13); device label left 32 top 8 h20 11 M; cover (16,34) 52x52 r10; title (80,34) w378 h30 20/500 ellipsis; "by" (80,64) 12 M; prev disc 30px at (470,44) bg .102 icon 14; play disc 44px at (510,37) bg `#EDE3C8` icon 18 `#1A1714`; next disc at (564,44); time left (16,102) w40 10px M; time right left 548 right-aligned; bar (58,108.5) 488x3 bg .102 fill accent.

## Today (880 x 442), page 844 x 368
- Clock card (0,0) 176x214 r20 bg .063: "09" top 25, "41" top 109 (46px/500, centred, line-height 56); 3 dots 7px accent at left `88 + e - 3.5`, e in {-13, 0, 13}, top 94.5, the middle dot toggles opacity 1/.55 every 1 s; caption "AM · Tue 29" bottom 14, 13px M, centred.
- Weather card (0,226) 176x142: sun icon 36px at (70,16) `#F2C94C`; temperature top 56, 28/500 centred; condition line top 94, 12 M, centred (left/right 8).
- Week card (188,0) 354x182: title "This week" (16,12) 14/500; range right 16 top 12, 12 M; day labels left `12 + t*47.14`, width 47.14, top 42, 11 M, centred; date cells left `12 + t*47.14 + 3`, width 41.14, top 62, h38, r10, 13px (today = accent fill, ink, 500); Next row (12,112) 330x58 r14 bg .055: bar (12,13) 5x32 r2.5 `#F28BB6`, head "Next · 11:00 AM" (28,9) 13/500, body (28,29) 12 M.
- Timer card (188,194) 354x174: ring svg 84px at (20,45), r39.5, stroke 5, track .102, progress `#F5A524`, rotated -90; time (20,45) 84x84 17/500 centred; time boxes top 16, 103x36, r10, bg .055 at left 126 and 237 (value right 40, 16/500; unit left 67, 11 M); presets top 62, 38x28 r14 11/500 at left 126 + 44t ("1m 5m 10m 15m 20m"; inactive `#A3AAB8` on .047, active `#F5A524` on `rgba(245,165,36,.2)`); Start (126,100) 103x36 r11 `#F5A524`, text `#2A1800`; Reset (237,100) 103x36 r11 bg .07; both 13/500.
- To-do card (554,0) 290x368: title (16,12) 14/500; count ring (244,11) 30px bg .086 circle with inner 20px disc `rgb(7,9,13)` at (5,5), green arc `#8ED92F` stroke 4 r13, text 9px/500 `#C1EA86`; rows at (12,52) 266x40 r12 bg .047 (hover .086), check 18px at (11,11), title left 38 13px (done: M + line-through); add field (12,312) 266x44 r12 border 1.2 dashed rgba(255,255,255,.157): plus 16px at (12,14), text left 38 13 M, button (227,6) 30x30 r9 accent with enter icon 14 ink.

## Stats (880 x 338), page 844 x 264
- Dial cards at x = 194*t (t = 0,1,2), top 0, 184x196, r20, bg .063: ring svg 92 at (46,14), r42, stroke 8, track .086, round caps, rotated -90; value (46,14) 92x92 17px centred; label top 114 14/500 centred; sub top 134 11 M ellipsis (left/right 8); chips top 162 centred gap 6, each h22 padding 0 8 r7 11px `#C8CFDB` bg .07. Colours: CPU accent, GPU chest, RAM done.
- Facts at (194*t, 206) 184x58 r16 bg .063: label (12,8) 11 M; value (12,26) 15 (pre-wrap).
- Top apps card (582,0) 262x136: "Top apps · RAM" (14,10) 12 M; "CPU ⇄" right 14 top 10 12 accent; row i: l = 34 + 24 i; letter tile (14,l) 22x22 r6 bg .118 11px; name (44,l-2) w148 h16 12; amount left 184 w64 right-aligned 11 M; bar (44,l+16) w204 h4 r2 bg .086, fill `#8ED92F` width = max(4%, fraction).
- Speed card (582,146) 262x118: "Internet speed" (14,10) 12 M; right 14 "last: 5 min ago · Mumbai"; numbers at left 14 and 122, top 32, 26/500 with unit span (margin-left 6, 11 M) "Mbps ↓" / "Mbps ↑"; button (14,70) 234x34 r12 accent, ink, 12/500 "▶  Run speed test".

## Clipboard (880 x 446), page 844 x 372
- Search (0,0) 844x42 r14 bg .063: magnifier 18px (15,12) M; placeholder left 42 14px M; chips right 44 top 7 gap 4 (h28, padding 0 12, r14, 12/500, `#A3AAB8`; active = accent bg + ink): All, Text, Images, Links; gear 16px at (814,13) S.
- List (0,52) 372x280, overflow hidden: header top `e+4` left 10 h22 11/500 uppercase M, then e += 26; row top `e+1` left 0 w366 h36 r10 (selected: accent 20%), then e += 38; type tile (8,5) 26x26 r7 bg .07 (selected accent 28%) with 16px icon; title left 44 right 52 13px `#D3D9E3` (selected T) ellipsis; stamp right 8 11 M.
- Preview (384,52) 460x280 r18 bg .063: body (18,16) w424 14/1.5 `#E3E8F0`; rule (18,198) 424x1 bg .086; meta rows top `208 + 20 t`: label left 18 12 M, value left 92 12 `#D3D9E3` (Type, Size, Copied).
- Key bar (0,342) 844x30 flex gap 12 padding-left 4 12px S: kbd chips (h20, padding 0 7, margin-right 6, r6, bg .094, 11/500) "↵ Paste", "Ctrl C Copy", "Ctrl P Pin", "Del Remove"; right-aligned muted "↑↓ Move  ·  Ctrl/Shift pick several  ·  Tab Filter".

## Apps (720 x 638), page 684 x 564
- Search (0,0) 684x46 r14 bg .063: magnifier svg 30px at (7,7); placeholder left 40 17px M; hint right 12 11 M ("Win+A").
- **Recent-search chips** (top 56, h32, r16, padding-left 32, 12/500, bg .063): width `7*len + 44`, x accumulates +8; a 20px dot at (6,6) bg accent 35% with a small accent bolt/arrow icon. (They are previous search terms, not category filters.)
- List starts at e = 96: section header top `e+4` left 10 h20 11/500 uppercase M, e += 24; row top e, height 42, e += 42. Selected (first) row: inset highlight left/right 0 top/bottom 2 r12 accent 18%. Tile (10,7) 28x28 r8 bg .102 letter 13/500; name left 50 14px `#D3D9E3` (selected T); tail left 544 w92 right-aligned 11 M ("↵ Open" on the selected row); star 28px at (644,7), filled accent when starred, outline M when only selected. Sections Starred, Recent, Applications.

## Wallpaper (1040 x 314), page 1004 x 240
- Pills top 3: Recent left 0, My folder left 78 (h28, padding 0 14, r14, 12/500; inactive `#A3AAB8` on .055; active accent + ink); count left 172 top 0 line-height 34, 11 M ("N pictures"); folder button (974,2) 30px r15 bg .063 icon 15 S.
- Track (0,44) 1004x196. For card index `i`, signed circular distance `p` from the centre, `ad = |p|`, `d = smoothstep(min(ad,1))`: width `330 - 264 d`; height `186 - 14 d`; offset `t = 211.47 d + 78 max(0, ad - 1)` (negative for p < 0); left `502 + t - width/2`; top `4 + (186 - height)/2`; opacity `1 - .22 min(ad,1) - .11 max(0, ad - 1)`; black dim overlay opacity `.275` when ad > .5; z-index `10 - round(2 ad)`. Card: r12, overflow hidden, `skewX(-11.86deg)`, inner ring `inset 0 0 0 1px rgba(255,255,255,.118)` (applying: 2.2px accent); image inset `-12px -30px`, cover, counter-skew `skewX(11.86deg)`. Centre moves in 0.26 s C.

## Power (640 x 166), page 604 x 92
Four buttons (Lock, Sleep, Restart, Shut down): width `e = (604 - 30)/4 = 143.5`, left `r (e + 10)`, top 0, height 92, r20, bg .063 (hover .118, 0.1 s linear); icon 22px at (e/2 - 11, 20) T; label top 52 h22 13/500 centred.
