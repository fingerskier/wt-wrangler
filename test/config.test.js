'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { makeStore } = require('../src/config')

async function mkTmp() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'wtw-cfg-'))
}

test('read returns {} when file missing', async () => {
  const dir = await mkTmp()
  const store = makeStore(dir)
  assert.deepEqual(await store.read(), {})
  assert.deepEqual(store.readSync(), {})
})

test('write creates file and merges subsequent patches', async () => {
  const dir = await mkTmp()
  const store = makeStore(dir)
  await store.write({ lastDir: 'C:\\a' })
  assert.equal((await store.read()).lastDir, 'C:\\a')
  await store.write({ somethingElse: 42 })
  const merged = await store.read()
  assert.equal(merged.lastDir, 'C:\\a')
  assert.equal(merged.somethingElse, 42)
})

test('write creates userDataDir if missing', async () => {
  const dir = path.join(os.tmpdir(), `wtw-cfg-new-${Date.now()}`)
  assert.ok(!fs.existsSync(dir))
  const store = makeStore(dir)
  await store.write({ lastDir: 'X' })
  assert.ok(fs.existsSync(path.join(dir, 'config.json')))
})

test('read returns {} when file contains junk', async () => {
  const dir = await mkTmp()
  await fsp.writeFile(path.join(dir, 'config.json'), 'not json', 'utf8')
  const store = makeStore(dir)
  assert.deepEqual(await store.read(), {})
})

// --- R3.2: concurrent-write race -------------------------------------------

test('concurrent writes both land in the final config (no clobbering)', async () => {
  const dir = await mkTmp()
  const store = makeStore(dir)
  // Fire both writes simultaneously. Without serialization both reads see {}
  // and the later writeFile clobbers the earlier patch.
  await Promise.all([
    store.write({ a: 1 }),
    store.write({ b: 2 }),
  ])
  const final = await store.read()
  assert.deepEqual(final, { a: 1, b: 2 }, 'both patches must survive')
})

test('many concurrent writes preserve every key', async () => {
  const dir = await mkTmp()
  const store = makeStore(dir)
  const writes = []
  for (let i = 0; i < 20; i++) {
    writes.push(store.write({ [`k${i}`]: i }))
  }
  await Promise.all(writes)
  const final = await store.read()
  for (let i = 0; i < 20; i++) {
    assert.equal(final[`k${i}`], i, `k${i} should be ${i}, got ${final[`k${i}`]}`)
  }
})

test('concurrent write to same key uses last-scheduled value (serialized order)', async () => {
  const dir = await mkTmp()
  const store = makeStore(dir)
  // Both target the same key — last enqueued wins after serialization.
  const p1 = store.write({ x: 'first' })
  const p2 = store.write({ x: 'second' })
  await Promise.all([p1, p2])
  const final = await store.read()
  assert.equal(final.x, 'second')
})
