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
  profileFallback: false,
  profileError: null,
  appSettings: { theme: 'workshop-plate', defaultProfile: null, defaultSaveSubdir: null, confirmOnDelete: true },
  themes: ['workshop-plate'],
}

const history = window.History.create()
const snapshotLayout = () => JSON.parse(JSON.stringify(state.currentLayout))
let suspendHistory = false

const el = {
  pickDir: document.getElementById('pickDir'),
  dirPath: document.getElementById('dirPath'),
  saveHint: document.getElementById('saveHint'),
  newLayout: document.getElementById('newLayout'),
  ghUpdate: document.getElementById('ghUpdate'),
  layoutList: document.getElementById('layoutList'),
  editor: document.getElementById('editor'),
  toast: document.getElementById('toast'),
  appSettingsBtn: document.getElementById('appSettingsBtn'),
  appSettingsRoot: document.getElementById('appSettingsRoot'),
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
  const profile = (state.appSettings && state.appSettings.defaultProfile) || 'pwsh'
  return {
    name: 'new-layout',
    window: '',
    windowStyle: window.WindowStyle.normalize(undefined),
    tabs: [
      {
        title: 'Tab 1',
        panes: [{ profile, dir: '', command: '' }],
      },
    ],
  }
}

function markDirty(opts) {
  state.dirty = true
  if (!suspendHistory && state.currentLayout) {
    const coalesce = !(opts && opts.structural)
    window.History.push(history, snapshotLayout(), { coalesce })
  }
  updateUndoRedoButtons()
  schedulePreview()
}

function updateUndoRedoButtons() {
  const undoBtn = el.editor.querySelector('[data-action="undo"]')
  const redoBtn = el.editor.querySelector('[data-action="redo"]')
  if (undoBtn) undoBtn.disabled = !window.History.canUndo(history)
  if (redoBtn) redoBtn.disabled = !window.History.canRedo(history)
}

function applyHistorySnapshot(snap) {
  if (!snap) return
  suspendHistory = true
  state.currentLayout = JSON.parse(JSON.stringify(snap))
  clampTabIdx()
  state.dirty = true
  renderEditor()
  suspendHistory = false
}

function undoAction() { applyHistorySnapshot(window.History.undo(history)) }
function redoAction() { applyHistorySnapshot(window.History.redo(history)) }

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
  updateGhButton()
  await refreshList()
  autoSelectSaveSubdir()
  if (state.saveDir !== state.dir) {
    updateSaveDirDisplay()
    renderList()
  }
}

async function updateGhButton() {
  if (!el.ghUpdate) return
  if (!state.dir) { el.ghUpdate.classList.add('hidden'); return }
  try {
    const isRepo = await window.wt.isGitRepo(state.dir)
    el.ghUpdate.classList.toggle('hidden', !isRepo)
  } catch (_) {
    el.ghUpdate.classList.add('hidden')
  }
}

