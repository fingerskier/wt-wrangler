'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const F = require('../src/wtFragments')

const layoutA = {
  name: 'dev-cockpit',
  window: 'dev',
  windowStyle: { background: '#112233', opacity: 80 },
  tabs: [{ panes: [{ profile: 'pwsh' }] }],
}

const layoutB = {
  name: 'other',
  window: 'dev',
  windowStyle: { background: '#aabbcc', opacity: 80 },
  tabs: [{ panes: [{ profile: 'pwsh' }] }],
}

test('styleHash is deterministic for same window+style', () => {
  assert.equal(F.styleHash(layoutA), F.styleHash({ ...layoutA }))
})

test('styleHash differs when style differs (collision avoidance)', () => {
  assert.notEqual(F.styleHash(layoutA), F.styleHash(layoutB))
})

test('styleHash ignores non-style fields (tabs, name)', () => {
  const a = { ...layoutA, tabs: [{ panes: [{ profile: 'pwsh' }, { profile: 'cmd' }] }] }
  assert.equal(F.styleHash(layoutA), F.styleHash(a))
})

test('styleHash returns 8-char lowercase hex', () => {
  assert.match(F.styleHash(layoutA), /^[0-9a-f]{8}$/)
})

test('styleHash handles missing windowStyle', () => {
  assert.match(F.styleHash({ window: 'x' }), /^[0-9a-f]{8}$/)
})

test('fragmentFileName is <safeWindow>-<hash>.json', () => {
  const name = F.fragmentFileName(layoutA)
  const hash = F.styleHash(layoutA)
  assert.equal(name, `dev-${hash}.json`)
})

test('fragmentFileName sanitizes window name', () => {
  const layout = { window: 'has spaces & punct/?', windowStyle: { background: '#000' } }
  const name = F.fragmentFileName(layout)
  assert.match(name, /^[A-Za-z0-9_\-]+-[0-9a-f]{8}\.json$/)
})

test('fragmentFileName falls back to wtw when window missing', () => {
  const layout = { windowStyle: { background: '#000' } }
  const name = F.fragmentFileName(layout)
  assert.match(name, /^wtw-[0-9a-f]{8}\.json$/)
})

test('fragmentFileName differs for two layouts sharing window name but different style', () => {
  assert.notEqual(F.fragmentFileName(layoutA), F.fragmentFileName(layoutB))
})

test('staleFragmentFiles returns names older than maxAgeMs and not in keepSet', () => {
  const now = 1_000_000_000_000
  const day = 86_400_000
  const entries = [
    { name: 'old-aaaa1111.json', mtimeMs: now - 40 * day },
    { name: 'fresh-bbbb2222.json', mtimeMs: now - 1 * day },
    { name: 'old-but-kept-cccc3333.json', mtimeMs: now - 60 * day },
  ]
  const keep = new Set(['old-but-kept-cccc3333.json'])
  const stale = F.staleFragmentFiles(entries, keep, now, 30 * day)
  assert.deepEqual(stale, ['old-aaaa1111.json'])
})

test('staleFragmentFiles never includes items in keepSet regardless of age', () => {
  const now = 1_000_000_000_000
  const entries = [{ name: 'kept.json', mtimeMs: now - 365 * 86_400_000 }]
  const keep = new Set(['kept.json'])
  assert.deepEqual(F.staleFragmentFiles(entries, keep, now, 30 * 86_400_000), [])
})

test('staleFragmentFiles returns [] for empty entries', () => {
  assert.deepEqual(F.staleFragmentFiles([], new Set(), 0, 1), [])
})

test('staleFragmentFiles only sweeps .json files (ignores tmp/lock/index)', () => {
  const now = 1_000_000_000_000
  const entries = [
    { name: 'old.json', mtimeMs: now - 100 * 86_400_000 },
    { name: '.index.json.tmp', mtimeMs: now - 100 * 86_400_000 },
    { name: 'random.txt', mtimeMs: now - 100 * 86_400_000 },
  ]
  const stale = F.staleFragmentFiles(entries, new Set(), now, 30 * 86_400_000)
  assert.deepEqual(stale, ['old.json'])
})
