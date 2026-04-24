'use strict'

const state = {
  dir: null,
  saveDir: null,
  children: new Map(),
  expanded: new Set(),
  currentPath: null,
  currentLayout: null,
  dirty: false,
  profiles: [],
  profileSource: null,
}

const el = {
  pickDir: document.getElementById('pickDir'),
  dirPath: document.getElementById('dirPath'),
  saveHint: document.getElementById('saveHint'),
  newLayout: document.getElementById('newLayout'),
  layoutList: document.getElementById('layoutList'),
  editor: document.getElementById('editor'),
  toast: document.getElementById('toast'),
}

function dirnameOf(p) {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return i >= 0 ? p.slice(0, i) : ''
}

function relOf(full) {
  if (!state.dir) return full
  if (full === state.dir) return ''
  if (full.startsWith(state.dir)) {
    const rest = full.slice(state.dir.length)
    return rest.replace(/^[\\/]+/, '')
  }
  return full
}

function updateSaveDirDisplay() {
  if (!state.saveDir || state.saveDir === state.dir) {
    el.saveHint.classList.add('hidden')
    el.saveHint.textContent = ''
  } else {
    el.saveHint.classList.remove('hidden')
    el.saveHint.textContent = `save → ${relOf(state.saveDir)}`
  }
}

const templates = {
  editor: document.getElementById('tpl-editor'),
  tab: document.getElementById('tpl-tab'),
  pane: document.getElementById('tpl-pane'),
}

function toast(msg, kind) {
  el.toast.textContent = msg
  el.toast.classList.remove('hidden', 'error', 'success')
  if (kind) el.toast.classList.add(kind)
  clearTimeout(toast._t)
  toast._t = setTimeout(() => el.toast.classList.add('hidden'), 2500)
}

function emptyLayout() {
  return {
    name: 'new-layout',
    window: '',
    tabs: [
      {
        title: 'Tab 1',
        profile: 'pwsh',
        dir: '',
        panes: [{ profile: 'pwsh', dir: '', command: '' }],
      },
    ],
  }
}

function markDirty() {
  state.dirty = true
  schedulePreview()
}

let previewTimer = null
function schedulePreview() {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(renderPreview, 150)
}

async function renderPreview() {
  if (!state.currentLayout) return
  const pre = el.editor.querySelector('[data-preview]')
  if (!pre) return
  try {
    const cmd = await window.wt.preview(state.currentLayout)
    pre.textContent = cmd
    pre.style.color = '#9ad'
  } catch (err) {
    pre.textContent = String(err.message || err)
    pre.style.color = '#f88'
  }
}

async function setLayoutsDir(dir) {
  state.dir = dir
  state.saveDir = dir
  state.children = new Map()
  state.expanded = new Set()
  el.dirPath.textContent = dir
  el.dirPath.classList.remove('muted')
  el.newLayout.disabled = false
  updateSaveDirDisplay()
  await refreshList()
}

async function pickDir() {
  const dir = await window.wt.pickDir()
  if (!dir) return
  await setLayoutsDir(dir)
}

async function restoreLastDir() {
  try {
    const cfg = await window.wt.configGet()
    if (cfg && cfg.lastDir) await setLayoutsDir(cfg.lastDir)
  } catch (err) {
    console.warn('restore lastDir failed:', err)
  }
}

async function refreshList() {
  if (!state.dir) return
  state.children.set(state.dir, await window.wt.list(state.dir))
  for (const dir of Array.from(state.expanded)) {
    try {
      state.children.set(dir, await window.wt.list(dir))
    } catch (_) {
      state.expanded.delete(dir)
      state.children.delete(dir)
    }
  }
  renderList()
}

function renderList() {
  el.layoutList.innerHTML = ''
  const roots = state.children.get(state.dir) || []
  renderEntries(roots, el.layoutList, 0)
}

