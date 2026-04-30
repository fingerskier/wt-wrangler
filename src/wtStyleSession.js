'use strict'

// In-memory tracker for WT settings.json patches applied during a Wrangler
// session. First write per path is preserved as the "original" so restoreAll
// can put it back when the app quits.
//
// API tiers (older callers stay valid):
//   recordSnapshot(path, original)
//     Legacy: unconditional write of `original` on quit.
//   recordSnapshot(path, original, patched)
//     R3.8 / spec #2197 byte-compare: restore only when current === patched;
//     otherwise SKIP (treat as externally modified, user content authoritative).
//   recordSnapshot(path, original, patched, keyDelta)
//     Tier-2 surgical: keyDelta describes the specific top-level keys we
//     patched, with their pre-patch values. restoreAll parses current disk
//     content, reverts only the keys we own (those still equal to `patched`),
//     and leaves everything else (WT defaults-fill, user color schemes, etc.)
//     alone. Falls through to byte-compare when current === patched (preserves
//     comments via originalRaw write).

function makeSession() {
  // path → { original, patched?, keyDelta? }
  const snapshots = new Map()
  return {
    recordSnapshot(path, original, patched, keyDelta) {
      // First call wins for `original`. `patched` and `keyDelta` update on
      // each call so the latest write is what we compare against.
      const haveDelta = keyDelta && typeof keyDelta === 'object' && Object.keys(keyDelta).length > 0
      if (!snapshots.has(path)) {
        snapshots.set(path, { original, patched, keyDelta: haveDelta ? keyDelta : undefined })
      } else {
        const e = snapshots.get(path)
        if (patched !== undefined) e.patched = patched
        if (haveDelta) e.keyDelta = keyDelta
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
    getKeyDelta(path) {
      const e = snapshots.get(path)
      return e ? e.keyDelta : undefined
    },
    forget(path) {
      snapshots.delete(path)
    },
    pending() {
      return Array.from(snapshots.keys())
    },
  }
}

function tryParseJson(s) {
  try { return JSON.parse(s) } catch (_) { return undefined }
}

async function restoreAll(session, fs) {
  const restored = []
  const skipped = []
  const errors = []

  for (const path of session.pending()) {
    const original = session.getSnapshot(path)
    const expected = session.getPatched(path)
    const delta = session.getKeyDelta(path)

    // Legacy: no patched recorded → unconditional restore.
    if (expected === undefined) {
      try {
        await fs.writeFile(path, original, 'utf8')
        session.forget(path)
        restored.push(path)
      } catch (err) {
        errors.push({ path, error: err && err.message ? err.message : String(err) })
      }
      continue
    }

    // Read current disk content for either the byte-compare or surgical paths.
    let current
    try {
      current = await fs.readFile(path, 'utf8')
    } catch (err) {
      errors.push({ path, error: err && err.message ? err.message : String(err) })
      continue
    }

    // Fast path — current matches what we wrote: no external rewrite, no user
    // edit. Write original raw bytes (preserves comments). Works for both
    // 3-arg and 4-arg callers.
    if (current === expected) {
      try {
        await fs.writeFile(path, original, 'utf8')
        session.forget(path)
        restored.push(path)
      } catch (err) {
        errors.push({ path, error: err && err.message ? err.message : String(err) })
      }
      continue
    }

    // 3-arg byte-compare path (no keyDelta) — current ≠ patched means the file
    // was modified after our write. Spec #2197: skip and forget.
    if (!delta) {
      skipped.push({ path, reason: 'externally modified' })
      session.forget(path)
      continue
    }

    // Tier-2 surgical path — current ≠ patched, but we have per-key info.
    // Try to parse current; if it parses, revert only the keys we own that
    // still equal what we last wrote.
    const parsed = tryParseJson(current)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      skipped.push({ path, reason: 'unparseable current content' })
      session.forget(path)
      continue
    }

    const ours = []
    const theirs = []
    for (const k of Object.keys(delta)) {
      if (parsed[k] === delta[k].patched) ours.push(k)
      else theirs.push(k)
    }

    if (ours.length === 0) {
      skipped.push({ path, reason: 'all keys externally modified: ' + theirs.join(', ') })
      session.forget(path)
      continue
    }

    for (const k of ours) {
      if (delta[k].had) parsed[k] = delta[k].original
      else delete parsed[k]
    }

    try {
      await fs.writeFile(path, JSON.stringify(parsed, null, 4) + '\n', 'utf8')
      session.forget(path)
      restored.push(path)
      if (theirs.length) {
        skipped.push({ path, reason: 'partial: keys externally modified: ' + theirs.join(', ') })
      }
    } catch (err) {
      errors.push({ path, error: err && err.message ? err.message : String(err) })
    }
  }

  return { restored, skipped, errors }
}

module.exports = { makeSession, restoreAll }
