'use strict'

// In-memory tracker for WT settings.json patches applied during a Wrangler
// session. First write per path is preserved as the "original" so restoreAll
// can put it back when the app quits. If a `patched` content is also recorded
// (the literal bytes we wrote), restoreAll compares it against current disk
// content — if they differ, we skip the restore so we don't blow away changes
// the user made externally between our patch and quit. Pure module — IO is
// injected.

function makeSession() {
  // path → { original: string, patched?: string }
  const snapshots = new Map()
  return {
    recordSnapshot(path, original, patched) {
      // First call wins for `original` (so subsequent applyStyle runs in the
      // same session don't trample the true pre-Wrangler content). `patched`
      // is updated each call so the latest write is what we compare against.
      if (!snapshots.has(path)) {
        snapshots.set(path, { original, patched })
      } else if (patched !== undefined) {
        snapshots.get(path).patched = patched
      }
    },
    getSnapshot(path) {
      const e = snapshots.get(path)
      return e ? e.original : undefined
    },
    getPatched(path) {
      const e = snapshots.get(path)
      return e ? e.patched : undefined
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
  const skipped = []
  const errors = []
  for (const path of session.pending()) {
    const original = session.getSnapshot(path)
    const expected = session.getPatched(path)
    // External-edit guard: only run when we recorded the patched content.
    // Without it, fall through to unconditional write (preserves prior behavior
    // for any caller that doesn't use the 3-arg recordSnapshot form).
    if (expected !== undefined) {
      let current
      try {
        current = await fs.readFile(path, 'utf8')
      } catch (err) {
        errors.push({ path, error: err && err.message ? err.message : String(err) })
        continue
      }
      if (current !== expected) {
        // User edited the file after our patch — their content is now
        // authoritative. Skip the restore and forget the snapshot so we don't
        // try again on a future quit (e.g. if quit was cancelled).
        skipped.push({ path, reason: 'externally modified' })
        session.forget(path)
        continue
      }
    }
    try {
      await fs.writeFile(path, original, 'utf8')
      session.forget(path)
      restored.push(path)
    } catch (err) {
      errors.push({ path, error: err && err.message ? err.message : String(err) })
    }
  }
  return { restored, skipped, errors }
}

module.exports = { makeSession, restoreAll }
