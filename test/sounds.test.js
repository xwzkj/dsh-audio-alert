import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SAMPLE_RATE, SOUND_KEYS, SOUND_VERSION, ensureSoundFile, soundStem, wavBuffer } from '../sounds.js'

test('wavBuffer produces a 48 kHz stereo 16-bit RIFF file', () => {
  const buffer = wavBuffer('done')
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE')
  assert.equal(buffer.readUInt16LE(20), 1) // PCM
  assert.equal(buffer.readUInt16LE(22), 2) // stereo
  assert.equal(buffer.readUInt32LE(24), SAMPLE_RATE)
  assert.equal(buffer.readUInt16LE(34), 16)
  assert.equal(buffer.readUInt32LE(40), buffer.length - 44)
  assert.ok(buffer.length > 44)
})

test('all built-in sounds render distinct, non-empty audio', () => {
  const hashes = new Set()
  for (const key of SOUND_KEYS) {
    const buffer = wavBuffer(key)
    const seconds = (buffer.length - 44) / 4 / SAMPLE_RATE
    assert.ok(seconds > 0.5, `${key} is too short: ${seconds}s`)
    hashes.add(createHash('sha256').update(buffer).digest('hex'))
  }
  assert.equal(hashes.size, SOUND_KEYS.length)
})

test('wavBuffer is deterministic for the same key', () => {
  assert.ok(wavBuffer('approval').equals(wavBuffer('approval')))
})

test('ensureSoundFile writes the versioned file and reuses it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-audio-alert-test-'))
  try {
    const file = ensureSoundFile('done', { dir })
    assert.equal(file, join(dir, `done-v${SOUND_VERSION}.wav`))
    assert.ok(existsSync(file))
    assert.equal(statSync(file).size, wavBuffer('done').length)
    assert.equal(ensureSoundFile('done', { dir }), file)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('soundStem maps maxTokens and rejects unknown keys', () => {
  assert.equal(soundStem('maxTokens'), 'max-tokens')
  assert.throws(() => soundStem('nope'), /unknown sound/)
})
