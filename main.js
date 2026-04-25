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
const { discoverProfiles } = require('./src/wtProfiles')
const { makeStore } = require('./src/config')
const { listEntries, moveLayoutFile } = require('./src/layouts')

const APP_ICON = path.join(__dirname, 'asset', process.platform === 'win32' ? 'logo.ico' : 'logo.png')

let mainWindow = null
let store = null

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
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
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

ipcMain.handle('layouts:run', async (_e, layout) => {
  const argv = buildWtArgv(layout)
  const preview = buildWtCommand(layout)
  const child = spawn(preview, { shell: true, detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  return { argv, preview, pid: child.pid }
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

ipcMain.handle('shell:reveal', async (_e, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return false
  shell.showItemInFolder(targetPath)
  return true
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
