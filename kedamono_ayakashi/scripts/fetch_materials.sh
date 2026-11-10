#!/usr/bin/env bash
# Download the source materials (audio / cover / lrc) from the shared Google Drive folder:
# https://drive.google.com/drive/folders/1wg32shsOtUiH9RU9jeGxA1E3-MybtF-K
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p materials

dl() { # <drive file id> <output name>
  if [[ -s "materials/$2" ]]; then echo "skip  $2"; return; fi
  echo "fetch $2"
  curl -fSL --retry 4 -o "materials/$2" \
    "https://drive.usercontent.google.com/download?id=$1&export=download&confirm=t"
}

dl 1qVCLzOCe1jjCDUkwiMCdXabnU-fijT54 KEDAMONO_AYAKASHI_24bit_48kHz.wav
dl 1b748lrCsfkq8DeTdSqs49S-2Yqjbq32j KEDAMONO_AYAKASHI-Cover.jpg
dl 14qnDY5s38IBxKjk8_OGkVgMJdkzsxHsz KEDAMONO_AYAKASHI_v2.lrc
