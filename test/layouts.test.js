'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { listEntries, moveLayoutFile } = require('../src/layouts')

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