async function ghUpdateAction() {
  if (!state.dir) return
  el.ghUpdate.disabled = true
  const prev = el.ghUpdate.textContent
  el.ghUpdate.textContent = '…'
  try {
    const res = await window.wt.ghUpdate(state.dir)
    if (res && res.ok) {
      toast(res.committed ? 'Pushed' : 'Up to date', 'success')
    } else {
      const step = res && res.step ? `[${res.step}] ` : ''
      const msg = res && res.error ? res.error : 'Unknown error'
      toast(`GH update failed: ${step}${msg}`, 'error')
      if (res && res.errorClass && res.errorClass !== 'unknown' && res.raw) {
        console.warn('[gh:update] raw:', res.raw)
      }
    }
  } catch (err) {
    toast('GH update failed: ' + (err.message || err), 'error')
  } finally {
    el.ghUpdate.disabled = false
    el.ghUpdate.textContent = prev
  }
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
  if (state.dir) {
    const rootLi = document.createElement('li')
    rootLi.classList.add('dir-item', 'root-item')
    if (state.saveDir === state.dir) rootLi.classList.add('selected')
    const basename = state.dir.split(/[\\/]/).filter(Boolean).pop() || state.dir
    rootLi.textContent = `⌂ ${basename}`
    rootLi.title = 'Click to save to root folder'
    rootLi.addEventListener('click', (e) => {
      e.stopPropagation()
      state.saveDir = state.dir
      updateSaveDirDisplay()
      renderList()
    })
    rootLi.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      e.stopPropagation()
      showContextMenu(e.clientX, e.clientY, [
        { label: 'Open in File Explorer', action: () => openDir(state.dir) },
      ])
    })
    attachDropTarget(rootLi, state.dir)
    el.layoutList.appendChild(rootLi)
  }
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
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Open in File Explorer', action: () => openDir(entry.path) },
        ])
      })
      attachDropTarget(li, entry.path)
      parentUl.appendChild(li)
      if (isOpen) {
        const kids = state.children.get(entry.path) || []
        renderEntries(kids, parentUl, depth + 1)
      }
    } else {
      li.classList.add('file-item')
      const label = entry.name || entry.file
      let badge = ''
      let title = ''
      if (entry.invalid || entry.error) {
        badge = ' ⛔'
        title = entry.error || 'invalid layout'
        li.classList.add('error')
      } else if (entry.warnings && entry.warnings.length) {
        badge = ' ⚠️'
        title = entry.warnings.join('\n')
        li.classList.add('warn')
      }
      li.textContent = label + badge
      if (title) li.title = title
      li.draggable = true
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', entry.path)
        li.classList.add('dragging')
      })
      li.addEventListener('dragend', () => li.classList.remove('dragging'))
      if (entry.path === state.currentPath) li.classList.add('active')
      li.addEventListener('click', () => selectLayout(entry.path))
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Run', action: () => runLayoutAt(entry.path) },
          { label: 'Open in File Explorer', action: () => openLayoutFirstDir(entry.path) },
        ])
      })
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
    const res = await window.wt.read(filePath)
    if (!res || !res.ok) {
      toast('Invalid layout: ' + (res && res.error ? res.error : 'unknown'), 'error')
      return
    }
    state.currentPath = filePath
    state.currentLayout = normalizeLayout(res.data)
    state.currentTabIdx = 0
    state.dirty = false
    window.History.reset(history, snapshotLayout())
    renderList()
    renderEditor()
    if (res.warnings && res.warnings.length) {
      toast(`Loaded with ${res.warnings.length} warning(s)`, 'success')
      console.warn('[layout warnings]', res.warnings)
    }
  } catch (err) {
    toast('Failed to read: ' + err.message, 'error')
  }
}

function normalizeLayout(layout) {
  const out = {
    name: layout.name || '',
    window: layout.window || '',
    windowStyle: window.WindowStyle.normalize(layout.windowStyle),
    tabs: Array.isArray(layout.tabs) ? layout.tabs.map(normalizeTab) : [],
  }
  if (!out.tabs.length) out.tabs.push(normalizeTab({}))
  return out
}

function normalizeTab(tab) {
  const panes = Array.isArray(tab.panes) && tab.panes.length
    ? tab.panes.map(normalizePane)
    : [normalizePane({})]
  if (tab.profile && !panes[0].profile) panes[0].profile = tab.profile
  if (tab.dir && !panes[0].dir) panes[0].dir = tab.dir
  return {
    title: tab.title || '',
    panes,
  }
}

function normalizePane(pane) {
  const out = {
    split: pane.split || 'right',
    size: typeof pane.size === 'number' ? pane.size : undefined,
    profile: pane.profile || '',
    dir: pane.dir || '',
    command: pane.command || '',
  }
  if (pane.postCommand) out.postCommand = pane.postCommand
  if (typeof pane.postDelay === 'number' && Number.isFinite(pane.postDelay)) out.postDelay = pane.postDelay
  return out
}

