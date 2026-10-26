#!/bin/bash
# 依次播放所有提示音，用来确认播放器 / 设备 / 音量。
#   ./test-alert.sh          用系统默认设备
#   ./test-alert.sh 80       先把 ALSA Master 调到 80%（仅 aplay）
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VOL="${1:-}"
TMP="$(mktemp -d)" || exit 1
trap 'rm -rf "$TMP"' EXIT

if ! command -v node >/dev/null 2>&1; then
  echo "找不到 node，无法生成提示音" >&2
  exit 1
fi

# headless / SSH 环境下没有这两个变量，pw-play 会连不上声音服务
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

if command -v pw-play >/dev/null 2>&1; then
  PLAYER=(pw-play)
elif command -v paplay >/dev/null 2>&1; then
  PLAYER=(paplay)
elif command -v aplay >/dev/null 2>&1; then
  PLAYER=(aplay -q)
else
  echo "找不到 pw-play / paplay / aplay" >&2
  exit 1
fi

if [[ -n "$VOL" ]] && command -v amixer >/dev/null 2>&1; then
  amixer sset Master "${VOL}%" unmute >/dev/null 2>&1 || true
fi

if ! node "$DIR/scripts/render-sounds.js" "$TMP" >/dev/null; then
  echo "生成提示音失败" >&2
  exit 1
fi

for name in done question error approval max-tokens; do
  echo "== $name"
  "${PLAYER[@]}" "$TMP/$name.wav"
  sleep 0.5
done

echo "播放器: ${PLAYER[*]}"
echo "没声音就查: 系统音量、默认 sink（wpctl status）、以及 verbose: true 的宿主日志。"
