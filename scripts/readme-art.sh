#!/usr/bin/env bash
# Regenerates the README art in assets/ from the app itself: fake demo data only (nothing from your PC), no real input,
# no focus changes. Needs: a built app (cd app && pnpm build), ffmpeg on PATH, python 3, bash (Git Bash is fine).
#   bash scripts/readme-art.sh [stills|gifs|spirit|voice|all]
# Animated demos (GIF/MP4) go to assets/demos/, which is git-ignored for now.
# "voice" shows brief click-through overlays on your screen while the scripted scenarios replay (no mic, no network).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/app"
OUT="$ROOT/assets"
TMP="${TMPDIR:-${TEMP:-/tmp}}/lokey-art"
mkdir -p "$OUT/screenshots" "$OUT/demos" "$TMP"
what="${1:-all}"

electron() { (cd "$APP" && npx electron . "$@" >/dev/null 2>&1); }
win() { cygpath -w "$1" 2>/dev/null || echo "$1"; }

# backdrops: a dark and a light "wallpaper"
dark_bg()  { ffmpeg -v error -y -f lavfi -i "gradients=s=${1}x${2}:c0=0x101a38:c1=0x4a2f7e:c2=0xe2648e:x0=0:y0=0:x1=$1:y1=$2:n=3:d=1" -frames:v 1 -update 1 "$3"; }
light_bg() { ffmpeg -v error -y -f lavfi -i "gradients=s=${1}x${2}:c0=0xcfe3ff:c1=0xe6d9ff:c2=0xffdbe6:x0=0:y0=0:x1=$1:y1=$2:n=3:d=1" -frames:v 1 -update 1 "$3"; }
probe() { ffprobe -v error -select_streams v -show_entries "stream=$1" -of csv=p=0 "$2"; }

# height of the island's opaque content in a capture (from its alpha channel)
content_h() { ffmpeg -v info -i "$1" -vf "alphaextract,format=gray,cropdetect=limit=30:round=2:skip=0" -frames:v 2 -f null - 2>&1 | grep -o 'y2:[0-9]*' | tail -1 | cut -d: -f2; }

shots() {
  rm -rf "$TMP/shots"
  electron --shots "$(win "$TMP/shots")"
}

stills() {
  [ -d "$TMP/shots" ] || shots
  local sample w h x
  sample="$(ls "$TMP/shots"/*.png | head -1)"
  w=$(probe width "$sample"); h=$(probe height "$sample")
  dark_bg "$w" "$h" "$TMP/bg-dark.png"; light_bg "$w" "$h" "$TMP/bg-light.png"
  x=$(( (w - 1040) / 2 ))
  for n in controls today stats clipboard apps wallpaper power music wifi bluetooth audio; do
    ch=$(( $(content_h "$TMP/shots/$n.png") + 64 ))
    ffmpeg -v error -y -i "$TMP/bg-dark.png" -i "$TMP/shots/$n.png" -filter_complex "[0][1]overlay=0:0,crop=1040:$ch:$x:0" -frames:v 1 -update 1 "$OUT/screenshots/$n.png"
  done
  for n in light-controls light-today light-clipboard light-apps; do
    ch=$(( $(content_h "$TMP/shots/$n.png") + 64 ))
    ffmpeg -v error -y -i "$TMP/bg-light.png" -i "$TMP/shots/$n.png" -filter_complex "[0][1]overlay=0:0,crop=1040:$ch:$x:0" -frames:v 1 -update 1 "$OUT/screenshots/$n.png"
  done
  for n in sleep awake; do
    ffmpeg -v error -y -i "$TMP/bg-dark.png" -i "$TMP/shots/$n.png" -filter_complex "[0][1]overlay=0:0,crop=520:150:$(( (w - 520) / 2 )):0" -frames:v 1 -update 1 "$OUT/screenshots/notch-$n.png"
  done
}