function renderEntries(entries, parentUl, depth) {
  for (const entry of entries) {
    const li = document.createElement('li')
    li.style.paddingLeft = `${10 + depth * 14}px`
    if (entry.type === 'dir') {
      const isOpen = state.expanded.has(entry.path)
      const isSelected = state.saveDir === entry.path
      li.classList.add('dir-item')
      if (isSelected) li.classList.add('selected')
      li.textContent = `${isOpen ? '▾' : '▸'} ${entry.name}`
      li.title = 'Click to select as save target'
      li.addEventListener('click', (e) => { e.stopPropagation(); onDirClick(entry.path) })
      attachDropTarget(li, entry.path)
      parentUl.appendChild(li)
      if (isOpen) {
        const kids = state.children.get(entry.path) || []
        renderEntries(kids, parentUl, depth + 1)
      }
    } else {
      li.classList.add('file-item')
      li.textContent = entry.name || entry.file
      li.draggable = true
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', entry.path)
        li.classList.add('dragging')
      })
      li.addEventListener('dragend', () => li.classList.remove('dragging'))
      if (entry.error) { li.classList.add('error'); li.title = entry.error }
      if (entry.path === state.currentPath) li.classList.add('active')
      li.addEventListener('click', () => selectLayout(entry.path))
      parentUl.appendChild(li)
    }
  }
}

async function onDirClick(dirPath) {
  if (state.expanded.has(dirPath) && state.saveDir === dirPath) {
    state.expanded.delete(dirPath)
    state.saveDir = state.dir
    updateSaveDirDisplay()
    renderList()
    return
  }
  state.saveDir = dirPath
  if (!state.expanded.has(dirPath)) {
    state.expanded.add(dirPath)
    if (!state.children.has(dirPath)) {
      try {
        state.children.set(dirPath, await window.wt.list(dirPath))
      } catch (err) {
        state.expanded.delete(dirPath)
        state.saveDir = state.dir
        updateSaveDirDisplay()
        toast('Failed to read folder: ' + err.message, 'error')
        return
      }
    }
  }
  updateSaveDirDisplay()
  renderList()
}

function attachDropTarget(li, destDir) {
  li.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    li.classList.add('drop-target')
  })
  li.addEventListener('dragleave', () => li.classList.remove('drop-target'))
  li.addEventListener('drop', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    li.classList.remove('drop-target')
    const src = e.dataTransfer.getData('text/plain')
    if (!src) return
    await moveLayout(src, destDir)
  })
}

async function moveLayout(srcPath, destDir) {
  if (dirnameOf(srcPath) === destDir) return
  try {
    const newPath = await window.wt.move(srcPath, destDir)
    if (state.currentPath === srcPath) state.currentPath = newPath
    if (destDir !== state.dir) state.expanded.add(destDir)
    await refreshList()
    toast('Moved', 'success')
  } catch (err) {
    toast('Move failed: ' + err.message, 'error')
  }
}

async function selectLayout(filePath) {
  if (state.dirty && !confirm('Discard unsaved changes?')) return
  try {
    const layout = await window.wt.read(filePath)
    state.currentPath = filePath
    state.currentLayout = normalizeLayout(layout)
    state.dirty = false
    renderList()
    renderEditor()
  } catch (err) {
    toast('Failed to read: ' + err.message, 'error')
  }
}

function normalizeLayout(layout) {
  const out = {
    name: layout.name || '',
    window: layout.window || '',
    tabs: Array.isArray(layout.tabs) ? layout.tabs.map(normalizeTab) : [],
  }
  if (!out.tabs.length) out.tabs.push(normalizeTab({}))
  return out
}

function normalizeTab(tab) {
  const out = {
    title: tab.title || '',
    profile: tab.profile || '',
    dir: tab.dir || '',
    panes: Array.isArray(tab.panes) && tab.panes.length
      ? tab.panes.map(normalizePane)
      : [normalizePane({})],
  }
  return out
}

function normalizePane(pane) {
  return {
    split: pane.split || 'right',
    size: typeof pane.size === 'number' ? pane.size : undefined,
    profile: pane.profile || '',
    dir: pane.dir || '',
    command: pane.command || '',
    postCommand: pane.postCommand || '',
    postDelay: typeof pane.postDelay === 'number' ? pane.postDelay : undefined,
  }
}

function newLayoutAction() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return
  state.currentPath = null
  state.currentLayout = emptyLayout()
  state.dirty = true
  renderList()
  renderEditor()
}

