/**
 * 运行时提示音合成。
 *
 * 不再随包发布 WAV：第一次播放某个事件时，用纯 JS 合成 48kHz/16-bit/立体声
 * PCM，写到缓存目录，再把路径交给 pw-play/paplay/aplay。这样 npm 包从
 * 1.3MB 的声音文件降到几十 KB，同时保留原来的钟/木琴音色。
 *
 * 缓存位置：`$XDG_CACHE_HOME/dsh-audio-alert`，没有则 `~/.cache/...`，
 * 再不行就 `os.tmpdir()`。改合成参数后把 SOUND_VERSION 加一，旧缓存自然失效。
 */

import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** 采样率；WAV 头和数据都按这个值写。 */
export const SAMPLE_RATE = 48_000

/** 合成算法版本；改音色后加一，缓存文件名随之变化。 */
export const SOUND_VERSION = 1

/** 插件内部的事件键；`maxTokens` 对应文件名 `max-tokens`。 */
export const SOUND_KEYS = ['done', 'question', 'error', 'approval', 'maxTokens']

const STEMS = {
  done: 'done',
  question: 'question',
  error: 'error',
  approval: 'approval',
  maxTokens: 'max-tokens',
}

/**
 * 事件键 → 声音文件名主干。
 * @param {string} key
 * @returns {string}
 */
export function soundStem(key) {
  const stem = STEMS[key]
  if (!stem) throw new Error(`unknown sound: ${key}`)
  return stem
}

/**
 * 单个泛音：短促软起音 + 指数衰减。
 * @param {number} freq
 * @param {number} duration
 * @param {number} amp
 * @param {number} decay
 * @param {number} [attack]
 * @returns {Float64Array}
 */
function partial(freq, duration, amp, decay, attack = 0.006) {
  const n = Math.floor(SAMPLE_RATE * duration)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE
    const env = Math.min(1, t / attack) * Math.exp(-t / decay)
    out[i] = amp * env * Math.sin(2 * Math.PI * freq * t)
  }
  return out
}

/** 钟体：基频 + 略带非谐的泛音，高次泛音衰减更快。 */
function bell(freq, duration = 1.3, amp = 1, decay = 0.34) {
  const parts = [
    [1.0, 1.0, 1.0],
    [2.0, 0.34, 0.75],
    [2.98, 0.13, 0.55],
    [4.2, 0.05, 0.4],
  ]
  const n = Math.floor(SAMPLE_RATE * duration)
  const out = new Float64Array(n)
  for (const [ratio, level, damp] of parts) {
    const layer = partial(freq * ratio, duration, amp * level, decay * damp)
    for (let i = 0; i < n; i++) out[i] += layer[i]
  }
  return out
}

/** 木质打击音：奇次泛音为主，衰减极快，清晰但不吵。 */
function wood(freq, duration = 0.6, amp = 1) {
  const n = Math.floor(SAMPLE_RATE * duration)
  const out = new Float64Array(n)
  for (const [ratio, level] of [[1.0, 1.0], [3.0, 0.16], [5.0, 0.05]]) {
    const layer = partial(freq * ratio, duration, amp * level, 0.11 / (1 + 0.25 * (ratio - 1)))
    for (let i = 0; i < n; i++) out[i] += layer[i]
  }
  return out
}

/** 低音：基频加一点二次泛音，20ms 起音，避免“哔”的锐利感。 */
function softLow(freq, duration = 0.9, amp = 1) {
  const n = Math.floor(SAMPLE_RATE * duration)
  const out = new Float64Array(n)
  for (const [ratio, level, decay] of [[1.0, 1.0, 0.3], [2.0, 0.1, 0.18]]) {
    const layer = partial(freq * ratio, duration, amp * level, decay, 0.02)
    for (let i = 0; i < n; i++) out[i] += layer[i]
  }
  return out
}

/** 把若干音轨混到时间轴 at 秒处。 */
function place(at, ...tracks) {
  const start = Math.floor(SAMPLE_RATE * at)
  const length = start + Math.max(...tracks.map((track) => track.length))
  const out = new Float64Array(length)
  for (const track of tracks) {
    for (let i = 0; i < track.length; i++) out[start + i] += track[i]
  }
  return out
}

/** 把多条时间轴对齐的轨道相加（短的补零）。 */
function mix(...tracks) {
  const length = Math.max(...tracks.map((track) => track.length))
  const out = new Float64Array(length)
  for (const track of tracks) {
    for (let i = 0; i < track.length; i++) out[i] += track[i]
  }
  return out
}