function newLayoutAction() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return
  state.currentPath = null
  state.currentLayout = emptyLayout()
  state.currentTabIdx = 0
  state.dirty = true
  window.History.reset(history, snapshotLayout())
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

  node.querySelector('[data-action="undo"]').addEventListener('click', undoAction)
  node.querySelector('[data-action="redo"]').addEventListener('click', redoAction)
  node.querySelector('[data-action="save"]').addEventListener('click', () => saveCurrent())
  node.querySelector('[data-action="run"]').addEventListener('click', runCurrent)
  node.querySelector('[data-action="delete"]').addEventListener('click', deleteCurrent)
  const paletteBtn = node.querySelector('[data-action="palette"]')
  if (paletteBtn) {
    paletteBtn.addEventListener('click', openPaletteModal)
    if (window.WindowStyle.hasAny(state.currentLayout.windowStyle)) {
      paletteBtn.classList.add('has-style')
    }
  }

  const tabbarHost = node.querySelector('[data-tabbar]')
  const tabViewHost = node.querySelector('[data-tab-view]')
  clampTabIdx()
  renderTabbar(tabbarHost)
  const activeTab = state.currentLayout.tabs[state.currentTabIdx]
  if (activeTab) tabViewHost.appendChild(renderTabView(activeTab, state.currentTabIdx))

  el.editor.appendChild(node)
  renderProfileOptions()
  renderPreview()
  updateUndoRedoButtons()
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
    btn.classList.add(`color-${idx % 4}`)
    if (idx === state.currentTabIdx) btn.classList.add('active')
    btn.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="removeTab"]')) return
      if (e.target.closest('[data-tab-title-input]')) return
      if (idx === state.currentTabIdx) return
      state.currentTabIdx = idx
      renderEditor()
    })
    title.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      e.preventDefault()
      beginTabTitleEdit(btn, title, tab, idx)
    })
    frag.querySelector('[data-action="removeTab"]').addEventListener('click', (e) => {
      e.stopPropagation()
      if (state.currentLayout.tabs.length <= 1) { toast('Must keep at least one tab', 'error'); return }
      state.currentLayout.tabs.splice(idx, 1)
      markDirty({ structural: true })
      renderEditor()
    })
    attachTabDnd(btn, idx)
    host.appendChild(frag)
  })
  const addBtn = document.createElement('button')
  addBtn.type = 'button'
  addBtn.className = 'tabbar-add'
  addBtn.textContent = '+ Tab'
  addBtn.addEventListener('click', () => {
    state.currentLayout.tabs.push(normalizeTab({ title: `Tab ${state.currentLayout.tabs.length + 1}` }))
    state.currentTabIdx = state.currentLayout.tabs.length - 1
    markDirty({ structural: true })
    renderEditor()
  })
  host.appendChild(addBtn)
}

function renderTabView(tab) {
  const frag = templates.tabView.content.cloneNode(true)
  const root = frag.querySelector('.tab-view-inner')
  const treeHost = root.querySelector('[data-pane-tree]')
  const tree = buildPaneTree(tab.panes)
  if (tree) treeHost.appendChild(renderPaneNode(tree, tab))
  return frag
}

function beginTabTitleEdit(btn, titleEl, tab, idx) {
  if (btn.querySelector('[data-tab-title-input]')) return
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'tabbar-title-input'
  input.setAttribute('data-tab-title-input', '')
  input.value = tab.title || ''
  input.placeholder = `Tab ${idx + 1}`
  titleEl.replaceWith(input)
  input.focus()
  input.select()
  let done = false
  const stop = (e) => e.stopPropagation()
  input.addEventListener('mousedown', stop)
  input.addEventListener('click', stop)
  input.addEventListener('dblclick', stop)
  const commit = (save) => {
    if (done) return
    done = true
    if (save) {
      const v = input.value.trim()
      if ((tab.title || '') !== v) {
        tab.title = v
        markDirty()
      }
    }
    const span = document.createElement('span')
    span.className = 'tabbar-title'
    span.setAttribute('data-tab-title', '')
    span.textContent = tab.title || `Tab ${idx + 1}`
    span.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      e.preventDefault()
      beginTabTitleEdit(btn, span, tab, idx)
    })
    input.replaceWith(span)
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); btn.focus() }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); btn.focus() }
  })
  input.addEventListener('blur', () => commit(true))
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
  card.classList.add(`color-${paneIdx % 4}`)
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
  splitSel.addEventListener('change', () => { pane.split = splitSel.value; markDirty({ structural: true }); renderEditor() })
  bindNumber('size')
  const profileSel = card.querySelector('[data-field="profile"]')
  populateProfileSelect(profileSel, pane.profile || '')
  profileSel.addEventListener('change', () => { pane.profile = profileSel.value; markDirty() })
  bindText('dir'); bindText('command'); bindText('postCommand')
  bindNumber('postDelay')
  attachDirPicker(card, pane, 'dir')

  const splitRightBtn = card.querySelector('[data-action="splitRight"]')
  const splitDownBtn = card.querySelector('[data-action="splitDown"]')
  const doSplit = (dir) => {
    if (!isLast) {
      toast('wt splits the focused (last-added) pane — split from the last pane', 'error')
      return
    }
    tab.panes.push(normalizePane({ split: dir, profile: pane.profile, dir: pane.dir }))
    markDirty({ structural: true })
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
    markDirty({ structural: true })
    renderEditor()
  })

  attachPaneDnd(card, pane, paneIdx, tab)
  return card
}

const DND_MIME = 'text/x-pane-idx'
const TAB_DND_MIME = 'text/x-tab-idx'

