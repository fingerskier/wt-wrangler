'use strict'

if (require('electron-squirrel-startup')) {
  require('electron').app.quit()
  return
}

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const { spawn } = require('node:child_process')
const { makeStore } = require('./src/config')
const { makeSession, restoreAll } = require('./src/wtStyleSession')
const updater = require('./src/updater')
const ipcHandlers = require('./src/ipcHandlers')

const APP_ICON = path.join(__dirname, 'asset', process.platform === 'win32' ? 'logo.ico' : 'logo.png')

let mainWindow = null
let store = null
const styleSession = makeSession()
let willQuitInProgress = false
let sweepStaleFragments = null

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
  const registered = ipcHandlers.register({
    ipcMain,
    dialog,
    shell,
    fs,
    fsSync,
    spawn,
    store,
    getMainWindow: () => mainWindow,
    env: process.env,
    styleSession,
  })
  sweepStaleFragments = registered.sweepStaleFragments
  createWindow()
  // Drop stale fragment files from prior sessions. Fire-and-forget — sweep failure should never block startup.
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
