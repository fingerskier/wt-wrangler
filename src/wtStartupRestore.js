'use strict'

// Pure helpers for detecting and restoring lingering `.wtw-backup-<stamp>`
// files left next to a WT settings.json by a prior Wrangler session that
// crashed or was killed before quit-time restoreAll ran.
//
// IO is injected (fs from node:fs/promises) so the module is unit-testable.

const path = require('node:path')

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

module.exports = { findBackups, restoreFromBackup, discardBackup, discardAll, parseBackupStamp }