function clearTabDropZones() {
  document.querySelectorAll('.tabbar-item.tab-drop-active').forEach(n => {
    n.classList.remove('tab-drop-active', 'side-before', 'side-after')
  })
}

function attachTabDnd(btn, idx) {
  btn.dataset.tabIdx = String(idx)
  btn.setAttribute('draggable', 'true')

  btn.addEventListener('dragstart', (e) => {
    if (isEditableTarget(e.target)) { e.preventDefault(); return }
    e.dataTransfer.setData(TAB_DND_MIME, String(idx))
    e.dataTransfer.effectAllowed = 'move'
    btn.classList.add('tab-dragging')
  })

  btn.addEventListener('dragend', () => {
    btn.classList.remove('tab-dragging')
    clearTabDropZones()
  })

  btn.addEventListener('dragover', (e) => {
    const types = e.dataTransfer && e.dataTransfer.types
    if (!types || !Array.from(types).includes(TAB_DND_MIME)) return
    if (btn.classList.contains('tab-dragging')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = btn.getBoundingClientRect()
    const xFrac = (e.clientX - r.left) / r.width
    const side = window.PaneTree.pickTabSide(xFrac)
    btn.classList.add('tab-drop-active')
    btn.classList.remove('side-before', 'side-after')
    btn.classList.add(`side-${side}`)
  })

  btn.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && btn.contains(e.relatedTarget)) return
    btn.classList.remove('tab-drop-active', 'side-before', 'side-after')
  })

  btn.addEventListener('drop', (e) => {
    const raw = e.dataTransfer.getData(TAB_DND_MIME)
    if (raw === '') return
    e.preventDefault()
    clearTabDropZones()
    const dragIdx = Number(raw)
    if (!Number.isFinite(dragIdx)) return
    const r = btn.getBoundingClientRect()
    const xFrac = (e.clientX - r.left) / r.width
    const side = window.PaneTree.pickTabSide(xFrac)
    const tabs = state.currentLayout.tabs
    const next = window.PaneTree.reorderTabsForDrop(tabs, dragIdx, idx, side)
    if (!next) return
    const activeTab = tabs[state.currentTabIdx]
    state.currentLayout.tabs = next
    state.currentTabIdx = next.indexOf(activeTab)
    if (state.currentTabIdx < 0) state.currentTabIdx = 0
    markDirty({ structural: true })
    renderEditor()
  })
}


function clearDropZones() {
  document.querySelectorAll('.pane-drop-active').forEach(n => {
    n.classList.remove('pane-drop-active', 'zone-top', 'zone-right', 'zone-bottom', 'zone-left')
  })
}

