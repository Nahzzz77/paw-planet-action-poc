#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: npm run preview:feed -- <idle.mp4> <feed-action.mp4> <bowl.png> <output.mp4>" >&2
  exit 64
fi

idle_path=$1
action_path=$2
bowl_path=$3
output_path=$4

for input_path in "$idle_path" "$action_path" "$bowl_path"; do
  if [[ ! -f "$input_path" ]]; then
    echo "Input does not exist: $input_path" >&2
    exit 66
  fi
done

if [[ -e "$output_path" ]]; then
  echo "Refusing to overwrite an existing file: $output_path" >&2
  exit 73
fi

output_dir=$(dirname "$output_path")
if [[ ! -d "$output_dir" ]]; then
  echo "Output directory does not exist: $output_dir" >&2
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

probe_field() {
  local file_path=$1
  local field=$2
  "$ffprobe_bin" -v error -select_streams v:0 -show_entries "stream=$field" -of default=noprint_wrappers=1:nokey=1 "$file_path"
}

idle_fps=$(probe_field "$idle_path" r_frame_rate)
idle_frames=$(probe_field "$idle_path" nb_frames)
idle_size=$("$ffprobe_bin" -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$idle_path")
action_fps=$(probe_field "$action_path" r_frame_rate)
action_frames=$(probe_field "$action_path" nb_frames)
action_size=$("$ffprobe_bin" -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$action_path")
bowl_size=$("$ffprobe_bin" -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$bowl_path")
bowl_pix_fmt=$(probe_field "$bowl_path" pix_fmt)

if [[ "$idle_fps" != "30/1" || "$idle_frames" != "152" || "$idle_size" != "576x768" ]]; then
  echo "Idle must be 576x768, 30fps and 152 frames; got $idle_size, $idle_fps and $idle_frames frames." >&2
  exit 65
fi

if [[ "$action_fps" != "30/1" || "$action_frames" != "152" || "$action_size" != "576x768" ]]; then
  echo "Feed action must be 576x768, 30fps and 152 frames; got $action_size, $action_fps and $action_frames frames." >&2
  exit 65
fi

if [[ "$bowl_size" != "1000x240" || "$bowl_pix_fmt" != "rgba" ]]; then
  echo "Bowl asset must be 1000x240 RGBA; got $bowl_size $bowl_pix_fmt." >&2
  exit 65
fi

temp_parent=${TMPDIR:-/tmp}
work_dir=$(mktemp -d "$temp_parent/pet-feed-preview.XXXXXX")
temp_output="$work_dir/preview.mp4"

cleanup() {
  if [[ -n "${work_dir:-}" && "$work_dir" == "$temp_parent/pet-feed-preview."* ]]; then
    rm -rf -- "$work_dir"
  fi
}
trap cleanup EXIT

# This is a calibrated 576x768 POC compositor, not a generic mouth detector.
# Layer order is deliberate: full bowl/food -> masked tongue -> front food/rim.
# A feathered clean-neighbour patch removes the source pellet flash on frames 22-23.
# The tongue gate keeps only the two clean contact windows from this driver and
# prevents isolated pink fragments from being copied into the finished video.
"$ffmpeg_bin" \
  -hide_banner \
  -loglevel error \
  -n \
  -i "$idle_path" \
  -i "$action_path" \
  -loop 1 \
  -framerate 30 \
  -i "$bowl_path" \
  -filter_complex "[0:v]select='eq(n,0)',setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=0.7,fps=30,trim=duration=0.7[idle_pre];[1:v]fps=30,setpts=PTS-STARTPTS,split=3[actionraw][patchsrc][tonguesrc];[patchsrc]select='eq(n,21)',setpts=PTS-STARTPTS,crop=70:80:260:600,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='min(255,max(0,min(min(X,69-X),min(Y,79-Y))*42))',tpad=stop_mode=clone:stop_duration=5.1[cleanpatch];[actionraw][cleanpatch]overlay=x=260:y=600:enable='between(n,22,23)':eof_action=pass[action];[idle_pre][action]xfade=transition=fade:duration=0.166667:offset=0.533333,trim=duration=5.6,setpts=PTS-STARTPTS[cat_main];[0:v]select='eq(n,0)',setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=0.533333,fps=30,trim=duration=0.533333[idle_tail];[cat_main][idle_tail]concat=n=2:v=1:a=0,fps=30,trim=start_frame=0:end_frame=184,setpts=PTS-STARTPTS[cat];[2:v]format=rgba,geq=r='r(X,Y)*alpha(X,Y)/255+255*(255-alpha(X,Y))/255':g='g(X,Y)*alpha(X,Y)/255+255*(255-alpha(X,Y))/255':b='b(X,Y)*alpha(X,Y)/255+255*(255-alpha(X,Y))/255':a='alpha(X,Y)',scale=250:60:flags=lanczos,split=2[bowl][frontsrc];[cat][bowl]overlay=x=163:y='if(lte(t,0.533333),768-58*(3*pow(t/0.533333,2)-2*pow(t/0.533333,3)),if(lt(t,5.6),710,if(lt(t,6.1),710+58*(3*pow((t-5.6)/0.5,2)-2*pow((t-5.6)/0.5,3)),768)))':shortest=1[catbowl];[tonguesrc]crop=42:75:258:680,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if((between(N,57,61)+between(N,85,89))*gt(r(X,Y),g(X,Y)*1.35)*gt(r(X,Y),b(X,Y)*1.15)*gt(r(X,Y),100),min(255,max(0,(max(0,19-max(0,Y-16)*0.43)-abs(X-21))*180)),0)',setpts=PTS+0.533333/TB[tongue];[catbowl][tongue]overlay=x=258:y=680:eof_action=pass:repeatlast=0[tongued];[frontsrc]crop=250:30:0:30[front];[tongued][front]overlay=x=163:y='if(lte(t,0.533333),798-58*(3*pow(t/0.533333,2)-2*pow(t/0.533333,3)),if(lt(t,5.6),740,if(lt(t,6.1),740+58*(3*pow((t-5.6)/0.5,2)-2*pow((t-5.6)/0.5,3)),798)))':shortest=1,format=yuv420p[out]" \
  -map "[out]" \
  -frames:v 184 \
  -map_metadata -1 \
  -an \
  -c:v libx264 \
  -preset slow \
  -crf 10 \
  -profile:v high \
  -level:v 3.1 \
  -x264-params "zones=0,0,q=0/183,183,q=0" \
  -r 30 \
  -video_track_timescale 15360 \
  -movflags +faststart \
  "$temp_output"

output_fps=$(probe_field "$temp_output" r_frame_rate)
output_frames=$(probe_field "$temp_output" nb_frames)
output_size=$("$ffprobe_bin" -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$temp_output")

if [[ "$output_fps" != "30/1" || "$output_frames" != "184" || "$output_size" != "576x768" ]]; then
  echo "Preview validation failed: fps=$output_fps frames=$output_frames size=$output_size" >&2
  exit 70
fi

mv -- "$temp_output" "$output_path"

"$ffprobe_bin" \
  -v error \
  -select_streams v:0 \
  -show_entries stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_frames \
  -show_entries format=duration \
  -of default=noprint_wrappers=1 \
  "$output_path"
