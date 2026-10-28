import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULTS } from '../index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('package.json declares the dsh.bundle patch', () => {
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.ok(existsSync(join(root, 'cordis.patch.yml')))
})

test('cordis.patch.yml inserts the audio-alert row', () => {
  const text = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(text, /^\s*-\s*insert:\s*$/m)
  assert.match(text, /^\s*-\s*id:\s*audio-alert\s*$/m)
  assert.match(text, /^\s*name:\s*dsh-audio-alert\s*$/m)
})

test('published files cover the runtime and docs', () => {
  const files = new Set(pkg.files)
  for (const entry of [
    'index.js',
    'sounds.js',
    'scripts',
    'cordis.patch.yml',
    'README.md',
    'README.en.md',
    'CHANGELOG.md',
    'LICENSE',
    'test-alert.sh',
  ]) {
    assert.ok(files.has(entry), `package.json "files" is missing ${entry}`)
  }
  assert.equal(files.has('sounds'), false, 'the package should not ship WAV files')
})

test('the default sounds are generated at runtime', () => {
  assert.deepEqual(DEFAULTS.sounds, {})
  assert.ok(existsSync(join(root, 'sounds.js')))
  assert.ok(existsSync(join(root, 'scripts/render-sounds.js')))
})

test('package metadata is publishable', () => {
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.repository?.type, 'git')
  assert.match(pkg.repository?.url ?? '', /^git\+https:\/\/github\.com\//)
  assert.match(pkg.homepage ?? '', /^https:\/\/github\.com\//)
  assert.match(pkg.bugs?.url ?? '', /\/issues$/)
})
