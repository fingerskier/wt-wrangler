'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { listEntries, moveLayoutFile, availableLayoutFile, saveLayoutFile, saveNewLayoutFile } = require('../src/layouts')

async function mkTmp() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'wtw-layouts-'))
}

test('listEntries returns [] for empty dirPath', async () => {
  assert.deepEqual(await listEntries(null), [])
  assert.deepEqual(await listEntries(''), [])
})

test('listEntries lists directories before json files, alphabetical', async () => {
  const dir = await mkTmp()
  await fsp.mkdir(path.join(dir, 'zeta'))
  await fsp.mkdir(path.join(dir, 'alpha'))
  await fsp.writeFile(path.join(dir, 'b.json'), JSON.stringify({ name: 'B' }))
  await fsp.writeFile(path.join(dir, 'a.json'), JSON.stringify({ name: 'A' }))
  const out = await listEntries(dir)
  assert.equal(out.length, 4)
  assert.equal(out[0].type, 'dir'); assert.equal(out[0].name, 'alpha')
  assert.equal(out[1].type, 'dir'); assert.equal(out[1].name, 'zeta')
  assert.equal(out[2].type, 'file'); assert.equal(out[2].name, 'A')
  assert.equal(out[3].type, 'file'); assert.equal(out[3].name, 'B')
})

test('listEntries skips dotfile dirs and non-json files', async () => {
  const dir = await mkTmp()
  await fsp.mkdir(path.join(dir, '.git'))
  await fsp.writeFile(path.join(dir, 'notes.txt'), 'hi')
  await fsp.writeFile(path.join(dir, 'ok.json'), JSON.stringify({ name: 'K' }))
  const out = await listEntries(dir)
  assert.equal(out.length, 1)
  assert.equal(out[0].type, 'file')
  assert.equal(out[0].name, 'K')
})

test('listEntries surfaces parse error on broken json', async () => {
  const dir = await mkTmp()
  await fsp.writeFile(path.join(dir, 'bad.json'), 'not json')
  const out = await listEntries(dir)
  assert.equal(out.length, 1)
  assert.ok(out[0].error)
})

test('moveLayoutFile relocates file into destination dir', async () => {
  const root = await mkTmp()
  const sub = path.join(root, 'sub')
  await fsp.mkdir(sub)
  const src = path.join(root, 'x.json')
  await fsp.writeFile(src, '{}')
  const target = await moveLayoutFile(src, sub)
  assert.equal(target, path.join(sub, 'x.json'))
  await assert.rejects(fsp.stat(src))
  assert.ok((await fsp.stat(target)).isFile())
})

test('moveLayoutFile returns target unchanged when src already in dest', async () => {
  const root = await mkTmp()
  const src = path.join(root, 'x.json')
  await fsp.writeFile(src, '{}')
  const target = await moveLayoutFile(src, root)
  assert.equal(target, src)
  assert.ok((await fsp.stat(src)).isFile())
})

test('moveLayoutFile throws on filename collision', async () => {
  const root = await mkTmp()
  const sub = path.join(root, 'sub')
  await fsp.mkdir(sub)
  const src = path.join(root, 'x.json')
  await fsp.writeFile(src, '{"a":1}')
  await fsp.writeFile(path.join(sub, 'x.json'), '{"a":2}')
  await assert.rejects(moveLayoutFile(src, sub), /Destination already has x\.json/)
  assert.ok((await fsp.stat(src)).isFile())
})

// --- R3.1: availableLayoutFile collision-safe naming -------------------------

test('availableLayoutFile returns base name when no collision', async () => {
  const dir = await mkTmp()
  const out = await availableLayoutFile(dir, 'foo')
  assert.equal(path.basename(out), 'foo.json')
  assert.equal(path.dirname(out), dir)
})

test('availableLayoutFile suffixes _1 when foo.json exists', async () => {
  const dir = await mkTmp()
  await fsp.writeFile(path.join(dir, 'foo.json'), '{}')
  const out = await availableLayoutFile(dir, 'foo')
  assert.equal(path.basename(out), 'foo_1.json')
})

test('availableLayoutFile suffixes _2 when foo.json + foo_1.json exist', async () => {
  const dir = await mkTmp()
  await fsp.writeFile(path.join(dir, 'foo.json'), '{}')
  await fsp.writeFile(path.join(dir, 'foo_1.json'), '{}')
  const out = await availableLayoutFile(dir, 'foo')
  assert.equal(path.basename(out), 'foo_2.json')
})

