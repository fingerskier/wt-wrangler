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