function renderEditor() {
  el.editor.innerHTML = ''
  if (!state.currentLayout) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'Open a folder of layout JSON files, or create a new one.'
    el.editor.appendChild(empty)
    return
  }
  const node = templates.editor.content.cloneNode(true)
  const nameInput = node.querySelector('[data-field="name"]')
  const windowInput = node.querySelector('[data-field="window"]')
  nameInput.value = state.currentLayout.name
  windowInput.value = state.currentLayout.window
  nameInput.addEventListener('input', () => { state.currentLayout.name = nameInput.value; markDirty() })
  windowInput.addEventListener('input', () => { state.currentLayout.window = windowInput.value; markDirty() })

  node.querySelector('[data-action="addTab"]').addEventListener('click', () => {
    state.currentLayout.tabs.push(normalizeTab({ title: `Tab ${state.currentLayout.tabs.length + 1}` }))
    markDirty()
    renderEditor()
  })
  node.querySelector('[data-action="save"]').addEventListener('click', saveCurrent)
  node.querySelector('[data-action="run"]').addEventListener('click', runCurrent)
  node.querySelector('[data-action="delete"]').addEventListener('click', deleteCurrent)

  const tabsHost = node.querySelector('[data-tabs]')
  state.currentLayout.tabs.forEach((tab, tabIdx) => {
    tabsHost.appendChild(renderTab(tab, tabIdx))
  })

  el.editor.appendChild(node)
  renderProfileOptions()
  renderPreview()
}

function renderTab(tab, tabIdx) {
  const node = templates.tab.content.cloneNode(true)
  const card = node.querySelector('[data-tab]')
  const bind = (field) => {
    const input = card.querySelector(`[data-field="${field}"]`)
    input.value = tab[field] || ''
    input.addEventListener('input', () => { tab[field] = input.value; markDirty() })
  }
  bind('title'); bind('profile'); bind('dir')
  attachDirPicker(card, tab, 'dir')
  card.querySelector('[data-action="addPane"]').addEventListener('click', () => {
    tab.panes.push(normalizePane({ split: 'right', profile: tab.profile, dir: tab.dir }))
    markDirty()
    renderEditor()
  })
  card.querySelector('[data-action="removeTab"]').addEventListener('click', () => {
    if (state.currentLayout.tabs.length <= 1) { toast('Must keep at least one tab', 'error'); return }
    state.currentLayout.tabs.splice(tabIdx, 1)
    markDirty()
    renderEditor()
  })
  const panesHost = card.querySelector('[data-panes]')
  tab.panes.forEach((pane, paneIdx) => {
    panesHost.appendChild(renderPane(pane, paneIdx, tab))
  })
  return node
}

function renderPane(pane, paneIdx, tab) {
  const node = templates.pane.content.cloneNode(true)
  const card = node.querySelector('[data-pane]')
  card.querySelector('[data-pane-label]').textContent = paneIdx === 0 ? `Pane ${paneIdx + 1} (root)` : `Pane ${paneIdx + 1} (split)`
  if (paneIdx === 0) {
    card.querySelectorAll('[data-split-only]').forEach(n => n.style.display = 'none')
  }
  const bindText = (field) => {
    const input = card.querySelector(`[data-field="${field}"]`)
    input.value = pane[field] || ''
    input.addEventListener('input', () => { pane[field] = input.value; markDirty() })
  }
  const bindNumber = (field) => {
    const input = card.querySelector(`[data-field="${field}"]`)
    input.value = pane[field] !== undefined ? pane[field] : ''
    input.addEventListener('input', () => {
      const v = input.value === '' ? undefined : Number(input.value)
      pane[field] = Number.isFinite(v) ? v : undefined
      markDirty()
    })
  }
  const splitSel = card.querySelector('[data-field="split"]')
  splitSel.value = pane.split || 'right'
  splitSel.addEventListener('change', () => { pane.split = splitSel.value; markDirty() })
  bindNumber('size')
  bindText('profile'); bindText('dir'); bindText('command'); bindText('postCommand')
  bindNumber('postDelay')
  attachDirPicker(card, pane, 'dir')
  card.querySelector('[data-action="removePane"]').addEventListener('click', () => {
    if (tab.panes.length <= 1) { toast('Must keep at least one pane', 'error'); return }
    tab.panes.splice(paneIdx, 1)
    markDirty()
    renderEditor()
  })
  return node
}

