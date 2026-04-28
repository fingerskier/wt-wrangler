'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { writeFileAtomic } = require('../src/atomicWrite')

async function mkTmp() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'wtw-atom-'))
}

// --- happy path: real fs ----------------------------------------------------

test('writes content and leaves no tmp file on success', async () => {
  const dir = await mkTmp()
  const target = path.join(dir, 'final.json')
  await writeFileAtomic(fsp, target, '{"a":1}')
  const got = await fsp.readFile(target, 'utf8')
  assert.equal(got, '{"a":1}')
  const remaining = await fsp.readdir(dir)
  assert.deepEqual(remaining, ['final.json'], 'no tmp leftover in dir')
})

test('overwrites existing target', async () => {
  const dir = await mkTmp()
  const target = path.join(dir, 'final.json')
  await fsp.writeFile(target, 'old', 'utf8')
  await writeFileAtomic(fsp, target, 'new')
  assert.equal(await fsp.readFile(target, 'utf8'), 'new')
})

// --- rename failure: tmp must be cleaned up ---------------------------------

function stubFs(overrides) {
  const calls = { writeFile: [], rename: [], unlink: [] }
  return {
    calls,
    writeFile: async (p, c) => { calls.writeFile.push(p); if (overrides.writeFile) return overrides.writeFile(p, c) },
    rename: async (s, d) => { calls.rename.push([s, d]); if (overrides.rename) return overrides.rename(s, d) },
    unlink: async (p) => { calls.unlink.push(p); if (overrides.unlink) return overrides.unlink(p) },
  }
}

test('rename failure unlinks the tmp file', async () => {
  const fakeFs = stubFs({
    rename: () => { throw new Error('EACCES: rename denied') },
  })
  await assert.rejects(
    writeFileAtomic(fakeFs, '/x/final.json', 'data'),
    /EACCES: rename denied/,
  )
  assert.equal(fakeFs.calls.unlink.length, 1, 'unlink called exactly once')
  assert.equal(fakeFs.calls.unlink[0], fakeFs.calls.writeFile[0],
    'unlink targets the same tmp path that was written')
})

test('rename failure propagates the original error', async () => {
  const original = new Error('rename boom')
  const fakeFs = stubFs({ rename: () => { throw original } })
  await assert.rejects(
    writeFileAtomic(fakeFs, '/x/final.json', 'data'),
    err => err === original,
  )
})

test('unlink failure during cleanup does not mask the rename error', async () => {
  const renameErr = new Error('rename boom')
  const fakeFs = stubFs({
    rename: () => { throw renameErr },
    unlink: () => { throw new Error('unlink also boom') },
  })
  await assert.rejects(
    writeFileAtomic(fakeFs, '/x/final.json', 'data'),
    err => err === renameErr,
  )
})

test('writeFile failure does not call rename or unlink', async () => {
  const fakeFs = stubFs({
    writeFile: () => { throw new Error('disk full') },
  })
  await assert.rejects(
    writeFileAtomic(fakeFs, '/x/final.json', 'data'),
    /disk full/,
  )
  assert.equal(fakeFs.calls.rename.length, 0)
  assert.equal(fakeFs.calls.unlink.length, 0)
})

// --- regression: real-fs rename failure leaves no tmp behind ---------------

test('real-fs: rename to a target whose dir is missing leaves no tmp', async () => {
  const dir = await mkTmp()
  // Construct an impossible final path — its parent dir doesn't exist.
  const target = path.join(dir, 'no-such-dir', 'final.json')
  await assert.rejects(writeFileAtomic(fsp, target, 'x'))
  const remaining = await fsp.readdir(dir)
  assert.deepEqual(remaining, [], 'tmp file cleaned up after rename failure')
})

// --- tmp filename uniqueness (best effort) ----------------------------------

test('tmp filename includes pid so concurrent processes do not collide', async () => {
  const fakeFs = stubFs({})
  await writeFileAtomic(fakeFs, '/x/final.json', 'data')
  const tmpPath = fakeFs.calls.writeFile[0]
  assert.match(tmpPath, /\/x\/final\.json\.wtw-tmp-/, 'tmp uses target-prefix sentinel')
  assert.ok(tmpPath.includes(String(process.pid)), 'tmp path includes process pid')
})
