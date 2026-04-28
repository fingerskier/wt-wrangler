'use strict'

const path = require('node:path')
const { buildWtArgv, buildWtCommand } = require('./wtCommand')
const { discoverProfiles, parseJsonc, candidateSettingsPaths } = require('./wtProfiles')
const styleApply = require('./wtStyleApply')
const { listEntries, moveLayoutFile, availableLayoutFile } = require('./layouts')
const { validateLayout } = require('./layoutSchema')
const { fragmentFileName, styleHash, staleFragmentFiles } = require('./wtFragments')
const { classifyGitError } = require('./ghUpdate')
const { writeFileAtomic } = require('./atomicWrite')
const appSettings = require('./appSettings')

const FRAGMENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function register(deps) {
  const {
    ipcMain,
    dialog,
    shell,
    fs,
    fsSync,
    spawn,
    store,
    getMainWindow,
    env,
    styleSession, // optional; only needed for snapshot capture in main process
  } = deps

  function fragmentDir() {
    const localAppData = (env && env.LOCALAPPDATA) || ''
    if (!localAppData) return null
    return path.join(localAppData, 'Microsoft', 'Windows Terminal', 'Fragments', 'wt-wrangler')
  }

  async function writeFragmentFile(layout, fragment) {
    const dir = fragmentDir()
    if (!dir) throw new Error('LOCALAPPDATA not set')
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, fragmentFileName(layout))
    await writeFileAtomic(fs, file, JSON.stringify(fragment, null, 2) + '\n')
    return file
  }

  function findExistingSettingsPath() {
    for (const p of candidateSettingsPaths()) {
      try { if (fsSync && fsSync.existsSync(p)) return p } catch (_) {}
    }
    return null
  }

  async function ensureSettingsBackup(settingsPath) {
    const dir = path.dirname(settingsPath)
    const base = path.basename(settingsPath)
    const existing = await fs.readdir(dir).catch(() => [])
    if (existing.some(n => n.startsWith(`${base}.wtw-backup-`))) return null
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = path.join(dir, `${base}.wtw-backup-${stamp}`)
    await fs.copyFile(settingsPath, backup)
    return backup
  }

  async function applyStyleForLaunch(layout) {
    const style = layout && layout.windowStyle
    const result = { applied: { profile: false, window: false }, fragmentPath: null, settingsPath: null, backupPath: null, mapping: {}, warnings: [] }
    if (!style || (!styleApply.hasProfileStyle(style) && !styleApply.hasWindowStyle(style))) return result

    const settingsPath = findExistingSettingsPath()
    let settings = null
    let settingsRaw = null
    if (settingsPath) {
      try {
        settingsRaw = await fs.readFile(settingsPath, 'utf8')
        settings = parseJsonc(settingsRaw)
      } catch (err) {
        result.warnings.push(`could not parse WT settings.json: ${err.message}`)
      }
    } else {
      result.warnings.push('WT settings.json not found — window-level keys will be skipped')
    }
    result.settingsPath = settingsPath

    if (styleApply.hasProfileStyle(style)) {
      const discriminator = styleHash(layout)
      const { fragment, mapping } = styleApply.buildFragment(layout, settings, discriminator)
      if (fragment) {
        const fragPath = await writeFragmentFile(layout, fragment)
        result.fragmentPath = fragPath
        result.mapping = mapping
        result.applied.profile = true
      }
    }

    if (styleApply.hasWindowStyle(style)) {
      if (!settings || !settingsPath) {
        result.warnings.push('window-level keys (useMica/frame/etc) need settings.json — skipping')
      } else {
        const { settings: nextSettings, changed } = styleApply.applyWindowStyleToSettings(settings, style)
        if (changed) {
          const backup = await ensureSettingsBackup(settingsPath)
          if (backup) result.backupPath = backup
          if (settingsRaw !== null && styleSession) styleSession.recordSnapshot(settingsPath, settingsRaw)
          await writeFileAtomic(fs, settingsPath, JSON.stringify(nextSettings, null, 4) + '\n')
          result.applied.window = true
        }
      }
    }

    return result
  }

  async function sweepStaleFragments() {
    const dir = fragmentDir()
    if (!dir) return { swept: [], errors: [] }
    let names
    try {
      names = await fs.readdir(dir)
    } catch (_) {
      return { swept: [], errors: [] }
    }
    const entries = []
    for (const name of names) {
      try {
        const stat = await fs.stat(path.join(dir, name))
        if (stat.isFile()) entries.push({ name, mtimeMs: stat.mtimeMs })
      } catch (_) {}
    }
    const stale = staleFragmentFiles(entries, new Set(), Date.now(), FRAGMENT_MAX_AGE_MS)
    const swept = []
    const errors = []
    for (const name of stale) {
      try {
        await fs.unlink(path.join(dir, name))
        swept.push(name)
      } catch (err) {
        errors.push({ name, error: err.message || String(err) })
      }
    }
    return { swept, errors }
  }

  async function isGitRepo(dir) {
    if (!dir || typeof dir !== 'string') return false
    try {
      const stat = await fs.stat(path.join(dir, '.git'))
      return stat.isDirectory() || stat.isFile()
    } catch (_) {
      return false
    }
  }

  function runGit(args, cwd) {
    return new Promise((resolve) => {
      const child = spawn('git', args, { cwd, windowsHide: true })
      let stdout = '', stderr = ''
      child.stdout.on('data', d => { stdout += d.toString() })
      child.stderr.on('data', d => { stderr += d.toString() })
      child.on('error', err => resolve({ code: -1, stdout, stderr: err.message || String(err) }))
      child.on('close', code => resolve({ code, stdout, stderr }))
    })
  }

  function gitFail(step, stderr, stdout) {
    const c = classifyGitError(stderr, stdout, step)
    return { ok: false, step, error: c.message, errorClass: c.class, raw: (stderr || stdout || '').trim() }
  }

  ipcMain.handle('layouts:pickDir', async () => {
    const saved = await store.read()
    const res = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Select layouts directory',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: saved.lastDir || undefined,
    })
    if (res.canceled || !res.filePaths.length) return null
    const picked = res.filePaths[0]
    await store.write({ lastDir: picked })
    return picked
  })

  ipcMain.handle('layouts:list', async (_e, dirPath) => {
    const entries = await listEntries(dirPath)
    for (const ent of entries) {
      if (ent.type !== 'file' || ent.error) continue
      try {
        const raw = await fs.readFile(ent.path, 'utf8')
        const data = JSON.parse(raw)
        const v = validateLayout(data)
        if (!v.ok) {
          ent.invalid = true
          ent.error = v.error
        } else if (v.warnings.length) {
          ent.warnings = v.warnings
        }
      } catch (err) {
        ent.invalid = true
        ent.error = String(err.message || err)
      }
    }
    return entries
  })

  ipcMain.handle('layouts:move', async (_e, srcPath, destDir) => {
    return moveLayoutFile(srcPath, destDir)
  })

  ipcMain.handle('layouts:read', async (_e, filePath) => {
    let raw
    try {
      raw = await fs.readFile(filePath, 'utf8')
    } catch (err) {
      return { ok: false, data: null, error: `read failed: ${err.message || err}`, warnings: [] }
    }
    let data
    try {
      data = JSON.parse(raw)
    } catch (err) {
      return { ok: false, data: null, error: `JSON parse: ${err.message || err}`, warnings: [] }
    }
    return validateLayout(data)
  })

  ipcMain.handle('layouts:save', async (_e, filePath, layout) => {
    const pretty = JSON.stringify(layout, null, 2)
    await fs.writeFile(filePath, pretty, 'utf8')
    return true
  })

  ipcMain.handle('layouts:saveNew', async (_e, dirPath, suggestedName, layout) => {
    const safe = (suggestedName || layout.name || 'layout').replace(/[^A-Za-z0-9_\-]/g, '_')
    const target = await availableLayoutFile(dirPath, safe)
    await fs.writeFile(target, JSON.stringify(layout, null, 2), 'utf8')
    return target
  })

  ipcMain.handle('layouts:delete', async (_e, filePath) => {
    await fs.unlink(filePath)
    return true
  })

  ipcMain.handle('wt:applyStyle', async (_e, layout) => {
    try {
      return await applyStyleForLaunch(layout)
    } catch (err) {
      return { error: err.message || String(err) }
    }
  })

  ipcMain.handle('layouts:run', async (_e, layout) => {
    let effective = layout
    let applyResult = null
    try {
      applyResult = await applyStyleForLaunch(layout)
      if (applyResult && applyResult.mapping && Object.keys(applyResult.mapping).length) {
        effective = styleApply.remapLayoutProfiles(layout, applyResult.mapping)
      }
      if (applyResult && (applyResult.applied.profile || applyResult.applied.window)) {
        await new Promise(r => setTimeout(r, 600))
      }
    } catch (err) {
      applyResult = { error: err.message || String(err) }
    }
    const argv = buildWtArgv(effective)
    const preview = buildWtCommand(effective)
    const child = spawn(preview, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
    if (child && typeof child.unref === 'function') child.unref()
    return { argv, preview, pid: child && child.pid, style: applyResult }
  })

  ipcMain.handle('layouts:preview', async (_e, layout) => {
    return buildWtCommand(layout)
  })

  ipcMain.handle('profiles:list', async () => {
    return discoverProfiles()
  })

  ipcMain.handle('config:get', async () => {
    const data = await store.read()
    if (data.lastDir) {
      try {
        const stat = await fs.stat(data.lastDir)
        if (!stat.isDirectory()) data.lastDir = null
      } catch (_) {
        data.lastDir = null
      }
    }
    return data
  })

  ipcMain.handle('config:set', async (_e, patch) => {
    if (!patch || typeof patch !== 'object') return false
    await store.write(patch)
    return true
  })

  ipcMain.handle('appSettings:get', async () => {
    const data = await store.read()
    return { settings: appSettings.normalizeSettings(data), themes: appSettings.THEMES }
  })

  ipcMain.handle('appSettings:set', async (_e, patch) => {
    const clean = appSettings.sanitizePatch(patch)
    if (Object.keys(clean).length === 0) return { ok: true, settings: appSettings.normalizeSettings(await store.read()) }
    await store.write(clean)
    return { ok: true, settings: appSettings.normalizeSettings(await store.read()) }
  })

  ipcMain.handle('shell:reveal', async (_e, targetPath) => {
    if (!targetPath || typeof targetPath !== 'string') return false
    shell.showItemInFolder(targetPath)
    return true
  })

  ipcMain.handle('shell:openPath', async (_e, targetPath) => {
    if (!targetPath || typeof targetPath !== 'string') return ''
    return shell.openPath(targetPath)
  })

  ipcMain.handle('git:isRepo', async (_e, dir) => isGitRepo(dir))

  ipcMain.handle('gh:update', async (_e, dir) => {
    if (!await isGitRepo(dir)) return { ok: false, step: 'check', error: 'Not a git repository', errorClass: 'unknown' }
    const add = await runGit(['add', '-A'], dir)
    if (add.code !== 0) return gitFail('add', add.stderr, add.stdout)
    const msg = `Wrangler update ${new Date().toISOString()}`
    const commit = await runGit(['commit', '-m', msg], dir)
    const nothing = commit.code !== 0 && /nothing to commit|no changes added/i.test(commit.stdout + commit.stderr)
    if (commit.code !== 0 && !nothing) return gitFail('commit', commit.stderr, commit.stdout)
    const push = await runGit(['push'], dir)
    if (push.code !== 0) return gitFail('push', push.stderr, push.stdout)
    return { ok: true, committed: !nothing, message: msg }
  })

  ipcMain.handle('dialog:pickDir', async (_e, defaultPath) => {
    const opts = {
      title: 'Select directory',
      properties: ['openDirectory'],
    }
    if (defaultPath && typeof defaultPath === 'string') opts.defaultPath = defaultPath
    const res = await dialog.showOpenDialog(getMainWindow(), opts)
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  })

  ipcMain.handle('dialog:pickImage', async (_e, defaultPath) => {
    const opts = {
      title: 'Select background image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff'] },
        { name: 'All files', extensions: ['*'] },
      ],
    }
    if (defaultPath && typeof defaultPath === 'string') opts.defaultPath = defaultPath
    const res = await dialog.showOpenDialog(getMainWindow(), opts)
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  })

  return { applyStyleForLaunch, sweepStaleFragments }
}

module.exports = { register }
