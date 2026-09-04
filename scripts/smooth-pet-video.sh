#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: npm run smooth:video -- <input.mp4> <output.mp4>" >&2
  exit 64
fi

input_path=$1
output_path=$2

if [[ ! -f "$input_path" ]]; then
  echo "Input video does not exist: $input_path" >&2
  exit 66
fi

if [[ -e "$output_path" ]]; then
  echo "Refusing to overwrite an existing file: $output_path" >&2
  exit 73
fi

if [[ -n "${PET_FFMPEG_BIN:-}" ]]; then
  ffmpeg_bin=$PET_FFMPEG_BIN
elif command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg_bin=$(command -v ffmpeg)
else
  echo "ffmpeg was not found. Set PET_FFMPEG_BIN to its absolute path." >&2
  exit 69
fi

if [[ -n "${PET_FFPROBE_BIN:-}" ]]; then
  ffprobe_bin=$PET_FFPROBE_BIN
elif command -v ffprobe >/dev/null 2>&1; then
  ffprobe_bin=$(command -v ffprobe)
else
  echo "ffprobe was not found. Set PET_FFPROBE_BIN to its absolute path." >&2
  exit 69
fi

source_duration=$(
  "$ffprobe_bin" \
    -v error \
    -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 \
    "$input_path"
)

if [[ ! "$source_duration" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "Could not read a valid duration from: $input_path" >&2
  exit 65
fi

filter_chain="tpad=stop_mode=clone:stop_duration=0.125,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bilat:mb_size=8:vsbmc=1:scd=fdiff:scd_threshold=2.0,trim=duration=${source_duration},setpts=PTS-STARTPTS"

"$ffmpeg_bin" \
  -hide_banner \
  -n \
  -i "$input_path" \
  -vf "$filter_chain" \
  -map_metadata -1 \
  -an \
  -c:v libx264 \
  -preset medium \
  -crf 18 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  "$output_path"

echo "Created 30fps safety-interpolated video: $output_path"
