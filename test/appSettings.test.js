'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  THEMES,
  DEFAULT_SETTINGS,
  KNOWN_KEYS,
  normalizeSettings,
  sanitizePatch,
  isSafeSubdir,
} = require('../src/appSettings')

test('THEMES includes workshop-plate baseline and at least one alt', () => {
  assert.ok(Array.isArray(THEMES))
  assert.ok(THEMES.includes('workshop-plate'))
  assert.ok(THEMES.length >= 2)
})

test('DEFAULT_SETTINGS has all KNOWN_KEYS and matching defaults', () => {
  for (const k of KNOWN_KEYS) {
    assert.ok(Object.hasOwn(DEFAULT_SETTINGS, k), `default missing key ${k}`)
  }
  assert.equal(DEFAULT_SETTINGS.theme, 'workshop-plate')
  assert.equal(DEFAULT_SETTINGS.confirmOnDelete, true)
  assert.equal(DEFAULT_SETTINGS.defaultProfile, null)
  assert.equal(DEFAULT_SETTINGS.defaultSaveSubdir, null)
})

test('normalizeSettings({}) returns defaults', () => {
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS)
})

test('normalizeSettings(null) returns defaults', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
})

test('normalizeSettings(undefined) returns defaults', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS)
})

test('normalizeSettings preserves valid theme', () => {
  const r = normalizeSettings({ theme: THEMES[1] })
  assert.equal(r.theme, THEMES[1])
})

test('normalizeSettings rejects unknown theme to default', () => {
  const r = normalizeSettings({ theme: 'bogus-theme' })
  assert.equal(r.theme, 'workshop-plate')
})

test('normalizeSettings honors confirmOnDelete=false (boolean)', () => {
  const r = normalizeSettings({ confirmOnDelete: false })
  assert.equal(r.confirmOnDelete, false)
})

test('normalizeSettings ignores non-boolean confirmOnDelete', () => {
  assert.equal(normalizeSettings({ confirmOnDelete: 'no' }).confirmOnDelete, true)
  assert.equal(normalizeSettings({ confirmOnDelete: 0 }).confirmOnDelete, true)
})

test('normalizeSettings trims defaultProfile', () => {
  assert.equal(normalizeSettings({ defaultProfile: '  pwsh  ' }).defaultProfile, 'pwsh')
})

test('normalizeSettings empty defaultProfile becomes null', () => {
  assert.equal(normalizeSettings({ defaultProfile: '' }).defaultProfile, null)
  assert.equal(normalizeSettings({ defaultProfile: '   ' }).defaultProfile, null)
})

test('normalizeSettings non-string defaultProfile becomes null', () => {
  assert.equal(normalizeSettings({ defaultProfile: 42 }).defaultProfile, null)
})

test('normalizeSettings accepts safe defaultSaveSubdir', () => {
  assert.equal(normalizeSettings({ defaultSaveSubdir: 'work' }).defaultSaveSubdir, 'work')
  assert.equal(normalizeSettings({ defaultSaveSubdir: 'work/sub' }).defaultSaveSubdir, 'work/sub')
})

test('normalizeSettings rejects parent-traversal subdir', () => {
  assert.equal(normalizeSettings({ defaultSaveSubdir: '../evil' }).defaultSaveSubdir, null)
  assert.equal(normalizeSettings({ defaultSaveSubdir: 'a/../b' }).defaultSaveSubdir, null)
  assert.equal(normalizeSettings({ defaultSaveSubdir: '..\\evil' }).defaultSaveSubdir, null)
})

test('normalizeSettings rejects absolute subdir', () => {
  assert.equal(normalizeSettings({ defaultSaveSubdir: '/abs/path' }).defaultSaveSubdir, null)
  assert.equal(normalizeSettings({ defaultSaveSubdir: 'C:\\foo' }).defaultSaveSubdir, null)
  assert.equal(normalizeSettings({ defaultSaveSubdir: '\\\\server\\share' }).defaultSaveSubdir, null)
})

test('normalizeSettings trims subdir and strips trailing separators', () => {
  assert.equal(normalizeSettings({ defaultSaveSubdir: '  work/  ' }).defaultSaveSubdir, 'work')
  assert.equal(normalizeSettings({ defaultSaveSubdir: 'work\\' }).defaultSaveSubdir, 'work')
})

test('isSafeSubdir basic cases', () => {
  assert.equal(isSafeSubdir('work'), true)
  assert.equal(isSafeSubdir('a/b/c'), true)
  assert.equal(isSafeSubdir('..'), false)
  assert.equal(isSafeSubdir('a/../b'), false)
  assert.equal(isSafeSubdir('/abs'), false)
  assert.equal(isSafeSubdir('C:\\x'), false)
  assert.equal(isSafeSubdir(''), false)
  assert.equal(isSafeSubdir(null), false)
  assert.equal(isSafeSubdir(42), false)
})

test('sanitizePatch drops unknown keys', () => {
  const p = sanitizePatch({ theme: 'workshop-plate', evil: 'x', __proto__: {} })
  assert.deepEqual(Object.keys(p).sort(), ['theme'])
})

test('sanitizePatch drops invalid theme', () => {
  const p = sanitizePatch({ theme: 'bogus' })
  assert.deepEqual(p, {})
})

test('sanitizePatch drops invalid subdir', () => {
  const p = sanitizePatch({ defaultSaveSubdir: '../evil' })
  assert.deepEqual(p, {})
})

test('sanitizePatch trims valid subdir', () => {
  const p = sanitizePatch({ defaultSaveSubdir: '  work  ' })
  assert.deepEqual(p, { defaultSaveSubdir: 'work' })
})

test('sanitizePatch passes through valid boolean confirmOnDelete', () => {
  assert.deepEqual(sanitizePatch({ confirmOnDelete: false }), { confirmOnDelete: false })
  assert.deepEqual(sanitizePatch({ confirmOnDelete: true }), { confirmOnDelete: true })
})

test('sanitizePatch drops non-boolean confirmOnDelete', () => {
  assert.deepEqual(sanitizePatch({ confirmOnDelete: 'yes' }), {})
})

test('sanitizePatch trims defaultProfile', () => {
  assert.deepEqual(sanitizePatch({ defaultProfile: '  pwsh  ' }), { defaultProfile: 'pwsh' })
})

test('sanitizePatch empty defaultProfile clears via null', () => {
  assert.deepEqual(sanitizePatch({ defaultProfile: '' }), { defaultProfile: null })
})

test('sanitizePatch handles non-object input', () => {
  assert.deepEqual(sanitizePatch(null), {})
  assert.deepEqual(sanitizePatch(undefined), {})
  assert.deepEqual(sanitizePatch('string'), {})
})

test('sanitizePatch null subdir is allowed (clears)', () => {
  assert.deepEqual(sanitizePatch({ defaultSaveSubdir: null }), { defaultSaveSubdir: null })
})

test('sanitizePatch null defaultProfile is allowed (clears)', () => {
  assert.deepEqual(sanitizePatch({ defaultProfile: null }), { defaultProfile: null })
})