# <frames dir with frames.txt> <backdrop.png> <out.gif> <gif width> <gif fps>   (also writes an HD mp4 next to it)
gif_from() {
  local cropx; cropx=$(( ($(probe width "$2") - 1040) / 2 ))
  local base="[1][0]overlay=0:0:shortest=1,crop=1040:700:$cropx:0"
  ffmpeg -v error -y -f concat -safe 0 -i "$1/frames.txt" -loop 1 -i "$2" \
    -filter_complex "$base,fps=$5,scale=$4:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
    -loop 0 "$3"
  ffmpeg -v error -y -f concat -safe 0 -i "$1/frames.txt" -loop 1 -i "$2" \
    -filter_complex "$base,fps=30,scale=1040:-2:flags=lanczos,format=yuv420p" -c:v libx264 -crf 23 -preset slow -movflags +faststart "${3%.gif}.mp4"
}

gifs() {
  [ -d "$TMP/shots" ] || shots
  [ -f "$TMP/bg-dark.png" ] || stills
  gif_from "$TMP/shots/hero" "$TMP/bg-dark.png" "$OUT/demos/island-tour.gif" 760 12
  gif_from "$TMP/shots/theme" "$TMP/bg-dark.png" "$OUT/demos/theme-flip.gif" 640 12
}

spirit() {
  rm -rf "$TMP/lab-sheet" "$TMP/reel"
  electron --lab "$(win "$TMP/lab-sheet")"
  ffmpeg -v error -y -i "$TMP/lab-sheet/lab.png" -vf "scale=1200:-1:flags=lanczos" -frames:v 1 -update 1 "$OUT/spirit-poses.png"
  local list=""
  for sk in puff bloom sunny minty sky droplet; do
    rm -rf "$TMP/skin-$sk"
    electron --lab "$(win "$TMP/skin-$sk")" --lab-query "names=idle&size=260&cols=1&bg=none&at=0&skin=$sk"
    list="$list -i $TMP/skin-$sk/lab.png"
  done
  ffmpeg -v error -y $list -filter_complex "hstack=inputs=6" -frames:v 1 -update 1 "$OUT/skins.png"
  electron --lab "$(win "$TMP/reel")" --lab-page reel --lab-query "names=wave,jump,inhale,celebrate,think,shrug,sit,stand,belly,nod&size=300&cap=2.2"
  ffmpeg -v error -y -f lavfi -i "color=c=0x14161d:s=300x300:r=24" -framerate 24 -i "$TMP/reel/frames/%04d.png" \
    -filter_complex "[0][1]overlay=shortest=1,fps=16,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" -loop 0 "$OUT/demos/spirit.gif"
  ffmpeg -v error -y -f lavfi -i "color=c=0x14161d:s=300x300:r=24" -framerate 24 -i "$TMP/reel/frames/%04d.png" \
    -filter_complex "[0][1]overlay=shortest=1,scale=600:-2:flags=lanczos,format=yuv420p" -c:v libx264 -crf 22 -preset slow -movflags +faststart "$OUT/demos/spirit.mp4"
}

voice() {
  # demo:backdrop-kind:output name
  for spec in schedule:desk:voice-schedule dictation:chat:dictation lasso:list:circle-to-ask; do
    IFS=: read -r demo kind out <<< "$spec"
    rm -rf "$TMP/bd-$demo" "$TMP/rec-$demo"
    electron --lab "$(win "$TMP/bd-$demo")" --lab-page mock --lab-query "kind=$kind"
    electron --demo "$demo" --record "$(win "$TMP/rec-$demo")"
    python "$ROOT/scripts/art_layers.py" "$TMP/rec-$demo" "$TMP/bd-$demo/lab.png" "$OUT/demos/$out.gif" 760 10 "$OUT/demos/$out.mp4"
  done
}

case "$what" in
  stills) stills ;;
  gifs) gifs ;;
  spirit) spirit ;;
  voice) voice ;;
  all) shots; stills; gifs; spirit; voice ;;
  *) echo "usage: $0 [stills|gifs|spirit|voice|all]"; exit 1 ;;
esac
echo "art written to $OUT"
