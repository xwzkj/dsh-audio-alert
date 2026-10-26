#!/usr/bin/env node
/**
 * 把五个内置提示音渲染成 WAV，用于试听/调试。
 * 运行时插件不需要这个脚本：它会自己合成到缓存目录。
 *
 *   node scripts/render-sounds.js [输出目录]
 */

import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { SOUND_KEYS, soundStem, writeSoundFile } from '../sounds.js'

const out = resolve(process.argv[2] ?? 'sounds')
mkdirSync(out, { recursive: true })

for (const key of SOUND_KEYS) {
  const file = join(out, `${soundStem(key)}.wav`)
  writeSoundFile(key, file)
  console.log(file)
}
