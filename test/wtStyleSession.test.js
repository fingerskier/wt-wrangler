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

// --- R3.8: external-edit detection ------------------------------------------

test('recordSnapshot accepts a patched-content arg, retrievable via getPatched', () => {
  const s = S.makeSession()
  s.recordSnapshot('/x/settings.json', 'ORIGINAL', 'PATCHED')
  assert.equal(s.getSnapshot('/x/settings.json'), 'ORIGINAL')
  assert.equal(s.getPatched('/x/settings.json'), 'PATCHED')
})

test('getPatched returns undefined when no patched content was recorded', () => {
  const s = S.makeSession()
  s.recordSnapshot('/x', 'ORIGINAL')
  assert.equal(s.getPatched('/x'), undefined)
})

test('restoreAll restores when current content matches what we last wrote', async () => {
  const s = S.makeSession()
  s.recordSnapshot('/x/settings.json', 'ORIGINAL', 'PATCHED')
  const writes = []
  const fakeFs = {
    readFile: async () => 'PATCHED', // current content matches our patched write — no external edit
    writeFile: async (p, c) => { writes.push({ p, c }) },
  }
  const res = await S.restoreAll(s, fakeFs)
  assert.deepEqual(writes, [{ p: '/x/settings.json', c: 'ORIGINAL' }])
  assert.deepEqual(res.restored, ['/x/settings.json'])
  assert.deepEqual(res.skipped, [])
})

test('restoreAll SKIPS write when file was externally modified after our patch', async () => {
  const s = S.makeSession()
  s.recordSnapshot('/x/settings.json', 'ORIGINAL', 'PATCHED')
  let writeCalled = false
  const fakeFs = {
    readFile: async () => 'USER-EDITED-AFTER-PATCH', // ≠ what we wrote
    writeFile: async () => { writeCalled = true },
  }
  const res = await S.restoreAll(s, fakeFs)
  assert.equal(writeCalled, false, 'must not overwrite externally-modified file')
  assert.deepEqual(res.restored, [])
  assert.equal(res.skipped.length, 1)
  assert.equal(res.skipped[0].path, '/x/settings.json')
  assert.match(res.skipped[0].reason, /external/i)
  // After skipping, the path is forgotten — user's content is now authoritative.
  assert.deepEqual(s.pending(), [])
})

test('restoreAll: readFile failure during external-edit check goes to errors[]', async () => {
  const s = S.makeSession()
  s.recordSnapshot('/x/settings.json', 'ORIGINAL', 'PATCHED')
  const fakeFs = {
    readFile: async () => { throw new Error('ENOENT: file gone') },
    writeFile: async () => { throw new Error('should not be called') },
  }
  const res = await S.restoreAll(s, fakeFs)
  assert.deepEqual(res.restored, [])
  assert.deepEqual(res.skipped, [])
  assert.equal(res.errors.length, 1)
  assert.match(res.errors[0].error, /ENOENT/)
  // Failed read leaves snapshot pending so a future retry can attempt again.
  assert.deepEqual(s.pending(), ['/x/settings.json'])
})

test('restoreAll without patched recorded falls back to unconditional write (backward compat)', async () => {
  const s = S.makeSession()
  s.recordSnapshot('/legacy', 'ORIGINAL') // no patched arg
  let readCalled = false
  const writes = []
  const fakeFs = {
    readFile: async () => { readCalled = true; return 'whatever' },
    writeFile: async (p, c) => { writes.push({ p, c }) },
  }
  const res = await S.restoreAll(s, fakeFs)
  assert.equal(readCalled, false, 'should not read when no patched recorded')
  assert.deepEqual(writes, [{ p: '/legacy', c: 'ORIGINAL' }])
  assert.deepEqual(res.restored, ['/legacy'])
})

test('mixed: one path with patched (skipped) + one without (restored) — independent handling', async () => {
  const s = S.makeSession()
  s.recordSnapshot('/with-patched', 'O1', 'P1')
  s.recordSnapshot('/no-patched', 'O2')
  const writes = []
  const fakeFs = {
    readFile: async () => 'EXTERNALLY-MODIFIED',
    writeFile: async (p, c) => { writes.push({ p, c }) },
  }
  const res = await S.restoreAll(s, fakeFs)
  assert.deepEqual(writes, [{ p: '/no-patched', c: 'O2' }])
  assert.deepEqual(res.restored, ['/no-patched'])
  assert.equal(res.skipped.length, 1)
  assert.equal(res.skipped[0].path, '/with-patched')
})
