'use strict'

if (require('electron-squirrel-startup')) {
  require('electron').app.quit()
  return
}

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { buildWtArgv, buildWtCommand } = require('./src/wtCommand')
const { discoverProfiles, parseJsonc, candidateSettingsPaths } = require('./src/wtProfiles')
const styleApply = require('./src/wtStyleApply')
const { makeStore } = require('./src/config')
const { listEntries, moveLayoutFile } = require('./src/layouts')
const { makeSession, restoreAll } = require('./src/wtStyleSession')
const { fragmentFileName, styleHash, staleFragmentFiles } = require('./src/wtFragments')
const updater = require('./src/updater')
const { classifyGitError } = require('./src/ghUpdate')
const appSettings = require('./src/appSettings')

const FRAGMENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

const APP_ICON = path.join(__dirname, 'asset', process.platform === 'win32' ? 'logo.ico' : 'logo.png')

let mainWindow = null
let store = null
const styleSession = makeSession()
let willQuitInProgress = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Wrangler',
    icon: APP_ICON,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

app.whenReady().then(() => {
  store = makeStore(app.getPath('userData'))
  createWindow()
  // Drop stale fragment files from prior sessions (older than FRAGMENT_MAX_AGE_MS).
  // Fire-and-forget — sweep failure should never block app startup.
  sweepStaleFragments().catch(() => {})
  // Squirrel.Windows auto-update — only fires when packaged on win32 with WRANGLER_UPDATE_URL set.
  try {
    const { autoUpdater } = require('electron')
    updater.maybeCheckForUpdates({
      feedURL: updater.getFeedURL(process.env),
      autoUpdater,
      isPackaged: app.isPackaged,
      platform: process.platform,
      schedule: setTimeout,
    })
  } catch (_) {
    // autoUpdater unavailable on non-win32 builds — already gated by maybeCheckForUpdates.
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', async (event) => {
  if (willQuitInProgress) return
  if (!styleSession.pending().length) return
  willQuitInProgress = true
  event.preventDefault()
  try {
    await restoreAll(styleSession, fs)
  } catch (_) {
    // restoreAll captures per-path errors; this catch is paranoia.
  }
  app.quit()
})

ipcMain.handle('layouts:pickDir', async () => {
  const saved = await store.read()
  const res = await dialog.showOpenDialog(mainWindow, {
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
  return listEntries(dirPath)
})

ipcMain.handle('layouts:move', async (_e, srcPath, destDir) => {
  return moveLayoutFile(srcPath, destDir)
})

ipcMain.handle('layouts:read', async (_e, filePath) => {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
})

ipcMain.handle('layouts:save', async (_e, filePath, layout) => {
  const pretty = JSON.stringify(layout, null, 2)
  await fs.writeFile(filePath, pretty, 'utf8')
  return true
})

ipcMain.handle('layouts:saveNew', async (_e, dirPath, suggestedName, layout) => {
  const safe = (suggestedName || layout.name || 'layout').replace(/[^A-Za-z0-9_\-]/g, '_')
  const target = path.join(dirPath, `${safe}.json`)
  await fs.writeFile(target, JSON.stringify(layout, null, 2), 'utf8')
  return target
})

ipcMain.handle('layouts:delete', async (_e, filePath) => {
  await fs.unlink(filePath)
  return true
})

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
        // Capture pre-patch content once per session so will-quit can restore it,
        // leaving the user's WT chrome unchanged after Wrangler exits.
        if (settingsRaw !== null) styleSession.recordSnapshot(settingsPath, settingsRaw)
        await writeFileAtomic(settingsPath, JSON.stringify(nextSettings, null, 4) + '\n')
        result.applied.window = true
      }
    }
  }

  return result
}

function findExistingSettingsPath() {
  for (const p of candidateSettingsPaths()) {
    try { if (require('node:fs').existsSync(p)) return p } catch (_) {}
  }
  return null
}

function fragmentDir() {
  const localAppData = process.env.LOCALAPPDATA || ''
  if (!localAppData) return null
  return path.join(localAppData, 'Microsoft', 'Windows Terminal', 'Fragments', 'wt-wrangler')
}

async function writeFragmentFile(layout, fragment) {
  const dir = fragmentDir()
  if (!dir) throw new Error('LOCALAPPDATA not set')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, fragmentFileName(layout))
  await writeFileAtomic(file, JSON.stringify(fragment, null, 2) + '\n')
  return file
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

async function writeFileAtomic(filePath, content) {
  const tmp = `${filePath}.wtw-tmp-${Date.now()}`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, filePath)
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
      // Give WT a moment to pick up settings/fragment changes before launch.
      await new Promise(r => setTimeout(r, 600))
    }
  } catch (err) {
    applyResult = { error: err.message || String(err) }
  }
  const argv = buildWtArgv(effective)
  const preview = buildWtCommand(effective)
  const child = spawn(preview, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return { argv, preview, pid: child.pid, style: applyResult }
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
      const stat = await require('node:fs/promises').stat(data.lastDir)
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

ipcMain.handle('git:isRepo', async (_e, dir) => isGitRepo(dir))

function gitFail(step, stderr, stdout) {
  const c = classifyGitError(stderr, stdout, step)
  return { ok: false, step, error: c.message, errorClass: c.class, raw: (stderr || stdout || '').trim() }
}

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
  const res = await dialog.showOpenDialog(mainWindow, opts)
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
  const res = await dialog.showOpenDialog(mainWindow, opts)
  if (res.canceled || !res.filePaths.length) return null
  return res.filePaths[0]
})