function isEditableTarget(target) {
  if (!target) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

function attachPaneDnd(card, pane, paneIdx, tab) {
  card.dataset.paneIdx = String(paneIdx)
  if (paneIdx > 0) card.setAttribute('draggable', 'true')

  card.addEventListener('dragstart', (e) => {
    if (paneIdx === 0) { e.preventDefault(); return }
    if (isEditableTarget(e.target)) { e.preventDefault(); return }
    e.dataTransfer.setData(DND_MIME, String(paneIdx))
    e.dataTransfer.effectAllowed = 'move'
    card.classList.add('pane-dragging')
  })

  card.addEventListener('dragend', () => {
    card.classList.remove('pane-dragging')
    clearDropZones()
  })

  card.addEventListener('dragover', (e) => {
    const types = e.dataTransfer && e.dataTransfer.types
    if (!types || !Array.from(types).includes(DND_MIME)) return
    if (card.classList.contains('pane-dragging')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = card.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    const zone = window.PaneTree.pickZone(x, y)
    card.classList.add('pane-drop-active')
    card.classList.remove('zone-top', 'zone-right', 'zone-bottom', 'zone-left')
    card.classList.add(`zone-${zone}`)
  })

  card.addEventListener('dragleave', (e) => {
    if (e.relatedTarget && card.contains(e.relatedTarget)) return
    card.classList.remove('pane-drop-active', 'zone-top', 'zone-right', 'zone-bottom', 'zone-left')
  })

  card.addEventListener('drop', (e) => {
    const dragRaw = e.dataTransfer.getData(DND_MIME)
    if (dragRaw === '') return
    e.preventDefault()
    const dragIdx = Number(dragRaw)
    clearDropZones()
    if (!Number.isFinite(dragIdx)) return
    const r = card.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    const zone = window.PaneTree.pickZone(x, y)
    const next = window.PaneTree.reorderPanesForDrop(tab.panes, dragIdx, paneIdx, zone)
    if (!next) {
      if (dragIdx === 0) toast('Root pane cannot be moved', 'error')
      return
    }
    tab.panes = next
    markDirty({ structural: true })
    renderEditor()
  })
}

function serializeLayout() {
  const layout = state.currentLayout
  const styleOut = window.WindowStyle.serialize(layout.windowStyle)
  const out = {
    name: layout.name || 'layout',
    window: layout.window || undefined,
    windowStyle: styleOut,
    tabs: layout.tabs.map(tab => ({
      title: tab.title || undefined,
      panes: tab.panes.map((pane, idx) => {
        const p = {}
        if (idx > 0) {
          p.split = pane.split || 'right'
          if (Number.isFinite(pane.size)) p.size = pane.size
        }
        if (pane.profile) p.profile = pane.profile
        if (pane.dir) p.dir = pane.dir
        if (pane.command) p.command = pane.command
        return p
      }),
    })),
  }
  if (!out.window) delete out.window
  if (!out.windowStyle) delete out.windowStyle
  return out
}

async function saveCurrent(opts) {
  if (!state.currentLayout) return false
  const silent = opts && opts.silent
  const serialized = serializeLayout()
  try {
    if (state.currentPath) {
      await window.wt.save(state.currentPath, serialized)
    } else {
      if (!state.dir) { toast('Open a folder first', 'error'); return false }
      const target = state.saveDir || state.dir
      const saved = await window.wt.saveNew(target, serialized.name, serialized)
      state.currentPath = saved
      if (target !== state.dir) state.expanded.add(target)
    }
    state.dirty = false
    await refreshList()
    if (!silent) toast('Saved', 'success')
    return true
  } catch (err) {
    toast('Save failed: ' + err.message, 'error')
    return false
  }
}

async function runCurrent() {
  if (!state.currentLayout) return
  try {
    if (state.dirty && state.currentPath) {
      const ok = await saveCurrent({ silent: true })
      if (!ok) return
    }
    const serialized = serializeLayout()
    const res = await window.wt.run(serialized)
    const style = res && res.style
    if (style && Array.isArray(style.warnings) && style.warnings.length) {
      for (const w of style.warnings) toast('Style: ' + w, 'error')
    } else if (style && (style.applied?.profile || style.applied?.window)) {
      const parts = []
      if (style.applied.profile) parts.push('profile fragment')
      if (style.applied.window) parts.push('window settings')
      toast(`Style applied (${parts.join(' + ')}). Launching…`, 'success')
    } else {
      toast('Launching Windows Terminal…', 'success')
    }
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
  if (state.appSettings.confirmOnDelete && !confirm(`Delete ${state.currentPath}?`)) return
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
    state.profileFallback = !!res.fallback
    state.profileError = res.error || null
    renderProfileOptions()
    refreshProfileWarning()
  } catch (err) {
    console.warn('profile discovery failed:', err)
    state.profileFallback = true
    state.profileError = String(err.message || err)
    refreshProfileWarning()
  }
}

function refreshProfileWarning() {
  const editor = el.editor
  if (!editor) return
  editor.querySelectorAll('.profile-warn').forEach(n => n.remove())
  if (!state.profileFallback) return
  editor.querySelectorAll('select[data-field="profile"]').forEach(sel => {
    const span = document.createElement('span')
    span.className = 'profile-warn'
    span.textContent = '⚠️'
    span.title = `Using fallback profile list — ${state.profileError || 'WT settings.json could not be loaded'}`
    sel.parentNode.insertBefore(span, sel.nextSibling)
  })
}

function populateProfileSelect(sel, currentValue) {
  sel.innerHTML = ''
  const seen = new Set()
  const names = []
  for (const p of state.profiles) {
    if (p && !seen.has(p)) { seen.add(p); names.push(p) }
  }
  if (currentValue && !seen.has(currentValue)) { seen.add(currentValue); names.push(currentValue) }
  const blank = document.createElement('option')
  blank.value = ''
  blank.textContent = '(default)'
  sel.appendChild(blank)
  for (const name of names) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    sel.appendChild(opt)
  }
  sel.value = currentValue || ''
}

function renderProfileOptions() {
  el.editor.querySelectorAll('select[data-field="profile"]').forEach(sel => {
    populateProfileSelect(sel, sel.value)
  })
  refreshProfileWarning()
}

el.pickDir.addEventListener('click', pickDir)
el.newLayout.addEventListener('click', newLayoutAction)
if (el.ghUpdate) el.ghUpdate.addEventListener('click', ghUpdateAction)
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
async function runLayoutAt(filePath) {
  try {
    const res = await window.wt.read(filePath)
    if (!res || !res.ok) {
      toast('Run failed: ' + (res && res.error ? res.error : 'invalid layout'), 'error')
      return
    }
    await window.wt.run(normalizeLayout(res.data))
    toast('Launching Windows Terminal…', 'success')
  } catch (err) {
    toast('Run failed: ' + err.message, 'error')
  }
}

async function revealPath(targetPath) {
  try {
    await window.wt.reveal(targetPath)
  } catch (err) {
    toast('Reveal failed: ' + err.message, 'error')
  }
}

function findFirstLayoutDir(layout) {
  const tabs = Array.isArray(layout?.tabs) ? layout.tabs : []
  for (const tab of tabs) {
    const panes = Array.isArray(tab?.panes) ? tab.panes : []
    for (const pane of panes) {
      if (pane && typeof pane.dir === 'string' && pane.dir.trim()) return pane.dir
    }
    if (tab && typeof tab.dir === 'string' && tab.dir.trim()) return tab.dir
  }
  return null
}

async function openDir(dirPath) {
  try {
    const err = await window.wt.openPath(dirPath)
    if (err) toast('Open failed: ' + err, 'error')
  } catch (err) {
    toast('Open failed: ' + err.message, 'error')
  }
}

async function openLayoutFirstDir(filePath) {
  try {
    const res = await window.wt.read(filePath)
    if (!res || !res.ok) {
      toast('Read failed: ' + (res && res.error ? res.error : 'invalid layout'), 'error')
      return
    }
    const dir = findFirstLayoutDir(res.data)
    if (!dir) {
      toast('No dir set in layout — revealing JSON instead', 'error')
      await window.wt.reveal(filePath)
      return
    }
    const err = await window.wt.openPath(dir)
    if (err) toast('Open failed: ' + err, 'error')
  } catch (err) {
    toast('Open failed: ' + err.message, 'error')
  }
}

const modalRoot = document.getElementById('modalRoot')
const modalBody = document.getElementById('modalBody')
let modalPending = null

function openPaletteModal() {
  if (!state.currentLayout) return
  modalPending = window.WindowStyle.normalize(state.currentLayout.windowStyle)
  renderPaletteModal()
  modalRoot.classList.remove('hidden')
  modalRoot.setAttribute('aria-hidden', 'false')
  const first = modalBody.querySelector('input, select')
  if (first) first.focus()
}

function closeModal() {
  modalRoot.classList.add('hidden')
  modalRoot.setAttribute('aria-hidden', 'true')
  modalBody.innerHTML = ''
  modalPending = null
}

function renderPaletteModal() {
  modalBody.innerHTML = ''
  for (const def of window.WindowStyle.KEYS) {
    modalBody.appendChild(renderStyleField(def))
  }
}

function renderStyleField(def) {
  const wrap = document.createElement('label')
  wrap.className = `modal-field field-${def.type}`
  const labelText = document.createElement('span')
  labelText.className = 'modal-field-label'
  labelText.textContent = def.label
  wrap.appendChild(labelText)

  const cur = modalPending[def.key]
  let control
  if (def.type === 'bool') {
    control = document.createElement('select')
    for (const opt of [
      { v: '', t: '(unset)' },
      { v: 'true', t: 'true' },
      { v: 'false', t: 'false' },
    ]) {
      const o = document.createElement('option')
      o.value = opt.v
      o.textContent = opt.t
      control.appendChild(o)
    }
    control.value = cur === true ? 'true' : cur === false ? 'false' : ''
    control.addEventListener('change', () => {
      modalPending[def.key] = control.value === '' ? undefined : control.value === 'true'
    })
  } else if (def.type === 'percent') {
    control = document.createElement('input')
    control.type = 'number'
    control.min = '0'
    control.max = '100'
    control.step = '1'
    control.placeholder = def.hint || ''
    control.value = cur === undefined ? '' : String(cur)
    control.addEventListener('input', () => {
      const v = control.value === '' ? undefined : Number(control.value)
      modalPending[def.key] = Number.isFinite(v) ? Math.round(Math.max(0, Math.min(100, v))) : undefined
    })
  } else if (def.type === 'unit') {
    control = document.createElement('input')
    control.type = 'number'
    control.min = '0'
    control.max = '1'
    control.step = '0.05'
    control.placeholder = def.hint || ''
    control.value = cur === undefined ? '' : String(cur)
    control.addEventListener('input', () => {
      const v = control.value === '' ? undefined : Number(control.value)
      modalPending[def.key] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined
    })
  } else if (def.type === 'path') {
    const row = document.createElement('span')
    row.className = 'with-picker'
    control = document.createElement('input')
    control.type = 'text'
    control.placeholder = def.hint || ''
    control.value = cur || ''
    control.addEventListener('input', () => {
      const s = control.value.trim()
      modalPending[def.key] = s === '' ? undefined : s
    })
    const pick = document.createElement('button')
    pick.type = 'button'
    pick.textContent = '…'
    pick.title = 'Browse for image'
    pick.addEventListener('click', async () => {
      try {
        const start = control.value || state.dir || undefined
        const res = await window.wt.pickImage(start)
        if (res) { control.value = res; modalPending[def.key] = res }
      } catch (err) {
        toast('Pick failed: ' + (err.message || err), 'error')
      }
    })
    row.appendChild(control)
    row.appendChild(pick)
    wrap.appendChild(row)
    if (def.hint) {
      const hint = document.createElement('span')
      hint.className = 'modal-field-hint'
      hint.textContent = def.hint
      wrap.appendChild(hint)
    }
    return wrap
  } else {
    // color / string
    const row = document.createElement('span')
    row.className = 'color-row'
    control = document.createElement('input')
    control.type = 'text'
    control.placeholder = def.hint || ''
    control.value = cur || ''
    const swatch = document.createElement('input')
    swatch.type = 'color'
    swatch.className = 'color-swatch'
    swatch.value = isHex(cur) ? cur : '#000000'
    control.addEventListener('input', () => {
      const s = control.value.trim()
      modalPending[def.key] = s === '' ? undefined : s
      if (isHex(s)) swatch.value = s
    })
    swatch.addEventListener('input', () => {
      control.value = swatch.value
      modalPending[def.key] = swatch.value
    })
    row.appendChild(control)
    row.appendChild(swatch)
    wrap.appendChild(row)
    if (def.hint) {
      const hint = document.createElement('span')
      hint.className = 'modal-field-hint'
      hint.textContent = def.hint
      wrap.appendChild(hint)
    }
    return wrap
  }
  wrap.appendChild(control)
  if (def.hint) {
    const hint = document.createElement('span')
    hint.className = 'modal-field-hint'
    hint.textContent = def.hint
    wrap.appendChild(hint)
  }
  return wrap
}

function isHex(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)
}