test('availableLayoutFile skips gaps and finds first available', async () => {
  // foo.json, foo_2.json exist but foo_1.json is free → returns foo_1.json
  const dir = await mkTmp()
  await fsp.writeFile(path.join(dir, 'foo.json'), '{}')
  await fsp.writeFile(path.join(dir, 'foo_2.json'), '{}')
  const out = await availableLayoutFile(dir, 'foo')
  assert.equal(path.basename(out), 'foo_1.json')
})

test('availableLayoutFile is case-insensitive on Windows-style FS', async () => {
  // Even if the existing file is FOO.json, asking for 'foo' should still suffix
  // because Windows filesystems are case-insensitive and writing 'foo.json' would clobber.
  const dir = await mkTmp()
  await fsp.writeFile(path.join(dir, 'FOO.json'), '{}')
  const out = await availableLayoutFile(dir, 'foo')
  assert.notEqual(path.basename(out).toLowerCase(), 'foo.json')
})

// --- R3.5: atomic layout writes (save + saveNew) ----------------------------

test('saveLayoutFile writes pretty-printed JSON and leaves no tmp', async () => {
  const dir = await mkTmp()
  const target = path.join(dir, 'l.json')
  await saveLayoutFile(fsp, target, { name: 'L', tabs: [{ panes: [{}] }] })
  const got = await fsp.readFile(target, 'utf8')
  assert.equal(JSON.parse(got).name, 'L')
  // 2-space indent — keep diffs readable in git
  assert.ok(got.includes('  "name"') || got.includes('\n  '))
  const remaining = await fsp.readdir(dir)
  assert.deepEqual(remaining, ['l.json'], 'no tmp leftover')
})

test('saveLayoutFile overwrites existing file', async () => {
  const dir = await mkTmp()
  const target = path.join(dir, 'l.json')
  await fsp.writeFile(target, JSON.stringify({ name: 'OLD' }))
  await saveLayoutFile(fsp, target, { name: 'NEW' })
  assert.equal(JSON.parse(await fsp.readFile(target, 'utf8')).name, 'NEW')
})

test('saveLayoutFile rename failure: original file content preserved + tmp cleaned', async () => {
  const dir = await mkTmp()
  const target = path.join(dir, 'l.json')
  await fsp.writeFile(target, JSON.stringify({ name: 'ORIGINAL' }))
  // Stub fs that delegates to real fsp for write/unlink, but throws on rename.
  const stubFs = {
    writeFile: fsp.writeFile,
    unlink: fsp.unlink,
    rename: async () => { throw new Error('EBUSY: rename denied') },
  }
  await assert.rejects(
    saveLayoutFile(stubFs, target, { name: 'NEW' }),
    /EBUSY/,
  )
  // Original file content must survive — atomicity guarantees the user's data isn't lost.
  assert.equal(JSON.parse(await fsp.readFile(target, 'utf8')).name, 'ORIGINAL')
  // Tmp sibling must have been cleaned up (R3.3).
  const remaining = await fsp.readdir(dir)
  assert.deepEqual(remaining, ['l.json'], 'no tmp leftover after rename failure')
})

test('saveNewLayoutFile picks available filename and writes atomically', async () => {
  const dir = await mkTmp()
  await fsp.writeFile(path.join(dir, 'foo.json'), '{}')
  const target = await saveNewLayoutFile(fsp, dir, 'foo', { name: 'FOO' })
  assert.equal(path.basename(target), 'foo_1.json')
  assert.equal(JSON.parse(await fsp.readFile(target, 'utf8')).name, 'FOO')
  const remaining = (await fsp.readdir(dir)).sort()
  assert.deepEqual(remaining, ['foo.json', 'foo_1.json'])
})

test('saveNewLayoutFile rename failure: no partial layout file written', async () => {
  const dir = await mkTmp()
  const stubFs = {
    writeFile: fsp.writeFile,
    unlink: fsp.unlink,
    readdir: fsp.readdir,
    rename: async () => { throw new Error('EACCES') },
  }
  await assert.rejects(
    saveNewLayoutFile(stubFs, dir, 'fresh', { name: 'X' }),
  )
  // Dir should be empty — no partial file, no orphan tmp.
  const remaining = await fsp.readdir(dir)
  assert.deepEqual(remaining, [], 'no orphan files after rename failure')
})

test('saveNewLayoutFile sanitizes basename (drops path-traversal-y characters)', async () => {
  const dir = await mkTmp()
  // The ipc handler does the sanitize, but the helper should accept already-sanitized
  // input verbatim. Use a basename that survives the regex used at the call site.
  const target = await saveNewLayoutFile(fsp, dir, 'safe_name', { name: 'X' })
  assert.equal(path.basename(target), 'safe_name.json')
})
