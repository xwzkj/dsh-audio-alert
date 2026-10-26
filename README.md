# dsh-audio-alert

中文 | [English](https://github.com/xwzkj/dsh-audio-alert/blob/main/README.en.md)

跑在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **宿主进程**里的 Linux 提示音插件。它不依赖浏览器：回合结束、出错，或者停下来等你审批/回答时，机器旁边的音箱会响。

它不是推送服务，也不联网：不需要机器人 token，不需要手机，不把任何内容发到外面。适合「机器就在旁边、接了个音箱」的场景，比如把 DSH 放在家里的服务器上。

五个提示音在第一次播放时由 `sounds.js` 用纯 JS 合成（48kHz/16-bit/立体声），包内不再带 1.3MB 的 WAV；npm 压缩包约 21KB。

[![test](https://github.com/xwzkj/dsh-audio-alert/actions/workflows/test.yml/badge.svg)](https://github.com/xwzkj/dsh-audio-alert/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/xwzkj/dsh-audio-alert/blob/main/LICENSE)

> **AIGC 声明。** 代码、声音合成、测试与文档由 AI 编码代理（DeepSeek Harness，模型 `deepseek-v4.1-flash`）在人类用户的需求与验收下完成。0.2.0 这一版在真实机器上做过验证：单元测试、真实事件触发、蓝牙与 ALSA 实际出声。人类负责决定取舍与是否发布，AI 不对正确性、稳定性或适用性作任何担保。请在使用前审阅代码——尤其是它会**在你的机器上启动音频播放器子进程**。

## 为什么放在宿主侧

| | 常见的浏览器侧提示音插件 | dsh-audio-alert |
| --- | --- | --- |
| 需要开着浏览器 | 是 | 否 |
| 只需要 DSH 宿主在跑 | 不够 | 是 |
| 无 GUI / 只走 SSH 的机器 | 不响 | 有音频会话就能响 |
| 配置方式 | 通常是设置面板 | profile 的 YAML patch |

取舍是刻意的：没有浏览器 UI、没有网络、没有额外服务，只有一个很小的宿主插件和一个 YAML 文件。

## 什么时候响

| 事件 | 声音 | 行为 |
| --- | --- | --- |
| 回合正常结束 | 两个上行的钟音 | 柔和，不刺耳 |
| 回合出错 | 两个下行的低音 | 出错时的默认提示 |
| 被策略拒绝（blocked） | 与出错同音 | 只受 `events.blocked` 控制 |
| 触及输出上限 | 两声同音，中性 | 与“完成”区分 |
| **等待审批** | 三记上行的木琴音 | 未处理会重播 |
| **等待回答 / 计划评审** | 两个上行的音 | 未处理会重播 |

两类等待事件先立即响一次，之后按 45 秒、90 秒、3 分钟、之后每 5 分钟重播，最多 12 次；你一处理就停。子代理的回合默认不响（`includeSubagents: true` 可以打开）；子代理发起的审批和提问始终不响，避免一个任务响十几次。

## 要求

- Linux，且至少有 `pw-play`（PipeWire）、`paplay`（PulseAudio）、`aplay`（ALSA）之一。
- Node.js 20 或更新版本。
- DSH 宿主必须跑在**有音频会话的用户**下。headless 的 systemd 服务通常还需要 `loginctl enable-linger <user>`；插件会在 `/run/user/<uid>` 存在、变量缺失时补上它和 D-Bus 地址，但它没法替你创建一个音频会话。

## 安装

```bash
# 发布到 npm 之后
dsh plugin --profile web add dsh-audio-alert

# 直接从 GitHub 装
dsh plugin --profile web add github:xwzkj/dsh-audio-alert

# 本地开发
dsh plugin --profile web add link:/path/to/dsh-audio-alert
```

`dsh plugin` 会在 profile 目录里调用 pnpm，并把包加进 `dsh.profile.bundles`。装完重启宿主进程，例如：

```bash
sudo systemctl restart dsh-web
```

服务名按你的部署方式而定。装完不需要额外配置：包自带的 `cordis.patch.yml` 已经插入了 `audio-alert` 这一行，默认值即可工作。

## 配置

配置写在 profile 的用户 patch 里，默认路径：

```text
~/.dsh/profiles/<profile>/cordis.patch.yml
```

如果设置了 `DSH_HOME`，则是 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`。追加一个同 `id` 的覆盖项：

```yaml
- id: audio-alert
  name: dsh-audio-alert
  config:
    volume: 0.6                  # 0..1 线性音量；aplay 会忽略
    quietHours: "21:30-05:30"    # 降噪时段，支持跨零点
    quietFactor: 0.6             # 时段内的音量倍数
    sink: BDM3P                  # 可选；换成 `wpctl status` / `pactl list short sinks` 里的名字
    verbose: true                # 可选：把播放决策打到宿主 stderr
```

`id: audio-alert` 必须保留，覆盖项靠它找到包插入的那一行。如果 patch 里已经有 `audio-alert`，把 `config` 合进去，不要再加一行。改完重启宿主。

### 全部配置项

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `player` | `'auto'` | `auto` / `pw-play` / `paplay` / `aplay`，也可写绝对路径 |
| `sink` | `''` | PipeWire/PulseAudio 的 sink 名；空 = 系统默认设备 |
| `device` | `''` | 仅 `aplay` 的 ALSA 设备，如 `plughw:CARD=PCH,DEV=0` |
| `volume` | `0.6` | 0..1 线性音量；`aplay` 没有音量参数，会忽略 |
| `sounds` | `{}` | 可选的自定义 WAV 覆盖；留空 = 运行时合成，相对路径按包根目录解析 |
| `events` | 全 `true` | 单独开关：`done`、`approval`、`question`、`error`、`maxTokens`、`blocked` |
| `approvalDelaysMs` | 45 秒、90 秒、3 分钟、之后 5 分钟 ×9 | 等待类提示音的重播间隔（毫秒），共 12 个 |
| `includeSubagents` | `false` | 子代理回合结束时是否也响 |
| `quietHours` | `''` | 降噪时段，如 `"21:30-05:30"`；空 = 不启用 |
| `quietFactor` | `0.6` | 降噪时段内的音量倍数 |
| `approvalBypassesQuiet` | `false` | 时段内审批、提问、出错、blocked 仍用正常音量；`done` 和 `maxTokens` 仍乘 `quietFactor` |
| `verbose` | `false` | 往宿主 stderr 打播放日志 |

`blocked` 用 `error` 的音型，但有自己的开关。只关 `events.blocked` 只会让「被策略拒绝」静音，不影响普通出错。

## 输出到哪个设备

默认就输出到系统默认音频设备，不需要配置。播放器按以下顺序自动选择：

1. `pw-play`（PipeWire）；
2. `paplay`（PulseAudio）；
3. `aplay`（裸 ALSA）。

不填 `sink` 时，声音跟着当前默认 sink 走；在 PipeWire/PulseAudio 上把桌面切到蓝牙音箱，下一次提示音就跟过去，不用重启。

- `sink` 在 PipeWire 上会匹配 `node.name`、`node.description`、`node.nick`（子串匹配）；在 PulseAudio 上作为 `paplay --device` 传入。
- 指定的 sink 不存在时，回落到系统默认设备；如果配了 `device`，再回落到 `aplay`。
- `device` 给 `aplay` 用，也作为 PipeWire/Pulse 播放失败后的最后兜底。
- `aplay` 没有音量参数。请用 `amixer` / `alsamixer` 调系统音量，这条路径上的 `volume` 不生效。

### Headless / systemd

systemd 服务通常没有 `XDG_RUNTIME_DIR` 和 `DBUS_SESSION_BUS_ADDRESS`，`pw-play`/`paplay` 会连不上声音服务。插件会在 `/run/user/<uid>` 存在、变量缺失时补上它和 `unix:path=/run/user/<uid>/bus`，但前提是该用户有会话：

```bash
loginctl enable-linger <user>
```

并且 DSH 要以这个用户运行。如果用 root 跑 DSH，它看到的是 root 的会话，通常没有音频；请以桌面用户运行宿主。容器里需要把 `/run/user/<uid>` 和 PipeWire/Pulse 的 socket 传进去，否则不会有声音。

## 排障

```bash
./test-alert.sh            # 生成到临时目录，用选中的播放器依次播放
./test-alert.sh 80         # 先把 ALSA Master 调到 80% 再播（仅 aplay 机器）
```

脚本已包含在 npm 包里。如果插件是作为依赖安装的，去包目录里跑，例如 `node_modules/dsh-audio-alert/test-alert.sh`。

没声音时按顺序查：

1. `which pw-play paplay aplay` —— 有没有可用的播放器；
2. 先生成一份 WAV 再手动播放：`node scripts/render-sounds.js /tmp/alerts`，然后 `pw-play /tmp/alerts/done.wav`（或 `paplay` / `aplay`）—— 播放器本身能不能出声；
3. `wpctl status`（PipeWire）、`pactl list short sinks`（PulseAudio）或 `alsamixer`（ALSA）—— 是不是静音或音量为 0；
4. 设 `verbose: true`，看宿主 stderr 里有没有 `[audio-alert]` 开头的日志；
5. sink 名不对时，用 `wpctl status` / `pactl list short sinks` 找，或从 `pw-dump` 里看 PipeWire 的 node 名；
6. headless 机器检查 `XDG_RUNTIME_DIR`、`DBUS_SESSION_BUS_ADDRESS` 和 `loginctl show-user <user> | grep Linger`。

如果 `pw-play` 在 shell 里能响、插件却不响，多半是宿主进程看到的环境不一样。对比 `systemctl show dsh-web -p Environment` 和你 shell 里的变量。

## 安全与隐私

- 不发起网络请求，没有遥测，没有远程服务。
- 会启动 `pw-play`、`paplay` 或 `aplay` 子进程；配置了 `sink` 且播放器是 `pw-play` 时还会运行 `pw-dump`。
- `player` 可以写绝对路径，也就是可以启动你指定的任意可执行文件。只指向你信任的播放器。
- 只读取合成逻辑或 `sounds` 里配置的自定义 WAV；首次播放会在 `$XDG_CACHE_HOME/dsh-audio-alert`（默认 `~/.cache/dsh-audio-alert`）写缓存文件，不读取会话消息或工作区文件。
- `verbose` 只记录事件键和播放器标签，不记录消息内容。
- 在意的机器上请先审阅代码；AIGC 声明见上。MIT 许可，除 Node 和系统播放器外没有运行时依赖。

## 开发

这些命令面向源码 checkout。npm 包里只带运行时文件（入口、`sounds.js`、渲染脚本和 `test-alert.sh`），不含测试。

```bash
node --test                                  # 24 条：时段、配置合并、argv、manifest、WAV 合成
node scripts/render-sounds.js /tmp/alerts    # 把五个提示音渲染成 WAV 试听
./test-alert.sh                              # 生成到临时目录并直接播放
npm run check:pack                           # 查看会发布哪些文件
```

声音设计在 `sounds.js` 的 `bell`、`wood`、`softLow` 里。合成结果缓存在 `$XDG_CACHE_HOME/dsh-audio-alert`（默认 `~/.cache/dsh-audio-alert`）；改完把 `SOUND_VERSION` 加一，或删掉缓存目录，再重启宿主。`test/manifest.test.js` 检查 `dsh.bundle` 清单和打包内容，`test/sounds.test.js` 检查 WAV 头、时长、确定性和缓存。

要收录到 awesome 列表，见 [docs/awesome-dsh-plugin.md](https://github.com/xwzkj/dsh-audio-alert/blob/main/docs/awesome-dsh-plugin.md)。

## License

MIT，见 [LICENSE](https://github.com/xwzkj/dsh-audio-alert/blob/main/LICENSE)。
