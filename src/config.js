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

  // Serialize writes through a promise chain so concurrent callers don't
  // race read→spread→write and silently clobber each other's patches.
  let writeQueue = Promise.resolve()
  function write(patch) {
    const next = writeQueue.then(async () => {
      await fsp.mkdir(userDataDir, { recursive: true })
      const current = await read()
      const merged = { ...current, ...patch }
      await fsp.writeFile(file, JSON.stringify(merged, null, 2), 'utf8')
      return merged
    })
    // Don't let one rejection poison the queue.
    writeQueue = next.catch(() => {})
    return next
  }

  return { file, read, readSync, write }
}

module.exports = { makeStore }
