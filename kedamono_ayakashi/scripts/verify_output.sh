#!/usr/bin/env bash
# Sanity checks for a finished render:
#   - stream layout (video codec / size / fps, audio format)
#   - the audio track is bit-identical to the source WAV
#   - the whole video decodes without errors and has the expected frame count
#
#   ./scripts/verify_output.sh [output.mov]
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-output/KEDAMONO_AYAKASHI_lyric_video_4K60.mov}
WAV=materials/KEDAMONO_AYAKASHI_96kHz_PCM32.wav

echo "== streams"
ffprobe -v error -show_entries stream=index,codec_type,codec_name,codec_tag_string,profile,level,width,height,pix_fmt,r_frame_rate,sample_rate,sample_fmt,bits_per_raw_sample,channels:format=duration,size,bit_rate -of compact "$OUT"

echo "== audio bit-exactness (raw s32le sample hash)"
a=$(ffmpeg -v error -i "$WAV" -map 0:a -c:a pcm_s32le -f s32le - | md5sum | cut -d' ' -f1)
b=$(ffmpeg -v error -i "$OUT" -map 0:a -c:a pcm_s32le -f s32le - | md5sum | cut -d' ' -f1)
echo "source wav : $a"
echo "output mov : $b"
[[ "$a" == "$b" ]] && echo "audio: IDENTICAL" || { echo "audio: DIFFERENT" >&2; exit 1; }

echo "== full video decode (one pass: frame count + decoder errors)"
frames=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$OUT" 2>build/decode_errors.log)
errs=$(wc -l <build/decode_errors.log)
echo "decoded frames: $frames   decoder errors: $errs"
((errs == 0))
