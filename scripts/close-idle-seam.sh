#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: npm run close:seam -- <fade|mci> <action.mp4> <idle.mp4> <output.mp4>" >&2
  exit 64
fi

seam_mode=$1
action_path=$2
idle_path=$3
output_path=$4

if [[ "$seam_mode" != "fade" && "$seam_mode" != "mci" ]]; then
  echo "Seam mode must be either fade or mci." >&2
  exit 64
fi

for input_path in "$action_path" "$idle_path"; do
  if [[ ! -f "$input_path" ]]; then
    echo "Input video does not exist: $input_path" >&2
    exit 66
  fi
done

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

action_fps=$("$ffprobe_bin" -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "$action_path")
action_frames=$("$ffprobe_bin" -v error -select_streams v:0 -show_entries stream=nb_frames -of default=noprint_wrappers=1:nokey=1 "$action_path")
idle_fps=$("$ffprobe_bin" -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=noprint_wrappers=1:nokey=1 "$idle_path")

if [[ "$action_fps" != "30/1" || "$action_frames" != "152" || ( "$idle_fps" != "30/1" && "$idle_fps" != "16/1" ) ]]; then
  echo "This seam template requires a 30fps, 152-frame action and a 16fps or 30fps idle video." >&2
  exit 65
fi

if [[ "$seam_mode" == "fade" ]]; then
  "$ffmpeg_bin" \
    -hide_banner \
    -n \
    -i "$action_path" \
    -i "$idle_path" \
    -filter_complex "[0:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS[action];[1:v]select='eq(n,0)',setpts=PTS-STARTPTS,fps=30,settb=AVTB,split=2[idle_seed][idle_end];[idle_seed]tpad=stop_mode=clone:stop_duration=5.2[idle];[action][idle]xfade=transition=fade:duration=0.3:offset=4.7,format=yuv420p[mixed];[mixed]fps=30,trim=start_frame=0:end_frame=151,settb=AVTB,setpts=PTS-STARTPTS[head];[idle_end]trim=start_frame=0:end_frame=1,settb=AVTB,setpts=PTS-STARTPTS[tail];[head][tail]concat=n=2:v=1:a=0,format=yuv420p[out]" \
    -map "[out]" \
    -frames:v 152 \
    -map_metadata -1 \
    -an \
    -c:v libx264 \
    -preset slow \
    -crf 10 \
    -profile:v high \
    -level:v 3.1 \
    -x264-params "zones=151,151,q=0" \
    -pix_fmt yuv420p \
    -r 30 \
    -video_track_timescale 15360 \
    -movflags +faststart \
    "$output_path"
else
  temp_parent=${TMPDIR:-/tmp}
  work_dir=$(mktemp -d "$temp_parent/pet-idle-seam.XXXXXX")

  cleanup() {
    if [[ -n "${work_dir:-}" && "$work_dir" == "$temp_parent/pet-idle-seam."* ]]; then
      rm -rf -- "$work_dir"
    fi
  }
  trap cleanup EXIT

  mkdir -p "$work_dir/endpoints" "$work_dir/input" "$work_dir/raw270" "$work_dir/transition10"

  "$ffmpeg_bin" -hide_banner -loglevel error -y -i "$action_path" -vf "select='eq(n,142)'" -frames:v 1 "$work_dir/endpoints/action_f142.png"
  "$ffmpeg_bin" -hide_banner -loglevel error -y -i "$idle_path" -vf "select='eq(n,0)'" -frames:v 1 "$work_dir/endpoints/idle_f0.png"

  cp "$work_dir/endpoints/action_f142.png" "$work_dir/input/01.png"
  cp "$work_dir/endpoints/idle_f0.png" "$work_dir/input/02.png"
  cp "$work_dir/endpoints/idle_f0.png" "$work_dir/input/03.png"
  cp "$work_dir/endpoints/idle_f0.png" "$work_dir/input/04.png"

  "$ffmpeg_bin" \
    -hide_banner \
    -loglevel error \
    -y \
    -framerate 10/3 \
    -start_number 1 \
    -i "$work_dir/input/%02d.png" \
    -vf "minterpolate=fps=270:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:me=umh:mb_size=8:search_param=64:vsbmc=1" \
    -frames:v 82 \
    "$work_dir/raw270/%03d.png"

  picked_frames=(001 004 011 022 035 048 061 072 079 082)
  for frame_index in "${!picked_frames[@]}"; do
    output_number=$(printf '%02d' "$((frame_index + 1))")
    cp "$work_dir/raw270/${picked_frames[$frame_index]}.png" "$work_dir/transition10/$output_number.png"
  done

  cp "$work_dir/endpoints/action_f142.png" "$work_dir/transition10/01.png"
  cp "$work_dir/endpoints/idle_f0.png" "$work_dir/transition10/10.png"

  "$ffmpeg_bin" \
    -hide_banner \
    -n \
    -i "$action_path" \
    -framerate 30 \
    -start_number 1 \
    -i "$work_dir/transition10/%02d.png" \
    -i "$idle_path" \
    -filter_complex "[0:v]trim=start_frame=0:end_frame=142,setpts=PTS-STARTPTS,fps=30,settb=AVTB[action];[1:v]trim=start_frame=0:end_frame=9,setpts=PTS-STARTPTS,fps=30,settb=AVTB[bridge];[2:v]select='eq(n,0)',setpts=PTS-STARTPTS,fps=30,settb=AVTB[idle_end];[action][bridge][idle_end]concat=n=3:v=1:a=0,format=yuv420p[out]" \
    -map "[out]" \
    -frames:v 152 \
    -map_metadata -1 \
    -an \
    -c:v libx264 \
    -preset slow \
    -crf 10 \
    -g 60 \
    -keyint_min 30 \
    -sc_threshold 0 \
    -x264-params "zones=151,151,q=0" \
    -r 30 \
    -movflags +faststart \
    "$output_path"
fi

"$ffprobe_bin" \
  -v error \
  -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_frames \
  -show_entries format=duration \
  -of default=noprint_wrappers=1 \
  "$output_path"
