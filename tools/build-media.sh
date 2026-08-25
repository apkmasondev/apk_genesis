#!/usr/bin/env bash
# Rebuilds the shipped delivery media from the local source masters.
#
# The three generated source clips are archival and stay out of Git; this script
# bakes them into a single continuous master (crossfades are rendered into the
# pixels instead of being cross-dissolved by three live <video> elements) and
# then emits the two renditions the site actually downloads.
#
#   genesis-wide.mp4  16:9, used by desktop, tablets and landscape phones
#   genesis-tall.mp4  9:15 centre crop, used by portrait phones where the wide
#                     rendition would have been ~74% cropped away by object-fit
#
# The output frame rates below are load-bearing: src/main.ts snaps every seek to
# a frame boundary using RENDITIONS[].frameStep, which must stay 1/fps for each
# rendition. Change one and change the other.
#
# Both are silent H.264 High yuv420p with an eight-frame keyframe interval, so a
# scrub seek never has to decode more than eight frames, and +faststart so the
# moov atom is readable before the media finishes downloading.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC_1=${SRC_1:-Light_forms_digital_AI_core_202608082145.mp4}
SRC_2=${SRC_2:-AI_core_evolving_and_transforming_202608082150.mp4}
SRC_3=${SRC_3:-AI_core_final_form_animation_202608082151.mp4}
SRC_AUDIO=${SRC_AUDIO:-APK_Genesis.mp3}
OUT=public/media
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

FADE=0.6            # seconds of baked crossfade between clips
CLIP=10             # seconds per source clip
FADE_1=$(awk "BEGIN{printf \"%g\", $CLIP - $FADE}")
FADE_2=$(awk "BEGIN{printf \"%g\", 2 * $CLIP - 2 * $FADE}")

for f in "$SRC_1" "$SRC_2" "$SRC_3" "$SRC_AUDIO"; do
  [ -f "$f" ] || { echo "missing source master: $f" >&2; exit 1; }
done

echo "  baking continuous master"
ffmpeg -y -v error \
  -i "$SRC_1" -i "$SRC_2" -i "$SRC_3" \
  -filter_complex "\
    [0:v][1:v]xfade=transition=fade:duration=$FADE:offset=$FADE_1[a];\
    [a][2:v]xfade=transition=fade:duration=$FADE:offset=$FADE_2,format=yuv420p[v]" \
  -map "[v]" -c:v libx264 -preset veryfast -crf 12 -g 24 -an "$WORK/master.mp4"

encode() {
  local out=$1 filters=$2 fps=$3 crf=$4
  echo "  encoding $out"
  ffmpeg -y -v error -i "$WORK/master.mp4" \
    -vf "fps=$fps,$filters" \
    -c:v libx264 -preset veryslow -crf "$crf" \
    -g 8 -keyint_min 8 -sc_threshold 0 -bf 2 -refs 3 \
    -profile:v high -level 4.0 -pix_fmt yuv420p \
    -movflags +faststart -an "$OUT/$out"
}

encode genesis-wide.mp4 "scale=1280:720:flags=lanczos" 20 29
encode genesis-tall.mp4 "crop=432:720:424:0,scale=432:720:flags=lanczos" 16 28

echo "  soundtrack"
# Lazily fetched and mixed in at 28% under the scene, so it is encoded for size.
# -vn drops the MP3's embedded cover art, which the ipod muxer will not carry.
ffmpeg -y -v error -i "$SRC_AUDIO" -vn   -c:a aac -b:a 80k -cutoff 16000 -ar 44100 -ac 2   -movflags +faststart public/audio/genesis-theme.m4a

echo "  stills"
# First frame doubles as the LCP placeholder, so it is deliberately tiny.
ffmpeg -y -v error -i "$WORK/master.mp4" -frames:v 1 \
  -vf "scale=640:360:flags=lanczos" -q:v 58 "$OUT/genesis-first-frame.webp"
# Reduced-motion poster shows the resolved identity rather than the empty start.
ffmpeg -y -v error -ss 24 -i "$WORK/master.mp4" -frames:v 1 \
  -vf "scale=1280:720:flags=lanczos" -q:v 72 "$OUT/genesis-poster.webp"

ls -la "$OUT"
