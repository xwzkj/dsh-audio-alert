/**
 * dsh-audio-alert — 宿主侧的“卧室喇叭”提醒。
 *
 * 关掉浏览器也有效：本插件跑在 dsh 宿主进程里，监听会话事件流和审批瀑布，
 * 用本机声卡播一段短提示音。
 *
 *  - `turn/end` → `completed`        → sounds/done.wav
 *  - `turn/end` → `error`            → sounds/error.wav
 *  - `turn/end` → `max-tokens`       → sounds/max-tokens.wav
 *  - `approval/request`              → sounds/approval.wav，并在未处理时按退避重播
 *
 * 零运行时依赖（只用 node: 内置模块），配置全部来自 profile 的 cordis patch。
 */

import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis 插件名，用于 loader 诊断与 `--dump-config` 里的 id。 */
export const name = 'audio-alert'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 默认与用户配置合并后的运行时设置。 */
const DEFAULTS = {
  enabled: true,
  /** auto | pw-play | paplay | aplay；这台机器没有会话管理器，直连 ALSA 最稳。 */
  player: 'aplay',
  /** aplay 的输出设备；/run/user/<uid> 下没有 PipeWire/WirePlumber 时必须显式指定。 */
  device: 'plughw:CARD=PCH,DEV=0',
  /** pw-play / paplay 的目标 sink（留空 = 默认 sink）。 */
  sink: '',
  /** 蓝牙优先：填 PipeWire sink 名（如 BDM3P），播放时先走它，失败回落 aplay。空串 = 关闭。 */
  btSink: '',
  /** 0..1，线性音量；aplay 不支持音量参数，会被忽略。 */
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
    /** 审批等待音。 */
    approval: true,
    /** 提问 / 计划评审等待音。 */
    question: true,
    error: true,
    maxTokens: true,
    /** 被审批策略拒绝（approval: never 时的常见失败）也算一次“任务没跑完”。 */
    blocked: true,
  },
  /** 待审批提示的重播间隔（毫秒）；空数组 = 只响一次。 */
  approvalDelaysMs: [45000, 90000, 180000, 300000, 300000, 300000, 300000, 300000, 300000, 300000, 300000, 300000],
  /** 子代理会话的回合结束是否也响（默认不响，避免一个任务响十次）。 */
  includeSubagents: false,
  /** 夜间时段，如 "21:30-05:30"；留空 = 不启用。 */
  quietHours: '',
  /** 夜间时段内的音量倍数（不再静音，只是变轻）。 */
  quietFactor: 0.4,
  /** 夜间时段内出错 / 审批是否仍用正常音量（默认是：那是需要你处理的事）。 */
  approvalBypassesQuiet: true,
  /** 往宿主 stderr 打一行日志（排查用）。 */
  verbose: false,
}

/**
 * 合并用户配置，嵌套对象做一层浅合并。
 * @param {Record<string, unknown>} [raw] - profile patch 里传入的 config。
 * @returns {typeof DEFAULTS}
 */
function resolveConfig(raw) {
  const cfg = { ...DEFAULTS }
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'sounds' || key === 'events') {
        cfg[key] = { ...DEFAULTS[key], ...(value && typeof value === 'object' ? value : {}) }
      } else if (value !== undefined && value !== null) {
        cfg[key] = value
      }
    }
  }
  return cfg
}

/**
 * 在 PATH 里找一个可执行文件。
 * @param {string} bin - 可执行文件名。
 * @returns {string | undefined} 绝对路径。
 */
function which(bin) {
  // 允许直接写绝对路径（便于测试或用自带的播放包装脚本）。
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
      // 继续找下一个目录
    }
  }
  return undefined
}

