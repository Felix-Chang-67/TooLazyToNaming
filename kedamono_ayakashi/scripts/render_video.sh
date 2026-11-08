#!/usr/bin/env bash
# Full pipeline: audio analysis -> parallel frame rendering (H.264 segments) -> concat ->
# mux with the ORIGINAL audio stream copied bit-for-bit (96 kHz / 32-bit PCM) into a .mov.
#
#   SCALE=2 JOBS=3 CRF=17 PRESET=medium FPS=60 ./scripts/render_video.sh
#   SCALE=1 renders 1920x1080, SCALE=2 renders 3840x2160 (native, not upscaled).
set -euo pipefail
cd "$(dirname "$0")/.."

SCALE=${SCALE:-2}
FPS=${FPS:-60}
JOBS=${JOBS:-3}
CRF=${CRF:-17}
PRESET=${PRESET:-medium}
THREADS=${THREADS:-2}
WAV=materials/KEDAMONO_AYAKASHI_96kHz_PCM32.wav
RES=$((1080 * SCALE))p
((SCALE == 2)) && RES=4K
OUT=${OUT:-output/KEDAMONO_AYAKASHI_lyric_video_${RES}${FPS}.mov}

mkdir -p build output
[[ -s build/analysis.json ]] || python3 -I src/analyze_audio.py "$WAV" build/analysis.json "$FPS"
TOTAL=$(python3 -I -c "import json,sys; print(json.load(open(sys.argv[1]))['frames'])" build/analysis.json)
CHUNK=$(((TOTAL + JOBS - 1) / JOBS))
echo "frames=$TOTAL scale=$SCALE jobs=$JOBS chunk=$CHUNK crf=$CRF preset=$PRESET -> $OUT"

pids=()
: >build/segments.txt
for ((j = 0; j < JOBS; j++)); do
  from=$((j * CHUNK))
  to=$(((j + 1) * CHUNK))
  ((to > TOTAL)) && to=$TOTAL
  echo "file 'seg_$j.mkv'" >>build/segments.txt
  node src/render.mjs --scale "$SCALE" --from "$from" --to "$to" --fps "$FPS" --crf "$CRF" --preset "$PRESET" \
    --threads "$THREADS" --out "build/seg_$j.mkv" >"build/seg_$j.log" 2>&1 &
  pids+=($!)
done
fail=0
for p in "${pids[@]}"; do wait "$p" || fail=1; done
if ((fail)); then
  echo "a render worker failed, see build/seg_*.log" >&2
  exit 1
fi

ffmpeg -y -loglevel error \
  -f concat -safe 0 -i build/segments.txt -i "$WAV" \
  -map 0:v:0 -map 1:a:0 -c:v copy -c:a copy \
  -metadata title="KEDAMONO_AYAKASHI (Lyric Video)" -metadata artist="ヒトリエ" \
  -movflags +faststart "$OUT"

ffprobe -v error -show_entries stream=index,codec_name,width,height,r_frame_rate,sample_rate,sample_fmt,bits_per_raw_sample,channels:format=duration,size,bit_rate -of default=nw=1 "$OUT"