function applyPaletteModal() {
  if (!state.currentLayout || !modalPending) { closeModal(); return }
  const next = window.WindowStyle.normalize(modalPending)
  const prev = window.WindowStyle.normalize(state.currentLayout.windowStyle)
  state.currentLayout.windowStyle = next
  if (JSON.stringify(prev) !== JSON.stringify(next)) {
    markDirty({ structural: true })
    renderEditor()
  }
  closeModal()
}

function resetPaletteModal() {
  modalPending = window.WindowStyle.normalize(undefined)
  renderPaletteModal()
}

if (modalRoot) {
  modalRoot.addEventListener('click', (e) => {
    const t = e.target
    if (!(t instanceof HTMLElement)) return
    if (t.matches('[data-modal-dismiss]') || t.matches('[data-action="modalCancel"]')) {
      closeModal()
    } else if (t.matches('[data-action="modalApply"]')) {
      applyPaletteModal()
    } else if (t.matches('[data-action="modalReset"]')) {
      resetPaletteModal()
    }
  })
}

function showContextMenu(x, y, items) {
  hideContextMenu()
  const menu = document.createElement('ul')
  menu.className = 'ctx-menu'
  menu.id = 'ctxMenu'
  for (const item of items) {
    const li = document.createElement('li')
    li.className = 'ctx-menu-item'
    li.textContent = item.label
    li.addEventListener('click', () => {
      hideContextMenu()
      item.action()
    })
    menu.appendChild(li)
  }
  menu.style.left = '0px'
  menu.style.top = '0px'
  document.body.appendChild(menu)
  const rect = menu.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const px = Math.min(x, vw - rect.width - 4)
  const py = Math.min(y, vh - rect.height - 4)
  menu.style.left = `${Math.max(0, px)}px`
  menu.style.top = `${Math.max(0, py)}px`
}

