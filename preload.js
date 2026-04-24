'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wt', {
  pickDir: () => ipcRenderer.invoke('layouts:pickDir'),
  list: dir => ipcRenderer.invoke('layouts:list', dir),
  read: file => ipcRenderer.invoke('layouts:read', file),
  save: (file, layout) => ipcRenderer.invoke('layouts:save', file, layout),
  saveNew: (dir, name, layout) => ipcRenderer.invoke('layouts:saveNew', dir, name, layout),
  remove: file => ipcRenderer.invoke('layouts:delete', file),
  run: layout => ipcRenderer.invoke('layouts:run', layout),
  preview: layout => ipcRenderer.invoke('layouts:preview', layout),
  profiles: () => ipcRenderer.invoke('profiles:list'),
})
