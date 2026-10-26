/**
 * dsh-audio-alert — 宿主侧的提示音插件（Linux）。
 *
 * 跑在 dsh 宿主进程里，浏览器关着也有效。监听：
 *  - `turn/end` → completed / error / blocked / max-tokens
 *  - `approval/request`  → 审批等待，未处理时按退避重播
 *  - `user-questions/request` → 提问 / 计划评审，同样重播
 *
 * 输出默认走系统默认音频设备（PipeWire / PulseAudio / ALSA 哪个在就用哪个），
 * 需要固定到某个 sink 时才填 `sink` / `device`。
 *
 * 零运行时依赖（只用 node: 内置模块），配置来自 profile 的 cordis patch。
 */

import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis 插件名。 */
export const name = 'audio-alert'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * 支持的播放器（按自动选择优先级排列）。都是 Linux 上常见的 CLI：
 * `pw-play` 走 PipeWire，`paplay` 走 PulseAudio，`aplay` 直连 ALSA。
 * `volume` / `sink` 是该播放器对应的参数拼装方式，`aplay` 不支持音量。
 */
export const PLAYER_SPECS = {
  'pw-play': {
    volume: (v) => ['--volume', String(v)],
    sink: (s) => ['--target', String(s)],
  },
  paplay: {
    volume: (v) => ['--volume', String(Math.round(v * 65536))],
    sink: (s) => ['--device', String(s)],
  },
  aplay: {
    volume: () => [],
    sink: (s) => ['-D', String(s)],
  },
}

/** 自动选择播放器时的顺序：优先接系统声音服务，最后才直连声卡。 */
export const PLAYER_ORDER = ['pw-play', 'paplay', 'aplay']

/** 默认配置。 */
export const DEFAULTS = {
  enabled: true,
  /** auto | pw-play | paplay | aplay（也可写绝对路径） */
  player: 'auto',
  /** 可选的输出 sink 名（pw-play/paplay）。留空 = 系统默认设备，推荐。 */
  sink: '',
  /** 可选的 ALSA 设备（仅 aplay 使用），如 `plughw:CARD=PCH,DEV=0`。留空 = default。 */
  device: '',
  /** 0..1 线性音量；aplay 不支持，会被忽略。 */
  volume: 0.6,
  /** 每个事件对应的声音文件；相对路径按插件目录解析。 */
  sounds: {
    done: 'sounds/done.wav',
    question: 'sounds/question.wav',
    error: 'sounds/error.wav',
    maxTokens: 'sounds/max-tokens.wav',
    approval: 'sounds/approval.wav',
  },
  /** 各事件是否发声。 */
  events: {
    done: true,
    approval: true,
    question: true,
    error: true,
    maxTokens: true,
    blocked: true,
  },
  /** 等待类提示音（审批/提问）的重播间隔（毫秒）；空数组 = 只响一次。 */
  approvalDelaysMs: [45_000, 90_000, 180_000, 300_000, 300_000, 300_000, 300_000, 300_000, 300_000, 300_000, 300_000, 300_000],
  /** 子代理会话的回合结束是否也响。 */
  includeSubagents: false,
  /** 降噪时段，如 "21:30-05:30"；留空 = 不启用。 */
  quietHours: '',
  /** 降噪时段内的音量倍数（不静音，只变轻）。 */
  quietFactor: 0.6,
  /** 降噪时段内审批/出错是否仍用正常音量。 */
  approvalBypassesQuiet: false,
  /** 往宿主 stderr 打日志（排查用）。 */
  verbose: false,
}

/**
 * 合并用户配置：`sounds` / `events` 做一层浅合并，其余整体覆盖。
 * 兼容旧键：`btSink` 是 `sink` 的别名。
 * @param {Record<string, unknown>} [raw] - profile patch 传入的 config。
 * @returns {typeof DEFAULTS}
 */