function hideContextMenu() {
  const m = document.getElementById('ctxMenu')
  if (m) m.remove()
}

window.addEventListener('click', hideContextMenu)
window.addEventListener('blur', hideContextMenu)
window.addEventListener('resize', hideContextMenu)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideContextMenu()
    if (modalRoot && !modalRoot.classList.contains('hidden')) closeModal()
  }
})
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.layout-list li')) hideContextMenu()
}, true)

async function loadAppSettings() {
  try {
    const res = await window.wt.appSettingsGet()
    if (res && res.settings) {
      state.appSettings = res.settings
      if (Array.isArray(res.themes) && res.themes.length) state.themes = res.themes
    }
  } catch (err) {
    console.warn('appSettings load failed:', err)
  }
  applyTheme()
}

function applyTheme() {
  const t = (state.appSettings && state.appSettings.theme) || 'workshop-plate'
  document.documentElement.dataset.theme = t
}

function autoSelectSaveSubdir() {
  const sub = state.appSettings && state.appSettings.defaultSaveSubdir
  if (!sub || !state.dir) return
  const entries = state.children.get(state.dir) || []
  const match = entries.find(e => e.type === 'dir' && e.name === sub)
  if (match) {
    state.saveDir = match.path
    if (!state.expanded.has(match.path)) state.expanded.add(match.path)
    updateSaveDirDisplay()
  }
}

