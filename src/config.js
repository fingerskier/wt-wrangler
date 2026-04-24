'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')

function makeStore(userDataDir) {
  const file = path.join(userDataDir, 'config.json')

  function readSync() {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const data = JSON.parse(raw)
      return data && typeof data === 'object' ? data : {}
    } catch (_) {
      return {}
    }
  }

  async function read() {
    try {
      const raw = await fsp.readFile(file, 'utf8')
      const data = JSON.parse(raw)
      return data && typeof data === 'object' ? data : {}
    } catch (_) {
      return {}
    }
  }

  async function write(patch) {
    await fsp.mkdir(userDataDir, { recursive: true })
    const current = await read()
    const next = { ...current, ...patch }
    await fsp.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
    return next
  }

  return { file, read, readSync, write }
}

module.exports = { makeStore }
