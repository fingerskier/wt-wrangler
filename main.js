'use strict'

const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { buildWtArgv, buildWtCommand } = require('./src/wtCommand')

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'wt-wrangler',
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
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('layouts:pickDir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select layouts directory',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (res.canceled || !res.filePaths.length) return null
  return res.filePaths[0]
})

ipcMain.handle('layouts:list', async (_e, dirPath) => {
  if (!dirPath) return []
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const files = entries
    .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.json'))
    .map(d => d.name)
    .sort()
  const out = []
  for (const name of files) {
    const full = path.join(dirPath, name)
    try {
      const raw = await fs.readFile(full, 'utf8')
      const data = JSON.parse(raw)
      out.push({ file: name, path: full, name: data.name || name.replace(/\.json$/i, '') })
    } catch (err) {
      out.push({ file: name, path: full, name, error: String(err.message || err) })
    }
  }
  return out
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
  const child = spawn('wt.exe', argv, { detached: true, stdio: 'ignore', shell: false })
  child.unref()
  return { argv, preview, pid: child.pid }
})

ipcMain.handle('layouts:preview', async (_e, layout) => {
  return buildWtCommand(layout)
})