function openAppSettings() {
  const root = el.appSettingsRoot
  if (!root) return
  const themeSel = root.querySelector('[data-setting="theme"]')
  themeSel.innerHTML = ''
  for (const t of state.themes) {
    const opt = document.createElement('option')
    opt.value = t
    opt.textContent = t
    if (t === state.appSettings.theme) opt.selected = true
    themeSel.appendChild(opt)
  }
  root.querySelector('[data-setting="defaultProfile"]').value = state.appSettings.defaultProfile || ''
  root.querySelector('[data-setting="defaultSaveSubdir"]').value = state.appSettings.defaultSaveSubdir || ''
  root.querySelector('[data-setting="confirmOnDelete"]').checked = !!state.appSettings.confirmOnDelete
  root.classList.remove('hidden')
  root.setAttribute('aria-hidden', 'false')
}

function closeAppSettings() {
  if (!el.appSettingsRoot) return
  el.appSettingsRoot.classList.add('hidden')
  el.appSettingsRoot.setAttribute('aria-hidden', 'true')
}

async function saveAppSettings() {
  const root = el.appSettingsRoot
  const patch = {
    theme: root.querySelector('[data-setting="theme"]').value || null,
    defaultProfile: (root.querySelector('[data-setting="defaultProfile"]').value || '').trim() || null,
    defaultSaveSubdir: (root.querySelector('[data-setting="defaultSaveSubdir"]').value || '').trim() || null,
    confirmOnDelete: !!root.querySelector('[data-setting="confirmOnDelete"]').checked,
  }
  try {
    const res = await window.wt.appSettingsSet(patch)
    if (res && res.settings) {
      state.appSettings = res.settings
      applyTheme()
      toast('Settings saved', 'success')
      autoSelectSaveSubdir()
      renderList()
    }
    closeAppSettings()
  } catch (err) {
    toast('Save failed: ' + err.message, 'error')
  }
}

if (el.appSettingsBtn) el.appSettingsBtn.addEventListener('click', openAppSettings)
if (el.appSettingsRoot) {
  el.appSettingsRoot.querySelectorAll('[data-app-settings-dismiss]').forEach(n => n.addEventListener('click', closeAppSettings))
  el.appSettingsRoot.querySelector('[data-action="appSettingsCancel"]').addEventListener('click', closeAppSettings)
  el.appSettingsRoot.querySelector('[data-action="appSettingsSave"]').addEventListener('click', saveAppSettings)
}

loadProfiles()
loadAppSettings().then(restoreLastDir)

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return
  const k = e.key.toLowerCase()
  const tag = (e.target && e.target.tagName) || ''
  if (k === 'z' && !e.shiftKey) {
    if (!state.currentLayout) return
    e.preventDefault(); undoAction()
  } else if ((k === 'z' && e.shiftKey) || k === 'y') {
    if (!state.currentLayout) return
    e.preventDefault(); redoAction()
  } else if (k === 's' && !e.shiftKey && tag !== 'TEXTAREA') {
    if (!state.currentLayout) return
    e.preventDefault(); saveCurrent()
  }
})

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = '' }
})
