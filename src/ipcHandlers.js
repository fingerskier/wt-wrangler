'use strict'

const path = require('node:path')
const { buildWtArgv, buildWtCmdCommand, buildWtCommand, profileKind } = require('./wtCommand')
const { discoverProfiles, parseJsonc, candidateSettingsPaths, defaultProfileShellKind } = require('./wtProfiles')
const styleApply = require('./wtStyleApply')
const startupRestore = require('./wtStartupRestore')
const { listEntries, moveLayoutFile, saveLayoutFile, saveNewLayoutFile } = require('./layouts')
const { validateLayout } = require('./layoutSchema')
const { fragmentFileName, styleHash, staleFragmentFiles, hasDuplicateProfileGuids } = require('./wtFragments')
const { classifyGitError } = require('./ghUpdate')
const { writeFileAtomic } = require('./atomicWrite')
const { runGit: runGitPure } = require('./gitRun')
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
    let settingsWritten = false
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
          // Record both the original and what we're about to write so quit-time
          // restoreAll can detect external edits and skip overwriting them.
          const patched = JSON.stringify(nextSettings, null, 4) + '\n'
          if (settingsRaw !== null && styleSession) {
            const keyDelta = styleApply.computeWindowKeyDelta(settings, style)
            styleSession.recordSnapshot(settingsPath, settingsRaw, patched, keyDelta)
          }
          await writeFileAtomic(fs, settingsPath, patched)
          settingsWritten = true
          result.applied.window = true
        }
      }
    }

    if (result.applied.profile && !settingsWritten && settingsPath && settingsRaw !== null && settings) {
      // WT does not reliably notice a newly written fragment before launch
      // unless settings.json reloads. Rewriting the original bytes updates the
      // file timestamp without changing the user's settings or creating a
      // restore snapshot.
      await writeFileAtomic(fs, settingsPath, settingsRaw)
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
    const staleSet = new Set(stale)
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
    // Self-heal: drop any fragment that contains internal duplicate profile
    // GUIDs. Such files are artifacts of a prior bug where (default) and an
    // explicit profile pointing to the same base each emitted a transient,
    // and WT refuses to start cleanly until they're removed.
    for (const e of entries) {
      if (!e.name.endsWith('.json') || staleSet.has(e.name)) continue
      const full = path.join(dir, e.name)
      let parsed
      try {
        const raw = await fs.readFile(full, 'utf8')
        parsed = JSON.parse(raw)
      } catch (_) { continue }
      if (!hasDuplicateProfileGuids(parsed)) continue
      try {
        await fs.unlink(full)
        swept.push(e.name)
      } catch (err) {
        errors.push({ name: e.name, error: err.message || String(err) })
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
    // GIT_TERMINAL_PROMPT=0 keeps git from blocking on a credential prompt or
    // SSH passphrase popup. Without it, a missing/expired token would wait the
    // full 30s timeout; with it, git emits "terminal prompts disabled" right
    // away — the existing auth classifier (ghUpdate.AUTH_PATTERNS) picks that
    // up and the user gets actionable feedback in <1s instead of 30s.
    const childEnv = { ...env, GIT_TERMINAL_PROMPT: '0' }
    return runGitPure({ spawn, setTimeout, clearTimeout }, args, cwd, undefined, childEnv)
  }

  function gitFail(step, result) {
    if (result && result.timedOut) {
      return {
        ok: false,
        step,
        error: 'git command timed out — check network or pending credential prompt',
        errorClass: 'timeout',
        raw: (result.stderr || result.stdout || '').trim(),
      }
    }
    const stderr = (result && result.stderr) || ''
    const stdout = (result && result.stdout) || ''
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
    await saveLayoutFile(fs, filePath, layout)
    return true
  })

  ipcMain.handle('layouts:saveNew', async (_e, dirPath, suggestedName, layout) => {
    const safe = (suggestedName || layout.name || 'layout').replace(/[^A-Za-z0-9_\-]/g, '_')
    return saveNewLayoutFile(fs, dirPath, safe, layout)
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

  async function defaultShellKindFromSettings() {
    async function wtDefaultShellKind() {
      const settingsPath = findExistingSettingsPath()
      if (!settingsPath) return null
      try {
        const raw = await fs.readFile(settingsPath, 'utf8')
        return defaultProfileShellKind(parseJsonc(raw))
      } catch (_) {
        return null
      }
    }
    try {
      const data = await store.read()
      const dp = data && typeof data.defaultProfile === 'string' ? data.defaultProfile : ''
      return profileKind(dp) || await wtDefaultShellKind()
    } catch (_) {
      return wtDefaultShellKind()
    }
  }

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
    const defaultShellKind = await defaultShellKindFromSettings()
    const argv = buildWtArgv(effective, { defaultShellKind })
    const preview = buildWtCommand(effective, { defaultShellKind })
    const runCommand = buildWtCmdCommand(effective, { defaultShellKind })
    // Launch through cmd.exe with real WT `;` separators. Direct
    // argv-form launches preserve literal inner quotes inside command tokens
    // (for example `claude "start terse"`), which WT can misparse before later
    // tab segments. Letting cmd.exe tokenize gives WT clean commandline argv.
    const child = spawn('cmd.exe', ['/d', '/c', runCommand], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true,
    })
    if (child && typeof child.unref === 'function') child.unref()
    return { argv, preview, runCommand, pid: child && child.pid, style: applyResult }
  })

  ipcMain.handle('layouts:preview', async (_e, layout) => {
    const defaultShellKind = await defaultShellKindFromSettings()
    return buildWtCommand(layout, { defaultShellKind })
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
    if (add.code !== 0) return gitFail('add', add)
    const msg = `Wrangler update ${new Date().toISOString()}`
    const commit = await runGit(['commit', '-m', msg], dir)
    const nothing = commit.code !== 0 && /nothing to commit|no changes added/i.test(commit.stdout + commit.stderr)
    if (commit.code !== 0 && !nothing) return gitFail('commit', commit)
    const push = await runGit(['push'], dir)
    if (push.code !== 0) return gitFail('push', push)
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

  ipcMain.handle('wt:listStaleBackups', async () => {
    const settingsPath = findExistingSettingsPath()
    if (!settingsPath) return { settingsPath: null, backups: [] }
    const backups = await startupRestore.findBackups(settingsPath, fs)
    return { settingsPath, backups }
  })

  ipcMain.handle('wt:restoreBackup', async (_e, backupPath) => {
    const settingsPath = findExistingSettingsPath()
    if (!settingsPath) throw new Error('WT settings.json not found')
    if (!backupPath || typeof backupPath !== 'string') throw new Error('backupPath required')
    // Surgical: revert only the window-level keys Wrangler patches. Anything
    // the user added between the patch and this click (color schemes, new
    // profiles, fresh top-level keys) survives.
    const out = await startupRestore.surgicalRestoreFromBackup(settingsPath, backupPath, fs, styleApply.WINDOW_KEYS)
    // Drop ALL wtw-backup-* siblings so we don't re-prompt next launch.
    const remaining = await startupRestore.findBackups(settingsPath, fs)
    await startupRestore.discardAll(remaining.map(b => b.path), fs)
    // Forget any in-memory snapshot for this path so quit-time restoreAll
    // doesn't try to overwrite the user's just-restored settings.json.
    if (styleSession && typeof styleSession.forget === 'function') {
      styleSession.forget(settingsPath)
    }
    return { ok: true, settingsPath, mode: out && out.mode }
  })

  ipcMain.handle('wt:discardBackups', async () => {
    const settingsPath = findExistingSettingsPath()
    if (!settingsPath) return { discarded: 0 }
    const backups = await startupRestore.findBackups(settingsPath, fs)
    const out = await startupRestore.discardAll(backups.map(b => b.path), fs)
    return { discarded: backups.length - out.errors.length, errors: out.errors }
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
