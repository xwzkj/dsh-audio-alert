#!/bin/bash
# 依次播放四个提示音，用来确认喇叭 / 音量 / 设备路径。
# 用法: ./test-alert.sh [音量百分比，可选]
set -euo pipefail

DEV="${ALSA_DEVICE:-plughw:CARD=PCH,DEV=0}"
VOL="${1:-}"

if [[ -n "$VOL" ]]; then
  amixer -c 1 sset Master "${VOL}%" unmute >/dev/null
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sounds"
for name in done error approval max-tokens; do
  echo "== $name ($DEV)"
  aplay -q -D "$DEV" "$DIR/$name.wav"
  sleep 0.4
done
echo "完成。如果什么都没听到: 确认喇叭插在 3.5mm 口、Master 没静音，"
echo "并检查 amixer -c 1 contents | grep -A2 'Headphone Jack' 是否为 on。"
