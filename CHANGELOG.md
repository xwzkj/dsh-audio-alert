# Changelog

## 0.2.0 — 2026-10-26

首个公开版本。

- 发布资料：中英双语 README、npm `repository`/`homepage`/`bugs` 元数据、GitHub Actions、打包清单与 awesome-dsh-plugin 条目草稿
- 默认输出改为系统默认音频设备：`pw-play` → `paplay` → `aplay` 自动选择，不再需要配置声卡
- 播放器选择与参数拼装抽成纯函数（`pickPlayer` / `buildArgs` / `playerKind`），附 24 条单测（含打包清单与 WAV 合成）
- `sink` 可选；指定但不存在时回落默认设备，再回落 `aplay`
- 新增「提问 / 计划评审」提示音（`user-questions/request`），与审批共用退避重播
- 新增 `blocked`（被策略拒绝）提示音
- 夜间不再静音，改为按时段乘音量系数
- 声音改为立体声 + 泛音衰减的钟/木琴音色；改为运行时合成，不再打包 WAV
- 包体去掉 1.3MB 的 WAV，npm 包约 21KB
- 修复 `paplay` 指定 `sink` 时被跳过、且没有默认设备兜底的问题
- `enabled: false` 时不再注册审批/提问的等待监听
- 新增打包清单与声音合成测试（`dsh.bundle` patch、发布文件、WAV 头/时长/缓存）

## 0.1.0

内部版本：宿主侧提示音、审批重播、蓝牙优先、夜间降噪。
