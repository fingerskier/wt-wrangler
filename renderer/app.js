'use strict'

const state = {
  dir: null,
  layouts: [],
  currentPath: null,
  currentLayout: null,
  dirty: false,
  profiles: [],
  profileSource: null,
}

const el = {
  pickDir: document.getElementById('pickDir'),
  dirPath: document.getElementById('dirPath'),
  newLayout: document.getElementById('newLayout'),
  layoutList: document.getElementById('layoutList'),
  editor: document.getElementById('editor'),
  toast: document.getElementById('toast'),
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

async function pickDir() {
  const dir = await window.wt.pickDir()
  if (!dir) return
  state.dir = dir
  el.dirPath.textContent = dir
  el.dirPath.classList.remove('muted')
  el.newLayout.disabled = false
  await refreshList()
}

async function refreshList() {
  if (!state.dir) return
  state.layouts = await window.wt.list(state.dir)
  renderList()
}

function renderList() {
  el.layoutList.innerHTML = ''
  for (const entry of state.layouts) {
    const li = document.createElement('li')
    li.textContent = entry.name || entry.file
    if (entry.error) {
      li.classList.add('error')
      li.title = entry.error
    }
    if (entry.path === state.currentPath) li.classList.add('active')
    li.addEventListener('click', () => selectLayout(entry.path))
    el.layoutList.appendChild(li)
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
      const saved = await window.wt.saveNew(state.dir, serialized.name, serialized)
      state.currentPath = saved
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
loadProfiles()

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) { e.preventDefault(); e.returnValue = '' }
})