function serializeLayout() {
  const layout = state.currentLayout
  const out = {
    name: layout.name || 'layout',
    window: layout.window || undefined,
    tabs: layout.tabs.map(tab => ({
      title: tab.title || undefined,
      profile: tab.profile || undefined,
      dir: tab.dir || undefined,
      panes: tab.panes.map((pane, idx) => {
        const p = {}
        if (idx > 0) {
          p.split = pane.split || 'right'
          if (Number.isFinite(pane.size)) p.size = pane.size
        }
        if (pane.profile) p.profile = pane.profile
        if (pane.dir) p.dir = pane.dir
        if (pane.command) p.command = pane.command
        if (pane.postCommand) p.postCommand = pane.postCommand
        if (Number.isFinite(pane.postDelay)) p.postDelay = pane.postDelay
        return p
      }),
    })),
  }
  if (!out.window) delete out.window
  return out
}

async function saveCurrent() {
  if (!state.currentLayout) return
  const serialized = serializeLayout()
  try {
    if (state.currentPath) {
      await window.wt.save(state.currentPath, serialized)
    } else {
      if (!state.dir) { toast('Open a folder first', 'error'); return }
      const target = state.saveDir || state.dir
      const saved = await window.wt.saveNew(target, serialized.name, serialized)
      state.currentPath = saved
      if (target !== state.dir) state.expanded.add(target)
    }
    state.dirty = false
    await refreshList()
    toast('Saved', 'success')
  } catch (err) {
    toast('Save failed: ' + err.message, 'error')
  }
}

async function runCurrent() {
  if (!state.currentLayout) return
  try {
    const serialized = serializeLayout()
    await window.wt.run(serialized)
    toast('Launching Windows Terminal…', 'success')
  } catch (err) {
    toast('Run failed: ' + err.message, 'error')
  }
}

async function deleteCurrent() {
  if (!state.currentPath) {
    state.currentLayout = null
    state.dirty = false
    renderEditor()
    return
  }
  if (!confirm(`Delete ${state.currentPath}?`)) return
  try {
    await window.wt.remove(state.currentPath)
    state.currentPath = null
    state.currentLayout = null
    state.dirty = false
    await refreshList()
    renderEditor()
    toast('Deleted', 'success')
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error')
  }
}

function attachDirPicker(root, target, field) {
  const input = root.querySelector(`[data-field="${field}"]`)
  const btn = root.querySelector('[data-action="pickDir"]')
  if (!input || !btn) return
  btn.addEventListener('click', async () => {
    try {
      const selected = await window.wt.pickAnyDir(input.value || state.dir || undefined)
      if (!selected) return
      target[field] = selected
      input.value = selected
      markDirty()
    } catch (err) {
      toast('Picker failed: ' + err.message, 'error')
    }
  })
}

async function loadProfiles() {
  try {
    const res = await window.wt.profiles()
    state.profiles = Array.isArray(res.profiles) ? res.profiles : []
    state.profileSource = res.source || null
    renderProfileOptions()
  } catch (err) {
    console.warn('profile discovery failed:', err)
  }
}

function renderProfileOptions() {
  const dl = document.getElementById('profileOptions')
  if (!dl) return
  dl.innerHTML = ''
  const seen = new Set()
  const known = [...state.profiles]
  if (state.currentLayout) {
    for (const tab of state.currentLayout.tabs) {
      if (tab.profile) known.push(tab.profile)
      for (const pane of tab.panes) if (pane.profile) known.push(pane.profile)
    }
  }
  for (const name of known) {
    if (!name || seen.has(name)) continue
    seen.add(name)
    const opt = document.createElement('option')
    opt.value = name
    dl.appendChild(opt)
  }
}

el.pickDir.addEventListener('click', pickDir)
el.newLayout.addEventListener('click', newLayoutAction)
el.dirPath.addEventListener('click', () => {
  if (!state.dir) return
  state.saveDir = state.dir
  updateSaveDirDisplay()
  renderList()
})
el.dirPath.addEventListener('dragover', (e) => {
  if (!state.dir) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  el.dirPath.classList.add('drop-target')
})
el.dirPath.addEventListener('dragleave', () => el.dirPath.classList.remove('drop-target'))
el.dirPath.addEventListener('drop', async (e) => {
  e.preventDefault()
  el.dirPath.classList.remove('drop-target')
  if (!state.dir) return
  const src = e.dataTransfer.getData('text/plain')
  if (!src) return
  await moveLayout(src, state.dir)
})
loadProfiles()
restoreLastDir()

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = '' }
})
