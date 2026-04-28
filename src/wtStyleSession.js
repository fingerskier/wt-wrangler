'use strict'

// In-memory tracker for WT settings.json patches applied during a Wrangler session.
// First write per path is preserved as the "original" so restoreAll can put it back
// when the app quits. Pure module — IO is injected.

function makeSession() {
  const snapshots = new Map()
  return {
    recordSnapshot(path, content) {
      if (snapshots.has(path)) return
      snapshots.set(path, content)
    },
    getSnapshot(path) {
      return snapshots.get(path)
    },
    forget(path) {
      snapshots.delete(path)
    },
    pending() {
      return Array.from(snapshots.keys())
    },
  }
}

async function restoreAll(session, fs) {
  const restored = []
  const errors = []
  for (const path of session.pending()) {
    const content = session.getSnapshot(path)
    try {
      await fs.writeFile(path, content, 'utf8')
      session.forget(path)
      restored.push(path)
    } catch (err) {
      errors.push({ path, error: err && err.message ? err.message : String(err) })
    }
  }
  return { restored, errors }
}

module.exports = { makeSession, restoreAll }
