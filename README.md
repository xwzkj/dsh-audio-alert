# dsh-audio-alert

宿主侧的提示音插件：跑在 dsh 宿主进程里，**浏览器关掉也照样响**。

它不是"推送"，而是本地发声——不需要联网、不需要机器人 token、不需要手机。适合"机器就在旁边、接了个音箱"的场景，比如把 dsh 放在家里的服务器上。

## 什么时候响

| 事件 | 声音 | 说明 |
| --- | --- | --- |
| 回合正常结束 | `done.wav` | 两个钟音上行，柔和不刺耳 |
| 回合出错 | `error.wav` | 两个低音下行 |
| 被策略拒绝（`blocked`） | `error.wav` | `approval: never` 时最常见的失败 |
| 触及输出上限 | `max-tokens.wav` | 两声同音，中性 |
| **等待审批** | `approval.wav` | 三记木琴上行，**没处理会重播** |
| **等待回答 / 计划评审** | `question.wav` | 两个音上行五度，同样重播 |

后两类是"阻塞等人"的事件：每 45s → 90s → 3m → 5m… 重播一次（最多 12 次），你一作答就停。子代理的回合默认不响，否则一个任务能响十几次。

## 安装

```bash
dsh plugin --profile web add dsh-audio-alert        # 发布到 npm 后
dsh plugin --profile web add link:/path/to/repo     # 本地开发
```

装完重启 `dsh-web` 生效：`sudo systemctl restart dsh-web`。

## 输出到哪个设备

**默认就是系统默认音频设备**，不需要配置：

- 有 PipeWire → `pw-play`，输出到当前默认 sink（你切到蓝牙音箱，提示音就跟过去）；
- 有 PulseAudio → `paplay`；
- 只有裸 ALSA → `aplay`，走 ALSA 的 `default`。

只有想固定到某个设备时才需要填 `sink`（PipeWire/Pulse 的 sink 名，或 `aplay` 的 `-D` 设备）：

```yaml
- id: audio-alert
  name: dsh-audio-alert
  config:
    sink: BDM3P                    # 可选：固定输出到这个 sink
    volume: 0.6                    # 0..1，pw-play/paplay 支持；aplay 忽略
    quietHours: "21:30-05:30"      # 降噪时段
    quietFactor: 0.6               # 时段内所有提示音 ×0.6
```

`aplay` 没有音量参数，此时 `volume` 不生效，请用 `amixer`/`alsamixer` 调系统音量。

## 全部配置项

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `player` | `auto` | `auto` / `pw-play` / `paplay` / `aplay`，也可写绝对路径 |
| `sink` | `''` | 指定输出 sink；空 = 系统默认 |
| `device` | `''` | 仅 `aplay`：ALSA 设备，如 `plughw:CARD=PCH,DEV=0` |
| `volume` | `0.6` | 0..1 线性音量（`aplay` 忽略） |
| `sounds` | 见上表 | 每个事件的声音文件 |
| `events` | 全 `true` | 单独关闭某类事件 |
| `approvalDelaysMs` | `[45s,90s,3m,5m…]` | 等待类提示音的重播间隔 |
| `includeSubagents` | `false` | 子代理回合结束是否也响 |
| `quietHours` | `''` | 降噪时段，如 `"21:30-05:30"`；空 = 不启用 |
| `quietFactor` | `0.6` | 时段内音量倍数 |
| `approvalBypassesQuiet` | `false` | 时段内审批/出错是否用正常音量 |
| `verbose` | `false` | 往宿主 stderr 打日志 |

## 排障

```bash
./test-alert.sh            # 依次播放全部声音
./test-alert.sh 80         # 先把 ALSA Master 调到 80% 再播（仅 aplay 机器）
```

没声音时按顺序查：

1. `which pw-play paplay aplay` —— 有没有可用的播放器；
2. 播放器能不能出声：`pw-play sounds/done.wav` / `aplay sounds/done.wav`；
3. 是不是静音/音量为 0：`wpctl status`（PipeWire）或 `alsamixer`（ALSA）；
4. `verbose: true` 后看宿主日志有没有 `[audio-alert] 播放 ...`。

headless 机器上常见坑：systemd 服务没有 `XDG_RUNTIME_DIR`，导致 `pw-play`/`paplay` 连不上声音服务。本插件会自动补 `/run/user/<uid>` 与 `DBUS_SESSION_BUS_ADDRESS`，但前提是该用户有会话（`loginctl enable-linger <user>`）。

## 开发

```bash
node --test          # 纯函数单测：时段判断、配置合并、参数拼装
python3 scripts/make-sounds.py   # 重新生成 WAV（stdlib，48kHz/16-bit/立体声）
```

声音设计在 `scripts/make-sounds.py` 顶部的 `bell / wood / soft_low` 里，改衰减长度、泛音比例即可，不需要重启——插件每次播放都重新读文件。

## License

MIT
