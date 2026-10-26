# dsh-audio-alert

宿主侧的“卧室喇叭”提醒插件。跑在 dsh 宿主进程里，**浏览器关掉也照样响**。

## 它在什么时候响

| 事件 | 声音 |
| --- | --- |
| `turn/end` → `completed` | `sounds/done.wav`（柔和双音） |
| `turn/end` → `error` | `sounds/error.wav`（下行低音） |
| `turn/end` → `max-tokens` | `sounds/max-tokens.wav`（两声平调） |
| `turn/end` → `blocked` | `sounds/error.wav`（审批策略直接拒绝，`approval: never` 时最常见的失败） |
| `approval/request` | `sounds/approval.wav`（三连上行 pip），未处理时按 45s/90s/3m/5m… 重播 |

子代理会话的回合结束默认静音（`includeSubagents: false`），否则一个任务会响十几次。

## 配置

配置写在 profile 的 `cordis.patch.yml`（`~/.dsh/profiles/web/cordis.patch.yml`）里
`id: audio-alert` 这一行。可用字段：

```yaml
- id: audio-alert
  name: dsh-audio-alert
  config:
    enabled: true
    player: aplay                  # auto | pw-play | paplay | aplay
    device: plughw:CARD=PCH,DEV=0  # 只对 aplay 生效
    sink: ''                       # 只对 pw-play / paplay 生效
    volume: 0.8                    # 只对 pw-play / paplay 生效（aplay 无音量参数）
    quietHours: "23:30-08:00"      # 免打扰时段，留空关闭
    approvalBypassesQuiet: true    # 免打扰期间审批仍然响
    includeSubagents: false
    approvalDelaysMs: [45000, 90000, 180000, 300000]
    events: { done: true, error: true, maxTokens: true, blocked: true }
    sounds:
      done: sounds/done.wav
      error: sounds/error.wav
      maxTokens: sounds/max-tokens.wav
      approval: sounds/approval.wav
    verbose: false                 # true 时往宿主 stderr 打日志
```

改完 `sudo systemctl restart dsh-web` 生效。插件是 `link:` 安装的，
所以**改源码不需要重新 install**，重启即可。

## 为什么是 `aplay` 而不是 `pw-play`

这台机器没有图形会话，也就没有 user systemd / D-Bus 会话，PipeWire 客户端连不上
（`pw-play` 报 `can't connect`，ALSA 的 `default` 设备报 `Host is down`）。
只有直接指定硬件设备才能出声：`plughw:CARD=PCH,DEV=0`（ALC892 模拟输出，也就是 3.5mm）。
如果以后跑起了 WirePlumber，把 `player` 改回 `pw-play` + `sink` 即可。

## 自检

```bash
./test-alert.sh        # 依次播放四个声音
./test-alert.sh 80     # 先把 Master 调到 80% 再播
```

音量和通路：

```bash
amixer -c 1 sget Master                                  # 主音量 / 静音
amixer -c 1 contents | grep -A2 'Headphone Jack'         # 插头是否识别为 on
```

## 重新生成声音

```bash
python3 scripts/make-sounds.py
```

只依赖标准库，48 kHz / 16-bit / 立体声（右声道延后 11ms 制造宽度，另有两级低幅回声）。
峰值归一到 0.50，比早期版本轻约 5dB，配合系统音量 45% 使用。