/** 两级低幅回声，制造一点房间感。 */
function echo(track) {
  let out = new Float64Array(track.length)
  out.set(track)
  for (const [delay, gain] of [[0.075, 0.2], [0.14, 0.09]]) {
    const offset = Math.floor(SAMPLE_RATE * delay)
    if (out.length < track.length + offset) {
      const next = new Float64Array(track.length + offset)
      next.set(out)
      out = next
    }
    for (let i = 0; i < track.length; i++) out[i + offset] += track[i] * gain
  }
  return out
}

/** 左声道原样、右声道延后一点点，得到轻微的开阔感。 */
function stereo(track, widthMs = 11) {
  const offset = Math.floor((SAMPLE_RATE * widthMs) / 1000)
  const left = new Float64Array(track.length + offset)
  const right = new Float64Array(track.length + offset)
  for (let i = 0; i < track.length; i++) left[i] = track[i]
  for (let i = 0; i < track.length; i++) right[i + offset] = track[i]
  return { left, right }
}

/** 每个事件对应的音型；音高和音色与旧版 WAV 保持一致。 */
function trackFor(key) {
  switch (key) {
    case 'done':
      // 完成：两个钟音上行（A5 → E6），尾音留一点。
      return mix(place(0, bell(880, 1.1, 0.9)), place(0.26, bell(1318.51, 1.35, 1)))
    case 'error':
      // 出错：两个低音下行（A3 → E3），音色偏木、不尖叫。
      return mix(place(0, softLow(220, 0.75, 0.9)), place(0.22, softLow(164.81, 1.05, 1)))
    case 'approval':
      // 待审批：三记木鱼式上行（C6 → E6 → G6），清晰但不是警报。
      return mix(
        place(0, wood(1046.5, 0.55, 0.9)),
        place(0.13, wood(1318.51, 0.6, 1)),
        place(0.26, wood(1567.98, 0.62, 1)),
      )
    case 'question':
      // 提问：两个音上行五度（D5 → A5），像一句上扬的“嗯？”。
      return mix(place(0, wood(587.33, 0.55, 0.85)), place(0.16, wood(880, 1.1, 0.95)))
    case 'maxTokens':
      // 触顶：两声同样的钟音，中性，区别于“完成”。
      return mix(place(0, bell(783.99, 0.8, 0.9)), place(0.28, bell(783.99, 0.8, 0.8)))
    default:
      throw new Error(`unknown sound: ${key}`)
  }
}

/**
 * 渲染一个事件的立体声 PCM，并做峰值归一化。
 * @param {string} key
 * @returns {{ left: Float64Array, right: Float64Array, gain: number }}
 */
function renderFrames(key) {
  const { left, right } = stereo(echo(trackFor(key)))
  let peak = 0
  for (let i = 0; i < left.length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  }
  return { left, right, gain: peak > 0.5 ? 0.5 / peak : 1 }
}

/**
 * 把一个事件渲染成完整的 WAV 文件内容（RIFF/PCM）。
 * @param {string} key
 * @returns {Buffer}
 */
export function wavBuffer(key) {
  soundStem(key)
  const { left, right, gain } = renderFrames(key)
  const dataSize = left.length * 4
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(2, 22) // stereo
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 4, 28) // byte rate
  buffer.writeUInt16LE(4, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < left.length; i++) {
    const l = Math.max(-1, Math.min(1, left[i] * gain))
    const r = Math.max(-1, Math.min(1, right[i] * gain))
    buffer.writeInt16LE(Math.trunc(l * 32767), 44 + i * 4)
    buffer.writeInt16LE(Math.trunc(r * 32767), 46 + i * 4)
  }
  return buffer
}

/**
 * 把 WAV 写到指定路径。
 * @param {string} key
 * @param {string} file
 * @returns {string} file
 */
export function writeSoundFile(key, file) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, wavBuffer(key), { mode: 0o644 })
  return file
}

/** 默认缓存目录。 */
function defaultCacheDir() {
  const base = process.env.XDG_CACHE_HOME || (process.env.HOME ? join(process.env.HOME, '.cache') : '')
  return base ? join(base, 'dsh-audio-alert') : join(tmpdir(), 'dsh-audio-alert')
}

/**
 * 确保某个事件的 WAV 已在缓存里，返回路径。首次调用会同步合成，约几十毫秒。
 * @param {string} key
 * @param {{ dir?: string }} [options]
 * @returns {string}
 */
export function ensureSoundFile(key, options = {}) {
  const stem = soundStem(key)
  const dirs = options.dir ? [options.dir] : [defaultCacheDir(), join(tmpdir(), 'dsh-audio-alert')]
  let lastError
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true })
      const target = join(dir, `${stem}-v${SOUND_VERSION}.wav`)
      if (existsSync(target) && statSync(target).size > 44) return target
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`
      writeSoundFile(key, temp)
      renameSync(temp, target)
      return target
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
