'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const WS = require('../renderer/windowStyle.js')

test('KEYS lists exactly the supported settings', () => {
  const names = WS.KEYS.map(k => k.key)
  assert.deepEqual(names, [
    'background',
    'unfocusedBackground',
    'useMica',
    'frame',
    'showTabsInTitlebar',
    'useAcrylicInTabRow',
    'opacity',
    'backgroundImage',
    'backgroundImageOpacity',
  ])
})

test('normalize undefined yields object with all keys undefined', () => {
  const out = WS.normalize(undefined)
  assert.equal(typeof out, 'object')
  for (const { key } of WS.KEYS) {
    assert.equal(out[key], undefined, `${key} should be undefined`)
  }
})

test('normalize preserves valid color/string fields', () => {
  const out = WS.normalize({
    background: '#112233',
    unfocusedBackground: '#445566',
    backgroundImage: 'C:\\img.png',
  })
  assert.equal(out.background, '#112233')
  assert.equal(out.unfocusedBackground, '#445566')
  assert.equal(out.backgroundImage, 'C:\\img.png')
})

test('normalize drops empty-string color/path fields', () => {
  const out = WS.normalize({ background: '', backgroundImage: '   ' })
  assert.equal(out.background, undefined)
  assert.equal(out.backgroundImage, undefined)
})

test('normalize keeps booleans only when strictly boolean', () => {
  const out = WS.normalize({
    useMica: true,
    frame: false,
    showTabsInTitlebar: 'yes',
    useAcrylicInTabRow: 1,
  })
  assert.equal(out.useMica, true)
  assert.equal(out.frame, false)
  assert.equal(out.showTabsInTitlebar, undefined)
  assert.equal(out.useAcrylicInTabRow, undefined)
})

test('normalize clamps opacity to 0-100 integer percent', () => {
  assert.equal(WS.normalize({ opacity: 50 }).opacity, 50)
  assert.equal(WS.normalize({ opacity: 0 }).opacity, 0)
  assert.equal(WS.normalize({ opacity: 100 }).opacity, 100)
  assert.equal(WS.normalize({ opacity: 150 }).opacity, 100)
  assert.equal(WS.normalize({ opacity: -10 }).opacity, 0)
  assert.equal(WS.normalize({ opacity: 'x' }).opacity, undefined)
  assert.equal(WS.normalize({ opacity: NaN }).opacity, undefined)
})

test('normalize clamps backgroundImageOpacity to 0-1 float', () => {
  assert.equal(WS.normalize({ backgroundImageOpacity: 0.5 }).backgroundImageOpacity, 0.5)
  assert.equal(WS.normalize({ backgroundImageOpacity: 0 }).backgroundImageOpacity, 0)
  assert.equal(WS.normalize({ backgroundImageOpacity: 1 }).backgroundImageOpacity, 1)
  assert.equal(WS.normalize({ backgroundImageOpacity: 2 }).backgroundImageOpacity, 1)
  assert.equal(WS.normalize({ backgroundImageOpacity: -1 }).backgroundImageOpacity, 0)
  assert.equal(WS.normalize({ backgroundImageOpacity: 'x' }).backgroundImageOpacity, undefined)
})

test('serialize omits undefined keys', () => {
  const style = WS.normalize({ background: '#aabbcc' })
  const out = WS.serialize(style)
  assert.deepEqual(Object.keys(out), ['background'])
  assert.equal(out.background, '#aabbcc')
})

test('serialize keeps boolean false (explicit user intent)', () => {
  const out = WS.serialize(WS.normalize({ useMica: false, frame: true }))
  assert.equal(out.useMica, false)
  assert.equal(out.frame, true)
})

test('serialize returns undefined when no keys are set', () => {
  assert.equal(WS.serialize(WS.normalize(undefined)), undefined)
  assert.equal(WS.serialize(WS.normalize({})), undefined)
})

test('round-trip normalize -> serialize -> normalize is stable', () => {
  const input = {
    background: '#000000',
    useMica: true,
    opacity: 75,
    backgroundImageOpacity: 0.4,
  }
  const a = WS.normalize(input)
  const s = WS.serialize(a)
  const b = WS.normalize(s)
  assert.deepEqual(b, a)
})

test('hasAny reports whether any key is set', () => {
  assert.equal(WS.hasAny(WS.normalize(undefined)), false)
  assert.equal(WS.hasAny(WS.normalize({ useMica: true })), true)
  assert.equal(WS.hasAny(WS.normalize({ frame: false })), true)
})