export function resolveConfig(raw) {
  const cfg = { ...DEFAULTS }
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'sounds' || key === 'events') {
        cfg[key] = { ...DEFAULTS[key], ...(value && typeof value === 'object' ? value : {}) }
      } else if (key === 'btSink') {
        if (!raw.sink && typeof value === 'string' && value !== '') cfg.sink = value
      } else if (value !== undefined && value !== null) {
        cfg[key] = value
      }
    }
  }
  return cfg
}

/**
 * 判断当前是否落在降噪时段内，支持跨零点。
 * @param {string} spec - "HH:MM-HH:MM"，空串表示不启用。
 * @param {Date} [now] - 用于测试的当前时间。
 * @returns {boolean}
 */
export function inQuietHours(spec, now = new Date()) {
  if (typeof spec !== 'string' || spec.trim() === '') return false
  const match = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(spec)
  if (!match) return false
  const [, fromH, fromM, toH, toM] = match.map(Number)
  const minutes = now.getHours() * 60 + now.getMinutes()
  const from = fromH * 60 + fromM
  const to = toH * 60 + toM
  if (from === to) return false
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to
}

/**
 * 在 PATH 里找一个可执行文件。
 * @param {string} bin - 可执行文件名或绝对路径。
 * @returns {string | undefined} 绝对路径。
 */
export function which(bin) {
  if (isAbsolute(bin)) {
    try {
      accessSync(bin, constants.X_OK)
      return bin
    } catch {
      return undefined
    }
  }
  const path = process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'
  for (const dir of path.split(':')) {
    if (!dir) continue
    const candidate = join(dir, bin)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // 继续找
    }
  }
  return undefined
}

/**
 * 选播放器：配置了具体名字就用它，`auto` 则按优先顺序挑第一个存在的。
 * @param {string} preferred - `auto` 或播放器名。
 * @param {(bin: string) => string | undefined} lookup - 依赖注入，便于测试。
 * @returns {string | undefined} 播放器名。
 */
export function pickPlayer(preferred, lookup = which) {
  if (preferred && preferred !== 'auto') {
    return lookup(preferred) ? preferred : undefined
  }
  return PLAYER_ORDER.find((id) => lookup(id))
}

/**
 * 把播放器标识归一成 `pw-play` / `paplay` / `aplay`（允许配绝对路径）。
 * @param {string} player - 播放器名或路径。
 * @returns {string} 归一后的名字。
 */
export function playerKind(player) {
  const name = String(player)
  if (PLAYER_SPECS[name]) return name
  const base = name.split('/').pop() ?? ''
  for (const kind of Object.keys(PLAYER_SPECS)) {
    if (base === kind || base.endsWith(kind)) return kind
  }
  return name
}

/**
 * 拼出某次播放的 argv。
 * @param {string} player - 播放器名。
 * @param {string} file - 声音文件绝对路径。
 * @param {{ volume?: number, sink?: string, device?: string }} [opts] - 输出参数。
 * @returns {string[]} argv。
 */
export function buildArgs(player, file, opts = {}) {
  const kind = playerKind(player)
  const spec = PLAYER_SPECS[kind]
  if (!spec) return [file]
  const args = []
  if (kind === 'aplay') {
    if (opts.device) args.push('-D', String(opts.device))
    args.push('-q')
  } else {
    if (opts.sink) args.push(...spec.sink(opts.sink))
    if (opts.volume !== undefined) args.push(...spec.volume(opts.volume))
  }
  args.push(file)
  return args
}

/**
 * 音频子进程的会话环境：headless 的 systemd 服务默认没有这两个变量。
 * @returns {NodeJS.ProcessEnv}
 */
