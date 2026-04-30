'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const R = require('../src/wtStartupRestore')

function memFs(initial) {
  const files = new Map(Object.entries(initial || {}))
  return {
    files,
    async readdir(dir) {
      const norm = dir.replace(/\\/g, '/')
      const prefix = norm.endsWith('/') ? norm : norm + '/'
      const seen = new Set()
      let any = false
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue
        any = true
        const rest = p.slice(prefix.length)
        const head = rest.split(/[\\/]/)[0]
        if (head) seen.add(head)
      }
      if (!any) {
        const err = new Error('ENOENT')
        err.code = 'ENOENT'
        throw err
      }
      return Array.from(seen)
    },
    async readFile(p, _enc) {
      if (!files.has(p)) {
        const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err
      }
      return files.get(p)
    },
    async writeFile(p, data) { files.set(p, data) },
    async unlink(p) {
      if (!files.has(p)) { const err = new Error('ENOENT'); err.code = 'ENOENT'; throw err }
      files.delete(p)
    },
  }
}

test('findBackups returns [] when settingsPath is empty', async () => {
  const fs = memFs({})
  assert.deepEqual(await R.findBackups('', fs), [])
  assert.deepEqual(await R.findBackups(null, fs), [])
})

test('findBackups returns [] when dir read fails', async () => {
  const fs = memFs({})
  assert.deepEqual(await R.findBackups('/nope/settings.json', fs), [])
})

test('findBackups returns [] when no backup files present', async () => {
  const dir = '/wt'
  const settings = `${dir}/settings.json`
  const fs = memFs({ [settings]: '{}', [`${dir}/state.json`]: '{}' })
  assert.deepEqual(await R.findBackups(settings, fs), [])
})

test('findBackups detects siblings sorted oldest→newest', async () => {
  const dir = '/wt'
  const settings = `${dir}/settings.json`
  const a = `${settings}.wtw-backup-2026-04-26T10-00-00-000Z`
  const b = `${settings}.wtw-backup-2026-04-27T17-01-30-977Z`
  const c = `${settings}.wtw-backup-2026-04-25T08-00-00-000Z`
  const fs = memFs({ [settings]: '{}', [a]: 'A', [b]: 'B', [c]: 'C' })
  const out = await R.findBackups(settings, fs)
  assert.equal(out.length, 3)
  assert.equal(out[0].path, c)
  assert.equal(out[2].path, b)
})

test('findBackups ignores files matching prefix but not pattern', async () => {
  const dir = '/wt'
  const settings = `${dir}/settings.json`
  const decoy = `${dir}/settings.json.bak`
  const real = `${settings}.wtw-backup-2026-04-27T17-01-30-977Z`
  const fs = memFs({ [settings]: '{}', [decoy]: 'x', [real]: 'B' })
  const out = await R.findBackups(settings, fs)
  assert.equal(out.length, 1)
  assert.equal(out[0].path, real)
})

test('restoreFromBackup copies bytes from backup to settings', async () => {
  const dir = '/wt'
  const settings = `${dir}/settings.json`
  const backup = `${settings}.wtw-backup-2026-04-27T17-01-30-977Z`
  const fs = memFs({ [settings]: 'PATCHED', [backup]: 'ORIGINAL' })
  await R.restoreFromBackup(settings, backup, fs)
  assert.equal(fs.files.get(settings), 'ORIGINAL')
  // backup is preserved by restoreFromBackup; discard is a separate call.
  assert.equal(fs.files.get(backup), 'ORIGINAL')
})

test('restoreFromBackup throws when args missing', async () => {
  const fs = memFs({})
  await assert.rejects(() => R.restoreFromBackup('', 'b', fs), /required/)
  await assert.rejects(() => R.restoreFromBackup('s', '', fs), /required/)
})

test('discardBackup removes file', async () => {
  const fs = memFs({ '/wt/x.wtw-backup-1': 'B' })
  await R.discardBackup('/wt/x.wtw-backup-1', fs)
  assert.equal(fs.files.has('/wt/x.wtw-backup-1'), false)
})

test('discardBackup tolerates missing file', async () => {
  const fs = memFs({})
  await R.discardBackup('/wt/nope', fs)
})

test('discardAll deletes every path and isolates errors', async () => {
  const fs = memFs({ '/a': '1', '/b': '2' })
  const orig = fs.unlink.bind(fs)
  fs.unlink = async (p) => { if (p === '/b') throw new Error('boom'); return orig(p) }
  const out = await R.discardAll(['/a', '/b'], fs)
  assert.equal(fs.files.has('/a'), false)
  assert.equal(out.errors.length, 1)
  assert.equal(out.errors[0].path, '/b')
})

test('parseBackupStamp returns the timestamp tail or null', () => {
  assert.equal(R.parseBackupStamp('settings.json.wtw-backup-2026-04-27T17-01-30-977Z', 'settings.json'), '2026-04-27T17-01-30-977Z')
  assert.equal(R.parseBackupStamp('settings.json.bak', 'settings.json'), null)
  assert.equal(R.parseBackupStamp('other.wtw-backup-x', 'settings.json'), null)
})

