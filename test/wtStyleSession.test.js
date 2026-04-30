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

// --- Tier-2: per-key surgical restore ---------------------------------------

test('recordSnapshot 4-arg stores keyDelta retrievable via getKeyDelta', () => {
  const s = S.makeSession()
  const delta = { useMica: { had: true, original: false, patched: true } }
  s.recordSnapshot('/x', 'ORIG', 'PATCHED', delta)
  assert.deepEqual(s.getKeyDelta('/x'), delta)
})

test('getKeyDelta returns undefined when not recorded', () => {
  const s = S.makeSession()
  s.recordSnapshot('/x', 'ORIG', 'PATCHED')
  assert.equal(s.getKeyDelta('/x'), undefined)
})

test('restoreAll fast-path: current === patched → write originalRaw (preserves comments)', async () => {
  const s = S.makeSession()
  const orig = '{\n  // user comment\n  "useMica": false\n}\n'
  const patched = '{\n    "useMica": true\n}\n'
  s.recordSnapshot('/x', orig, patched, { useMica: { had: true, original: false, patched: true } })
  const writes = []
  const fakeFs = {
    readFile: async () => patched,
    writeFile: async (p, c) => { writes.push({ p, c }) },
  }
  const res = await S.restoreAll(s, fakeFs)
  assert.deepEqual(writes, [{ p: '/x', c: orig }])
  assert.deepEqual(res.restored, ['/x'])
  assert.deepEqual(res.skipped, [])
})

test('restoreAll surgical: WT rewrote settings.json, our keys still equal patched → revert surgically', async () => {
  const s = S.makeSession()
  const orig = '{"useMica":false,"profiles":[]}\n'
  const patched = '{\n    "useMica": true,\n    "profiles": []\n}\n'
  // WT-rewritten: different formatting, added a default key the user didn't have, but our useMica still equals patched
  const current = '{"profiles":[],"useMica":true,"copyOnSelect":false}'
  const delta = { useMica: { had: true, original: false, patched: true } }
  s.recordSnapshot('/x', orig, patched, delta)
  const writes = []
  const fakeFs = {
    readFile: async () => current,
    writeFile: async (p, c) => { writes.push({ p, c }) },
  }
  const res = await S.restoreAll(s, fakeFs)
  assert.equal(writes.length, 1)
  const written = JSON.parse(writes[0].c)
  // Our patched key reverted to original
  assert.equal(written.useMica, false)
  // WT's added key preserved
  assert.equal(written.copyOnSelect, false)
  assert.deepEqual(res.restored, ['/x'])
  assert.deepEqual(res.skipped, [])
})

test('restoreAll surgical: had:false → key gets DELETED, not set to undefined', async () => {
  const s = S.makeSession()
  const orig = '{}'
  const patched = '{\n    "useMica": true\n}\n'
  const current = '{"useMica":true,"otherKey":42}'
  const delta = { useMica: { had: false, patched: true } }
  s.recordSnapshot('/x', orig, patched, delta)
  const writes = []
  const fakeFs = {
    readFile: async () => current,
    writeFile: async (p, c) => { writes.push({ p, c }) },
  }
  await S.restoreAll(s, fakeFs)
  const written = JSON.parse(writes[0].c)
  assert.equal('useMica' in written, false, 'useMica should be removed entirely')
  assert.equal(written.otherKey, 42)
})

test('restoreAll surgical: partial — revert ours, leave theirs, both populated', async () => {
  const s = S.makeSession()
  const orig = '{"useMica":false,"showTabsInTitlebar":true}'
  const patched = '{\n    "useMica": true,\n    "showTabsInTitlebar": false\n}\n'
  // User toggled useMica back to false via WT GUI; showTabsInTitlebar still equals our patch
  const current = '{"useMica":false,"showTabsInTitlebar":false}'
  const delta = {
    useMica: { had: true, original: false, patched: true },
    showTabsInTitlebar: { had: true, original: true, patched: false },
  }
  s.recordSnapshot('/x', orig, patched, delta)
  const writes = []
  const fakeFs = {
    readFile: async () => current,
    writeFile: async (p, c) => { writes.push({ p, c }) },
  }
  const res = await S.restoreAll(s, fakeFs)
  const written = JSON.parse(writes[0].c)
  assert.equal(written.useMica, false, 'user value preserved')
  assert.equal(written.showTabsInTitlebar, true, 'our key reverted to original')
  assert.deepEqual(res.restored, ['/x'])
  assert.equal(res.skipped.length, 1)
  assert.match(res.skipped[0].reason, /useMica/)
})

test('restoreAll surgical: all our keys externally modified → no write, skip', async () => {
  const s = S.makeSession()
  const orig = '{"useMica":false}'
  const patched = '{\n    "useMica": true\n}\n'
  const current = '{"useMica":"weird-user-value"}'
  const delta = { useMica: { had: true, original: false, patched: true } }
  s.recordSnapshot('/x', orig, patched, delta)
  let writeCalled = false
  const fakeFs = {
    readFile: async () => current,
    writeFile: async () => { writeCalled = true },
  }
  const res = await S.restoreAll(s, fakeFs)
  assert.equal(writeCalled, false)
  assert.deepEqual(res.restored, [])
  assert.equal(res.skipped.length, 1)
  assert.deepEqual(s.pending(), [])
})

test('restoreAll surgical: unparseable current JSON → skip, forget', async () => {
  const s = S.makeSession()
  const delta = { useMica: { had: true, original: false, patched: true } }
  s.recordSnapshot('/x', '{}', '{\n    "useMica": true\n}\n', delta)
  let writeCalled = false
  const fakeFs = {
    readFile: async () => 'not valid json {{{',
    writeFile: async () => { writeCalled = true },
  }
  const res = await S.restoreAll(s, fakeFs)
  assert.equal(writeCalled, false)
  assert.deepEqual(res.restored, [])
  assert.equal(res.skipped.length, 1)
  assert.match(res.skipped[0].reason, /unparseable|parse/i)
  assert.deepEqual(s.pending(), [])
})