/** 音频子进程需要的会话环境：headless 的 systemd 服务默认没有这两个变量。 */
function audioEnv() {
  const env = { ...process.env }
  const uid = typeof process.getuid === 'function' ? process.getuid() : 1000
  if (!env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = `/run/user/${uid}`
  if (!env.DBUS_SESSION_BUS_ADDRESS) {
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`
  }
  return env
}

/**
 * 判断当前是否落在免打扰时段内，支持跨零点。
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
 * 挂载提醒插件。
 * @param {import('@deepseek-ai/cordis').Context} ctx - 宿主上下文。
 * @param {Record<string, unknown>} [rawConfig] - profile patch 里该行的 config。
 */
export function apply(ctx, rawConfig) {
  const cfg = resolveConfig(rawConfig)
  const log = (...args) => {
    if (cfg.verbose || process.env.DSH_AUDIO_ALERT_DEBUG === '1') console.error('[audio-alert]', ...args)
  }

  const player = cfg.player === 'auto' ? (which('pw-play') ? 'pw-play' : which('paplay') ? 'paplay' : which('aplay') ? 'aplay' : undefined) : which(cfg.player)
  const pwPlayer = which('pw-play')
  if (!player) {
    console.error('[audio-alert] 找不到 pw-play / paplay / aplay，提醒不会发声')
    return
  }
  if (cfg.btSink && !pwPlayer) {
    console.error('[audio-alert] 配了 btSink 但没有 pw-play，蓝牙优先不生效')
  }
  log('使用播放器', player, cfg.btSink ? `（优先蓝牙: ${cfg.btSink}）` : '')

  /**
   * 按播放器拼参数。
   * @param {string} bin - 播放器路径。
   * @param {string} file - 声音文件。
   * @returns {string[]} argv。
   */
  function argsFor(bin, file, volume) {
    if (bin.endsWith('pw-play')) {
      return [...(cfg.sink ? ['--target', String(cfg.sink)] : []), '--volume', String(volume), file]
    }
    if (bin.endsWith('paplay')) {
      return [...(cfg.sink ? ['--device', String(cfg.sink)] : []), '--volume', String(Math.round(Number(volume) * 65536)), file]
    }
    return [...(cfg.device ? ['-D', String(cfg.device)] : []), '-q', file]
  }

  /**
   * 播放一个事件声音（fire-and-forget，不阻塞回合）。
   * @param {keyof typeof cfg.sounds} key - 声音键。
   */
  let btCache = { at: 0, ok: false }

  /**
   * 判断蓝牙 sink 是否真的存在。`pw-play --target` 对不存在的目标也返回 0，
   * 不能靠退出码判断，只能先查一遍节点列表（结果缓存 5 秒）。
   * @returns {boolean}
   */
  function btSinkExists() {
    if (!pwPlayer) return false
    const now = Date.now()
    if (now - btCache.at < 5000) return btCache.ok
    let ok = false
    try {
      const res = spawnSync('pw-dump', [], { encoding: 'utf8', timeout: 1500, env: audioEnv(), maxBuffer: 16 * 1024 * 1024 })
      if (res.status === 0 && typeof res.stdout === 'string') {
        const nodes = JSON.parse(res.stdout)
        ok = Array.isArray(nodes) && nodes.some((node) => {
          const props = node?.info?.props
          if (!props || props['media.class'] !== 'Audio/Sink') return false
          return [props['node.description'], props['node.name'], props['node.nick']].some(
            (value) => typeof value === 'string' && value.includes(cfg.btSink),
          )
        })
      }
    } catch (error) {
      log('查询 sink 失败', error instanceof Error ? error.message : String(error))
    }
    btCache = { at: now, ok }
    return ok
  }

  function play(key, gain = 1) {
    if (!cfg.enabled) return
    const volume = Math.max(0, Math.min(1, Number(cfg.volume) * gain))
    const raw = cfg.sounds[key]
    if (typeof raw !== 'string' || raw === '') return
    const file = isAbsolute(raw) ? raw : join(HERE, raw)
    try {
      accessSync(file, constants.R_OK)
    } catch {
      console.error(`[audio-alert] 声音文件不存在: ${file}`)
      return
    }

    // 播放顺序：配了 btSink 就先走蓝牙，失败（sink 不存在 / 播放器报错）再回落
    // 到本地声卡。这样音箱在蓝牙模式时提示音不会被 line-in 吞掉。
    const attempts = []
    if (typeof cfg.btSink === 'string' && cfg.btSink !== '' && btSinkExists()) {
      attempts.push({ player: pwPlayer, args: ['--target', cfg.btSink, '--volume', String(volume), file], label: `蓝牙 ${cfg.btSink}` })
    }
    attempts.push({ player, args: argsFor(player, file, volume), label: player })

    let index = 0
    const attempt = () => {
      if (index >= attempts.length) return
      const target = attempts[index++]
      let settled = false
      const fail = (reason) => {
        if (settled) return
        settled = true
        // 蓝牙失败时静默回落；回落也失败才报错
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

    const night = inQuietHours(cfg.quietHours)
    const quietGain = night ? Number(cfg.quietFactor) : 1
    const loudGain = night && !cfg.approvalBypassesQuiet ? quietGain : 1

    const kind = event.data?.reason?.kind
    if (kind === 'completed' && cfg.events.done) {
      play('done', quietGain)
    } else if (kind === 'error' && cfg.events.error) {
      // 出错是“任务断在半路”，默认不受夜间降噪影响。
      play('error', loudGain)
    } else if (kind === 'blocked' && cfg.events.blocked) {
      // 审批策略直接拒绝：approval=never 时这是最常见的“干到一半被打断”。
      play('error', loudGain)
    } else if (kind === 'max-tokens' && cfg.events.maxTokens) {
      play('maxTokens', quietGain)
    }
  })

  // ---- 需要你动手的事件（审批 / 提问 / 计划评审） -------------------------
  /**
   * 一个“需要你动手”的提示音循环：先响一次，没处理就按退避重播。
   * @param {keyof typeof cfg.sounds} soundKey - 声音键。
   * @returns {{ start: () => void, stop: () => void, dispose: () => void }} 控制器。
   */
  function createAttentionTone(soundKey) {
    let pending = 0
    let timer
    let repeatIndex = 0

    const gain = () => (inQuietHours(cfg.quietHours) && !cfg.approvalBypassesQuiet ? Number(cfg.quietFactor) : 1)

    const stop = () => {
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
        stop()
      },
      dispose() {
        stop()
        pending = 0
      },
    }
  }

  const approvalTone = createAttentionTone('approval')
  const questionTone = createAttentionTone('question')

  /**
   * 挂一个“阻塞等待用户”的瀑布：进入时响，结束后停。
   * @param {string} event - 瀑布事件名。
   * @param {{ start: () => void, stop: () => void }} tone - 提示音控制器。
   */
  function waitForUser(event, tone) {
    ctx.on(event, async (request, next) => {
      const isSubagent = request?.agent?.session?.header?.origin === 'subagent'
      if (isSubagent) return next()
      tone.start()
      try {
        return await next()
      } finally {
        tone.stop()
      }
    })
  }

  if (cfg.events.approval !== false) waitForUser('approval/request', approvalTone)
  // 提问工具和计划评审走同一个瀑布（intent.kind === 'plan-review'）。
  if (cfg.events.question !== false) waitForUser('user-questions/request', questionTone)

  ctx.effect(() => () => {
    approvalTone.dispose()
    questionTone.dispose()
  })
}
