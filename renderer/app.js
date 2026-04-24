'use strict'

const state = {
  dir: null,
  saveDir: null,
  children: new Map(),
  expanded: new Set(),
  currentPath: null,
  currentLayout: null,
  currentTabIdx: 0,
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
  tabbarItem: document.getElementById('tpl-tabbar-item'),
  tabView: document.getElementById('tpl-tab-view'),
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
    state.currentTabIdx = 0
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
  state.currentTabIdx = 0
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

  node.querySelector('[data-action="save"]').addEventListener('click', saveCurrent)
  node.querySelector('[data-action="run"]').addEventListener('click', runCurrent)
  node.querySelector('[data-action="delete"]').addEventListener('click', deleteCurrent)

  const tabbarHost = node.querySelector('[data-tabbar]')
  const tabViewHost = node.querySelector('[data-tab-view]')
  clampTabIdx()
  renderTabbar(tabbarHost)
  const activeTab = state.currentLayout.tabs[state.currentTabIdx]
  if (activeTab) tabViewHost.appendChild(renderTabView(activeTab, state.currentTabIdx))

  el.editor.appendChild(node)
  renderProfileOptions()
  renderPreview()
}

function clampTabIdx() {
  const n = state.currentLayout.tabs.length
  if (state.currentTabIdx >= n) state.currentTabIdx = Math.max(0, n - 1)
  if (state.currentTabIdx < 0) state.currentTabIdx = 0
}

function renderTabbar(host) {
  host.innerHTML = ''
  state.currentLayout.tabs.forEach((tab, idx) => {
    const frag = templates.tabbarItem.content.cloneNode(true)
    const btn = frag.querySelector('.tabbar-item')
    const title = frag.querySelector('[data-tab-title]')
    title.textContent = tab.title || `Tab ${idx + 1}`
    if (idx === state.currentTabIdx) btn.classList.add('active')
    btn.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="removeTab"]')) return
      state.currentTabIdx = idx
      renderEditor()
    })
    frag.querySelector('[data-action="removeTab"]').addEventListener('click', (e) => {
      e.stopPropagation()
      if (state.currentLayout.tabs.length <= 1) { toast('Must keep at least one tab', 'error'); return }
      state.currentLayout.tabs.splice(idx, 1)
      markDirty()
      renderEditor()
    })
    host.appendChild(frag)
  })
  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'tabbar-add'
  addBtn.textContent = '+ Tab'
  addBtn.addEventListener('click', () => {
    state.currentLayout.tabs.push(normalizeTab({ title: `Tab ${state.currentLayout.tabs.length + 1}` }))
    state.currentTabIdx = state.currentLayout.tabs.length - 1
    markDirty()
    renderEditor()
  })
  host.appendChild(addBtn)
}

function renderTabView(tab) {
  const frag = templates.tabView.content.cloneNode(true)
  const root = frag.querySelector('.tab-view-inner')
  const bind = (field) => {
    const input = root.querySelector(`[data-field="${field}"]`)
    input.value = tab[field] || ''
    input.addEventListener('input', () => {
      tab[field] = input.value
      if (field === 'title') {
        const title = el.editor.querySelectorAll('.tabbar-item')[state.currentTabIdx]?.querySelector('[data-tab-title]')
        if (title) title.textContent = input.value || `Tab ${state.currentTabIdx + 1}`
      }
      markDirty()
    })
  }
  bind('title'); bind('profile'); bind('dir')
  attachDirPicker(root, tab, 'dir')

  const treeHost = root.querySelector('[data-pane-tree]')
  const tree = buildPaneTree(tab.panes)
  if (tree) treeHost.appendChild(renderPaneNode(tree, tab))
  return frag
}

function buildPaneTree(panes) {
  if (!panes.length) return null
  let root = { kind: 'leaf', paneIdx: 0 }
  let focused = root
  const parents = new Map()
  for (let i = 1; i < panes.length; i++) {
    const p = panes[i]
    const axis = (p.split === 'down' || p.split === 'up') ? 'h' : 'v'
    const rawSize = Number.isFinite(p.size) ? p.size : 0.5
    const size = Math.min(0.95, Math.max(0.05, rawSize))
    const invert = p.split === 'left' || p.split === 'up'
    const newLeaf = { kind: 'leaf', paneIdx: i }
    const split = { kind: 'split', axis, size, invert, children: invert ? [newLeaf, focused] : [focused, newLeaf] }
    const parent = parents.get(focused)
    if (parent) {
      const ix = parent.children.indexOf(focused)
      parent.children[ix] = split
      parents.set(split, parent)
    } else {
      root = split
    }
    parents.set(focused, split)
    parents.set(newLeaf, split)
    focused = newLeaf
  }
  return root
}

function renderPaneNode(node, tab) {
  if (node.kind === 'leaf') {
    const isLast = node.paneIdx === tab.panes.length - 1
    return renderPane(tab.panes[node.paneIdx], node.paneIdx, tab, isLast)
  }
  const container = document.createElement('div')
  container.className = `pane-split axis-${node.axis}`
  const [a, b] = node.children
  const flexA = node.invert ? node.size : 1 - node.size
  const flexB = node.invert ? 1 - node.size : node.size
  const slotA = document.createElement('div')
  slotA.className = 'pane-slot'
  slotA.style.flex = String(flexA)
  slotA.appendChild(renderPaneNode(a, tab))
  const slotB = document.createElement('div')
  slotB.className = 'pane-slot'
  slotB.style.flex = String(flexB)
  slotB.appendChild(renderPaneNode(b, tab))
  container.appendChild(slotA)
  container.appendChild(slotB)
  return container
}

function renderPane(pane, paneIdx, tab, isLast) {
  const frag = templates.pane.content.cloneNode(true)
  const card = frag.querySelector('.pane-card')
  card.querySelector('[data-pane-label]').textContent = paneIdx === 0 ? `Pane 1 (root)` : `Pane ${paneIdx + 1}`
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
  splitSel.addEventListener('change', () => { pane.split = splitSel.value; markDirty(); renderEditor() })
  bindNumber('size')
  bindText('profile'); bindText('dir'); bindText('command'); bindText('postCommand')
  bindNumber('postDelay')
  attachDirPicker(card, pane, 'dir')

  const splitRightBtn = card.querySelector('[data-action="splitRight"]')
  const splitDownBtn = card.querySelector('[data-action="splitDown"]')
  const doSplit = (dir) => {
    if (!isLast) {
      toast('wt splits the focused (last-added) pane — split from the last pane', 'error')
      return
    }
    tab.panes.push(normalizePane({ split: dir, profile: pane.profile || tab.profile, dir: pane.dir || tab.dir }))
    markDirty()
    renderEditor()
  }
  splitRightBtn.addEventListener('click', () => doSplit('right'))
  splitDownBtn.addEventListener('click', () => doSplit('down'))
  if (!isLast) {
    splitRightBtn.disabled = true
    splitDownBtn.disabled = true
    splitRightBtn.title = 'Only the last pane can be split (wt CLI constraint)'
    splitDownBtn.title = splitRightBtn.title
  }

  card.querySelector('[data-action="removePane"]').addEventListener('click', () => {
    if (tab.panes.length <= 1) { toast('Must keep at least one pane', 'error'); return }
    tab.panes.splice(paneIdx, 1)
    markDirty()
    renderEditor()
  })
  return card
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
