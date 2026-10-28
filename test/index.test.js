import { test } from 'node:test'
import assert from 'node:assert/strict'

import { apply, buildArgs, inQuietHours, pickPlayer, playerKind, resolveConfig, DEFAULTS } from '../index.js'

test('inQuietHours: 跨零点窗口', () => {
  const night = (h, m) => new Date(2026, 9, 26, h, m)
  assert.equal(inQuietHours('21:30-05:30', night(23, 45)), true)
  assert.equal(inQuietHours('21:30-05:30', night(4, 0)), true)
  assert.equal(inQuietHours('21:30-05:30', night(5, 29)), true)
  assert.equal(inQuietHours('21:30-05:30', night(5, 30)), false)
  assert.equal(inQuietHours('21:30-05:30', night(12, 0)), false)
})

test('inQuietHours: 普通窗口与边界', () => {
  const at = (h) => new Date(2026, 9, 26, h, 0)
  assert.equal(inQuietHours('13:00-14:00', at(13)), true)
  assert.equal(inQuietHours('13:00-14:00', at(14)), false)
  assert.equal(inQuietHours('13:00-14:00', at(12)), false)
})

test('inQuietHours: 空值与非法输入不生效', () => {
  assert.equal(inQuietHours(''), false)
  assert.equal(inQuietHours('  '), false)
  assert.equal(inQuietHours('nonsense'), false)
  assert.equal(inQuietHours('10:00-10:00'), false)
})

test('resolveConfig: 默认值不被意外覆盖', () => {
  const cfg = resolveConfig()
  assert.equal(cfg.player, 'auto')
  assert.equal(cfg.sink, '')
  assert.equal(cfg.device, '')
  assert.equal(cfg.events.question, true)
})

test('resolveConfig: 嵌套对象浅合并', () => {
  const cfg = resolveConfig({ events: { done: false }, volume: 0.3 })
  assert.equal(cfg.events.done, false)
  assert.equal(cfg.events.error, DEFAULTS.events.error)
  assert.equal(cfg.volume, 0.3)
})

test('resolveConfig: btSink 作为 sink 的旧别名', () => {
  assert.equal(resolveConfig({ btSink: 'BDM3P' }).sink, 'BDM3P')
  assert.equal(resolveConfig({ btSink: 'BDM3P', sink: 'other' }).sink, 'other')
})

test('pickPlayer: auto 按优先级挑选', () => {
  const has = (bins) => (bin) => (bins.includes(bin) ? `/usr/bin/${bin}` : undefined)
  assert.equal(pickPlayer('auto', has(['pw-play', 'aplay'])), 'pw-play')
  assert.equal(pickPlayer('auto', has(['paplay'])), 'paplay')
  assert.equal(pickPlayer('auto', has([])), undefined)
})

test('pickPlayer: 指定播放器缺失时返回 undefined', () => {
  const none = () => undefined
  assert.equal(pickPlayer('pw-play', none), undefined)
  assert.equal(pickPlayer('aplay', (bin) => bin), 'aplay')
})

test('buildArgs: pw-play 带 sink 与音量', () => {
  const args = buildArgs('pw-play', '/tmp/a.wav', { sink: 'BDM3P', volume: 0.36 })
  assert.deepEqual(args, ['--target', 'BDM3P', '--volume', '0.36', '/tmp/a.wav'])
})

test('buildArgs: pw-play 不带 sink 时走系统默认设备', () => {
  assert.deepEqual(buildArgs('pw-play', '/tmp/a.wav', { volume: 0.6 }), ['--volume', '0.6', '/tmp/a.wav'])
})

test('buildArgs: paplay 音量换算到 0..65536', () => {
  assert.deepEqual(buildArgs('paplay', '/tmp/a.wav', { volume: 0.5 }), ['--volume', '32768', '/tmp/a.wav'])
})

test('buildArgs: paplay 带 sink 时用 --device', () => {
  assert.deepEqual(buildArgs('paplay', '/tmp/a.wav', { sink: 'alsa_output.usb', volume: 0.5 }), [
    '--device',
    'alsa_output.usb',
    '--volume',
    '32768',
    '/tmp/a.wav',
  ])
})

test('buildArgs: aplay 使用设备且没有音量参数', () => {
  assert.deepEqual(buildArgs('aplay', '/tmp/a.wav', { device: 'plughw:CARD=PCH,DEV=0', volume: 1 }), [
    '-D',
    'plughw:CARD=PCH,DEV=0',
    '-q',
    '/tmp/a.wav',
  ])
  assert.deepEqual(buildArgs('aplay', '/tmp/a.wav'), ['-q', '/tmp/a.wav'])
})

test('playerKind: 绝对路径与带后缀的名字都能归一', () => {
  assert.equal(playerKind('/usr/bin/pw-play'), 'pw-play')
  assert.equal(playerKind('/tmp/fake-pw-play'), 'pw-play')
  assert.equal(playerKind('aplay'), 'aplay')
  assert.equal(playerKind('/opt/unknown'), '/opt/unknown')
})

test('等待类事件使用 global 监听，避免被 agent scope 过滤', () => {
  const registrations = []
  const ctx = {
    on: (event, listener, options) => {
      registrations.push({ event, listener, options })
      return () => true
    },
    effect: (fn) => fn(),
  }
  apply(ctx, { player: process.execPath, verbose: false })
  for (const event of ['approval/request', 'user-questions/request']) {
    const registration = registrations.find((item) => item.event === event)
    assert.ok(registration, `${event} was not registered`)
    assert.deepEqual(registration.options, { global: true, prepend: true })
  }
})