function audioEnv() {
  const env = { ...process.env }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000
  const runtime = `/run/user/${uid}`
  if (!env.XDG_RUNTIME_DIR && existsSync(runtime)) env.XDG_RUNTIME_DIR = runtime
  if (!env.DBUS_SESSION_BUS_ADDRESS && env.XDG_RUNTIME_DIR) {
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`
  }
  return env
}

/**
 * 挂载插件。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {Record<string, unknown>} [rawConfig] - profile patch 的 config。
 */
export function apply(ctx, rawConfig) {
  const cfg = resolveConfig(rawConfig)
  const log = (...args) => {
    if (cfg.verbose || process.env.DSH_AUDIO_ALERT_DEBUG === '1') console.error('[audio-alert]', ...args)
  }

  const playerId = pickPlayer(cfg.player)
  if (!playerId) {
    console.error('[audio-alert] 找不到 pw-play / paplay / aplay，本机不会有提示音')
    return
  }
  const playerPath = which(playerId)
  log('播放器', playerId, cfg.sink ? `优先 sink: ${cfg.sink}` : '（系统默认设备）')

  const gain = () => (inQuietHours(cfg.quietHours) && !cfg.approvalBypassesQuiet ? Number(cfg.quietFactor) : 1)

  /** pw-dump 探测 sink 是否存在的缓存。 */
  let sinkCache = { at: 0, ok: false }

  /**
   * `pw-play --target` 对不存在的目标也返回 0，只能自己查节点列表。
   * @param {string} sink - sink 名（匹配 node.name / description / nick）。
   * @returns {boolean}
   */
  function sinkExists(sink) {
    const now = Date.now()
    if (now - sinkCache.at < 5_000) return sinkCache.ok
    let ok = false
    try {
      const res = spawnSync('pw-dump', [], { encoding: 'utf8', timeout: 1_500, env: audioEnv(), maxBuffer: 16 * 1024 * 1024 })
      if (res.status === 0 && typeof res.stdout === 'string') {
        const nodes = JSON.parse(res.stdout)
        ok =
          Array.isArray(nodes) &&
          nodes.some((node) => {
            const props = node?.info?.props
            if (!props || props['media.class'] !== 'Audio/Sink') return false
            return [props['node.description'], props['node.name'], props['node.nick']].some(
              (value) => typeof value === 'string' && value.includes(sink),
            )
          })
      }
    } catch (error) {
      log('查询 sink 失败', error instanceof Error ? error.message : String(error))
    }
    sinkCache = { at: now, ok }
    return ok
  }

  /**
   * 依次尝试的播放方案：指定 sink → 系统默认 → 直连 ALSA。
   * @param {string} file - 声音文件。
   * @param {number} volume - 0..1。
   * @returns {{ player: string, args: string[], label: string }[]}
   */
  function attemptsFor(file, volume) {
    const attempts = []
    const piped = playerKind(playerId) !== 'aplay'
    if (cfg.sink && piped && sinkExists(cfg.sink)) {
      attempts.push({ player: playerPath, args: buildArgs(playerId, file, { sink: cfg.sink, volume }), label: `sink ${cfg.sink}` })
    }
    if (!cfg.sink || !piped || attempts.length === 0) {
      attempts.push({ player: playerPath, args: buildArgs(playerId, file, { device: cfg.device, volume }), label: playerId })
    }
    if (piped && cfg.device) {
      const aplay = which('aplay')
      if (aplay) attempts.push({ player: aplay, args: buildArgs('aplay', file, { device: cfg.device }), label: 'aplay' })
    }
    return attempts
  }

  /**
   * 播放一个事件声音（fire-and-forget）。
   * @param {string} key - 声音键。
   * @param {number} [gainFactor] - 额外音量倍数。
   */
  function play(key, gainFactor = 1) {
    if (!cfg.enabled || !playerPath) return
    const volume = Math.max(0, Math.min(1, Number(cfg.volume) * gainFactor))
    const raw = cfg.sounds[key]
    if (typeof raw !== 'string' || raw === '') return
    const file = isAbsolute(raw) ? raw : join(HERE, raw)
    try {
      accessSync(file, constants.R_OK)
    } catch {
      console.error(`[audio-alert] 声音文件不存在: ${file}`)
      return
    }

    const attempts = attemptsFor(file, volume)
    let index = 0
    const attempt = () => {
      if (index >= attempts.length) return
      const target = attempts[index++]
      let settled = false
      const fail = (reason) => {
        if (settled) return
        settled = true
        if (index < attempts.length) log('回落', target.label, reason)
        else console.error(`[audio-alert] 播放失败(${target.label}): ${reason}`)
        attempt()
      }
      try {
        const child = spawn(target.player, target.args, { stdio: 'ignore', detached: true, env: audioEnv() })
        child.on('error', (error) => fail(error.message))
        child.on('close', (code) => {
          if (code !== 0) fail(`退出码 ${code}`)
          else {
            settled = true
            log('播放', key, '→', target.label)
          }
        })
        child.unref()
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error))
      }
    }
    attempt()
  }

  // ---- 回合结束 ---------------------------------------------------------
  ctx.on('session/event', (session, event) => {
    if (!cfg.enabled || !event || event.type !== 'turn/end') return
    if (!cfg.includeSubagents && session?.header?.origin === 'subagent') return

    const quietGain = inQuietHours(cfg.quietHours) ? Number(cfg.quietFactor) : 1
    const loudGain = inQuietHours(cfg.quietHours) && !cfg.approvalBypassesQuiet ? Number(cfg.quietFactor) : 1

    const kind = event.data?.reason?.kind
    if (kind === 'completed' && cfg.events.done) play('done', quietGain)
    else if (kind === 'error' && cfg.events.error) play('error', loudGain)
    else if (kind === 'blocked' && cfg.events.blocked) play('error', loudGain)
    else if (kind === 'max-tokens' && cfg.events.maxTokens) play('maxTokens', quietGain)
  })

  // ---- 等待用户：审批 / 提问 / 计划评审 -----------------------------------
  /**
   * 需要用户动手的提示音：响一次，未处理按退避重播，直到请求结束。
   * @param {string} soundKey - 声音键。
   * @returns {{ start: () => void, stop: () => void, dispose: () => void }}
   */
  function createAttentionTone(soundKey) {
    let pending = 0
    let timer
    let repeatIndex = 0

    const stopTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }

    const schedule = () => {
      const delays = Array.isArray(cfg.approvalDelaysMs) ? cfg.approvalDelaysMs : []
      if (repeatIndex >= delays.length) return
      const delay = Number(delays[repeatIndex++])
      if (!Number.isFinite(delay) || delay <= 0) return
      timer = setTimeout(() => {
        timer = undefined
        if (pending <= 0) return
        play(soundKey, gain())
        schedule()
      }, delay)
      if (typeof timer.unref === 'function') timer.unref()
    }

    return {
      start() {
        pending += 1
        if (pending > 1) return
        repeatIndex = 0
        play(soundKey, gain())
        schedule()
      },
      stop() {
        pending -= 1
        if (pending > 0) return
        pending = 0
        repeatIndex = 0
        stopTimer()
      },
      dispose() {
        stopTimer()
        pending = 0
      },
    }
  }

  const tones = {
    approval: createAttentionTone('approval'),
    question: createAttentionTone('question'),
  }

  /**
   * 挂一个阻塞等待用户的瀑布事件。
   * @param {string} event - 事件名。
   * @param {'approval' | 'question'} key - 对应提示音。
   */
  function waitForUser(event, key) {
    if (cfg.events[key] === false) return
    ctx.on(event, async (request, next) => {
      if (request?.agent?.session?.header?.origin === 'subagent') return next()
      tones[key].start()
      try {
        return await next()
      } finally {
        tones[key].stop()
      }
    })
  }

  waitForUser('approval/request', 'approval')
  waitForUser('user-questions/request', 'question')

  ctx.effect(() => () => {
    for (const tone of Object.values(tones)) tone.dispose()
  })
}
