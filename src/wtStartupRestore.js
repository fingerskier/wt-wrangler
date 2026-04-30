'use strict'

// Pure helpers for detecting and restoring lingering `.wtw-backup-<stamp>`
// files left next to a WT settings.json by a prior Wrangler session that
// crashed or was killed before quit-time restoreAll ran.
//
// IO is injected (fs from node:fs/promises) so the module is unit-testable.

const path = require('node:path')
const { parseJsonc } = require('./wtProfiles')

const BACKUP_RE = /\.wtw-backup-(.+)$/

function parseBackupStamp(filename, settingsBase) {
  if (!filename.startsWith(settingsBase + '.wtw-backup-')) return null
  const m = filename.slice(settingsBase.length).match(BACKUP_RE)
  return m ? m[1] : null
}

function joinPath(dir, name) {
  if (dir.includes('\\') && !dir.includes('/')) return dir + '\\' + name
  if (dir.endsWith('/') || dir.endsWith('\\')) return dir + name
  return dir + '/' + name
}

async function findBackups(settingsPath, fs) {
  if (!settingsPath || typeof settingsPath !== 'string') return []
  const dir = path.dirname(settingsPath)
  const base = path.basename(settingsPath)
  let names
  try {
    names = await fs.readdir(dir)
  } catch (_) {
    return []
  }
  const out = []
  for (const name of names) {
    const stamp = parseBackupStamp(name, base)
    if (stamp) out.push({ path: joinPath(dir, name), stamp })
  }
  // Newest stamp last (lex sort works for ISO timestamps with `:` → `-`).
  out.sort((a, b) => (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : 0))
  return out
}

async function restoreFromBackup(settingsPath, backupPath, fs) {
  if (!settingsPath || !backupPath) throw new Error('settingsPath and backupPath required')
  const data = await fs.readFile(backupPath, 'utf8')
  await fs.writeFile(settingsPath, data, 'utf8')
}

async function discardBackup(backupPath, fs) {
  if (!backupPath) return
  try {
    await fs.unlink(backupPath)
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err
  }
}

async function discardAll(backupPaths, fs) {
  const errors = []
  for (const p of backupPaths) {
    try { await discardBackup(p, fs) } catch (err) { errors.push({ path: p, error: err.message || String(err) }) }
  }
  return { errors }
}

// Surgically restore only the window-level keys Wrangler patches (e.g.
// useMica) by computing the delta between the backup and current settings.json
// at click time. Preserves anything the user added between Wrangler's patch
// and the popup click (color schemes, new profiles, fresh top-level keys).
//
// Falls back to a bulk write of the backup when either side fails to parse —
// matches legacy behavior so a corrupted state still restores something.
async function surgicalRestoreFromBackup(settingsPath, backupPath, fs, windowKeys) {
  if (!settingsPath || !backupPath) throw new Error('settingsPath and backupPath required')
  const backupRaw = await fs.readFile(backupPath, 'utf8')
  let currentRaw = ''
  try { currentRaw = await fs.readFile(settingsPath, 'utf8') } catch (_) { currentRaw = '' }
  let backupParsed, currentParsed
  try {
    backupParsed = parseJsonc(backupRaw)
    currentParsed = parseJsonc(currentRaw)
  } catch (_) {
    await fs.writeFile(settingsPath, backupRaw, 'utf8')
    return { mode: 'bulk' }
  }
  if (!backupParsed || typeof backupParsed !== 'object' || Array.isArray(backupParsed) ||
      !currentParsed || typeof currentParsed !== 'object' || Array.isArray(currentParsed)) {
    await fs.writeFile(settingsPath, backupRaw, 'utf8')
    return { mode: 'bulk' }
  }
  const keys = Array.isArray(windowKeys) ? windowKeys : []
  let changed = false
  for (const k of keys) {
    const backupHad = Object.prototype.hasOwnProperty.call(backupParsed, k)
    const currentHas = Object.prototype.hasOwnProperty.call(currentParsed, k)
    if (backupHad && currentHas && backupParsed[k] === currentParsed[k]) continue
    if (backupHad) {
      currentParsed[k] = backupParsed[k]
      changed = true
    } else if (currentHas) {
      delete currentParsed[k]
      changed = true
    }
  }
  if (changed) {
    await fs.writeFile(settingsPath, JSON.stringify(currentParsed, null, 4) + '\n', 'utf8')
  }
  return { mode: 'surgical', changed }
}

// Discard every `.wtw-backup-<stamp>` sibling next to settingsPath. Used by the
// quit-time flow after a successful in-memory restoreAll so disk backups don't
// linger as orphans that re-trigger the startup restore prompt next launch.
async function cleanupBackupsFor(settingsPath, fs) {
  const backups = await findBackups(settingsPath, fs)
  if (!backups.length) return { discarded: 0, errors: [] }
  const out = await discardAll(backups.map(b => b.path), fs)
  return { discarded: backups.length - out.errors.length, errors: out.errors }
}

module.exports = { findBackups, restoreFromBackup, surgicalRestoreFromBackup, discardBackup, discardAll, parseBackupStamp, cleanupBackupsFor }
