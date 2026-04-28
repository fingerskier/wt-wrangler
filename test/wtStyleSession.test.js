'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const S = require('../src/wtStyleSession')

test('makeSession starts empty', () => {
  const s = S.makeSession()
  assert.deepEqual(s.pending(), [])
  assert.equal(s.getSnapshot('/x/settings.json'), undefined)
})

test('recordSnapshot stores content and pending lists path', () => {
  const s = S.makeSession()
  s.recordSnapshot('/x/settings.json', '{"a":1}')
  assert.equal(s.getSnapshot('/x/settings.json'), '{"a":1}')
  assert.deepEqual(s.pending(), ['/x/settings.json'])
})

test('recordSnapshot is one-shot per path — subsequent calls preserve original', () => {
  const s = S.makeSession()
  s.recordSnapshot('/x/settings.json', 'ORIGINAL')
  s.recordSnapshot('/x/settings.json', 'PATCHED-LATER')
  assert.equal(s.getSnapshot('/x/settings.json'), 'ORIGINAL')
})

test('forget removes a snapshot', () => {
  const s = S.makeSession()
  s.recordSnapshot('/a', 'A')
  s.recordSnapshot('/b', 'B')
  s.forget('/a')
  assert.equal(s.getSnapshot('/a'), undefined)
  assert.deepEqual(s.pending().sort(), ['/b'])
})

test('forget on missing path is a no-op', () => {
  const s = S.makeSession()
  s.forget('/nope')
  assert.deepEqual(s.pending(), [])
})

test('multiple paths tracked independently', () => {
  const s = S.makeSession()
  s.recordSnapshot('/a', 'A')
  s.recordSnapshot('/b', 'B')
  assert.equal(s.getSnapshot('/a'), 'A')
  assert.equal(s.getSnapshot('/b'), 'B')
  assert.deepEqual(s.pending().sort(), ['/a', '/b'])
})

test('restoreAll writes each snapshot via injected fs and clears session', async () => {
  const s = S.makeSession()
  s.recordSnapshot('/x/settings.json', 'ORIGINAL-A')
  s.recordSnapshot('/y/settings.json', 'ORIGINAL-B')
  const writes = []
  const fakeFs = {
    writeFile: async (p, c) => { writes.push({ p, c }) },
  }
  const res = await S.restoreAll(s, fakeFs)
  assert.deepEqual(writes.sort((a, b) => a.p.localeCompare(b.p)), [
    { p: '/x/settings.json', c: 'ORIGINAL-A' },
    { p: '/y/settings.json', c: 'ORIGINAL-B' },
  ])
  assert.deepEqual(res.restored.sort(), ['/x/settings.json', '/y/settings.json'])
  assert.deepEqual(res.errors, [])
  assert.deepEqual(s.pending(), [])
})

test('restoreAll on empty session is a no-op', async () => {
  const s = S.makeSession()
  const fakeFs = { writeFile: async () => { throw new Error('should not be called') } }
  const res = await S.restoreAll(s, fakeFs)
  assert.deepEqual(res.restored, [])
  assert.deepEqual(res.errors, [])
})

test('restoreAll captures per-path errors without throwing or clearing failed paths', async () => {
  const s = S.makeSession()
  s.recordSnapshot('/ok', 'OK')
  s.recordSnapshot('/bad', 'BAD')
  const fakeFs = {
    writeFile: async (p) => {
      if (p === '/bad') throw new Error('eperm')
    },
  }
  const res = await S.restoreAll(s, fakeFs)
  assert.deepEqual(res.restored, ['/ok'])
  assert.equal(res.errors.length, 1)
  assert.equal(res.errors[0].path, '/bad')
  assert.match(res.errors[0].error, /eperm/)
  // Failed restore stays pending so a retry can pick it up.
  assert.deepEqual(s.pending(), ['/bad'])
})