test('cleanupBackupsFor removes every .wtw-backup sibling and reports count', async () => {
  const dir = '/wt'
  const settings = `${dir}/settings.json`
  const a = `${settings}.wtw-backup-2026-04-26T10-00-00-000Z`
  const b = `${settings}.wtw-backup-2026-04-27T17-01-30-977Z`
  const fs = memFs({ [settings]: '{}', [a]: 'A', [b]: 'B' })
  const out = await R.cleanupBackupsFor(settings, fs)
  assert.equal(out.discarded, 2)
  assert.deepEqual(out.errors, [])
  assert.equal(fs.files.has(a), false)
  assert.equal(fs.files.has(b), false)
  assert.equal(fs.files.has(settings), true)
})

test('cleanupBackupsFor no-ops when no backups exist', async () => {
  const dir = '/wt'
  const settings = `${dir}/settings.json`
  const fs = memFs({ [settings]: '{}' })
  const out = await R.cleanupBackupsFor(settings, fs)
  assert.equal(out.discarded, 0)
  assert.deepEqual(out.errors, [])
})

// --- surgicalRestoreFromBackup ---------------------------------------------

const WIN_KEYS = ['useMica', 'showTabsInTitlebar', 'useAcrylicInTabRow']

test('surgicalRestoreFromBackup reverts only window keys, leaves other keys intact', async () => {
  const dir = '/wt'
  const settings = `${dir}/settings.json`
  const backup = `${settings}.wtw-backup-2026-04-29T14-12-04-026Z`
  const backupRaw = '{"useMica":false,"showTabsInTitlebar":true,"profiles":{"list":[{"name":"pwsh"}]}}'
  // Current has Wrangler's patches AND a fresh user-added scheme + profile that must survive.
  const currentRaw = '{"useMica":true,"showTabsInTitlebar":false,"profiles":{"list":[{"name":"pwsh"},{"name":"new-user-profile"}]},"schemes":[{"name":"USER-NEW"}]}'
  const fs = memFs({ [settings]: currentRaw, [backup]: backupRaw })
  const out = await R.surgicalRestoreFromBackup(settings, backup, fs, WIN_KEYS)
  assert.equal(out.mode, 'surgical')
  assert.equal(out.changed, true)
  const written = JSON.parse(fs.files.get(settings))
  assert.equal(written.useMica, false)
  assert.equal(written.showTabsInTitlebar, true)
  assert.equal(written.profiles.list.length, 2)
  assert.deepEqual(written.schemes, [{ name: 'USER-NEW' }])
})

test('surgicalRestoreFromBackup deletes keys present in current but absent in backup', async () => {
  const dir = '/wt'
  const settings = `${dir}/settings.json`
  const backup = `${settings}.wtw-backup-stamp`
  const backupRaw = '{}' // no useMica originally
  const currentRaw = '{"useMica":true,"otherUserKey":"keep-me"}'
  const fs = memFs({ [settings]: currentRaw, [backup]: backupRaw })
  await R.surgicalRestoreFromBackup(settings, backup, fs, WIN_KEYS)
  const written = JSON.parse(fs.files.get(settings))
  assert.equal('useMica' in written, false)
  assert.equal(written.otherUserKey, 'keep-me')
})

test('surgicalRestoreFromBackup falls back to bulk write when JSON parse fails', async () => {
  const dir = '/wt'
  const settings = `${dir}/settings.json`
  const backup = `${settings}.wtw-backup-stamp`
  const backupRaw = '{"useMica":false}'
  const currentRaw = 'not valid json {{{'
  const fs = memFs({ [settings]: currentRaw, [backup]: backupRaw })
  const out = await R.surgicalRestoreFromBackup(settings, backup, fs, WIN_KEYS)
  assert.equal(out.mode, 'bulk')
  assert.equal(fs.files.get(settings), backupRaw)
})

test('surgicalRestoreFromBackup no-ops when window-keys already match backup', async () => {
  const dir = '/wt'
  const settings = `${dir}/settings.json`
  const backup = `${settings}.wtw-backup-stamp`
  const backupRaw = '{"useMica":false,"profiles":[{"name":"a"}]}'
  // Current has same useMica as backup but a different non-window-key (user added).
  const currentRaw = '{"useMica":false,"profiles":[{"name":"a"},{"name":"b"}]}'
  const fs = memFs({ [settings]: currentRaw, [backup]: backupRaw })
  const out = await R.surgicalRestoreFromBackup(settings, backup, fs, WIN_KEYS)
  assert.equal(out.mode, 'surgical')
  assert.equal(out.changed, false)
  // Current must be unchanged
  assert.equal(fs.files.get(settings), currentRaw)
})

test('cleanupBackupsFor isolates per-file unlink failures', async () => {
  const dir = '/wt'
  const settings = `${dir}/settings.json`
  const a = `${settings}.wtw-backup-2026-04-26T10-00-00-000Z`
  const b = `${settings}.wtw-backup-2026-04-27T17-01-30-977Z`
  const fs = memFs({ [settings]: '{}', [a]: 'A', [b]: 'B' })
  const orig = fs.unlink.bind(fs)
  fs.unlink = async (p) => { if (p === b) throw new Error('boom'); return orig(p) }
  const out = await R.cleanupBackupsFor(settings, fs)
  assert.equal(out.discarded, 1)
  assert.equal(out.errors.length, 1)
  assert.equal(out.errors[0].path, b)
  assert.equal(fs.files.has(a), false)
  assert.equal(fs.files.has(b), true)
})
