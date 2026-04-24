'use strict'

const SPLIT_FLAGS = {
  right: '-V',
  left: '-V',
  down: '-H',
  up: '-H',
}

function quoteArg(value) {
  if (value === undefined || value === null || value === '') return ''
  const str = String(value)
  if (/^[A-Za-z0-9_\-.:\\/]+$/.test(str)) return str
  return `"${str.replace(/"/g, '\\"')}"`
}

function profileKind(profile) {
  const p = (profile || '').toLowerCase()
  if (p === 'cmd' || p === 'command prompt') return 'cmd'
  if (p.includes('bash') || p.includes('wsl') || p.includes('ubuntu')) return 'bash'
  return 'pwsh'
}

function wrapThroughShell(kind, script) {
  if (kind === 'cmd') return `cmd /k ${script}`
  if (kind === 'bash') return `bash -i -c "${script.replace(/"/g, '\\"')}; exec bash"`
  return `powershell -NoExit -Command "${script.replace(/"/g, '\\"')}"`
}

function composeShellCommand(pane) {
  const main = pane.command || ''
  if (!main) return ''
  return wrapThroughShell(profileKind(pane.profile), main)
}

function buildPaneArgs(pane, isFirstInTab, target) {
  const parts = ['-w', quoteArg(target)]
  if (isFirstInTab) {
    parts.push('new-tab')
    if (pane.title) parts.push('--title', quoteArg(pane.title))
  } else {
    parts.push('split-pane')
    const flag = SPLIT_FLAGS[pane.split] || '-V'
    parts.push(flag)
    if (Number.isFinite(pane.size)) parts.push('--size', String(pane.size))
  }
  if (pane.profile) parts.push('-p', quoteArg(pane.profile))
  if (pane.dir) parts.push('-d', quoteArg(pane.dir))
  const shellCmd = composeShellCommand(pane)
  if (shellCmd) parts.push(shellCmd)
  return parts.join(' ')
}

function buildTab(tab, target) {
  const panes = Array.isArray(tab.panes) && tab.panes.length
    ? tab.panes
    : [{ profile: tab.profile, dir: tab.dir, command: tab.command }]
  const firstPane = {
    title: tab.title,
    profile: panes[0].profile || tab.profile,
    dir: panes[0].dir || tab.dir,
    command: panes[0].command,
  }
  const segments = [buildPaneArgs(firstPane, true, target)]
  for (let i = 1; i < panes.length; i++) {
    segments.push(buildPaneArgs(panes[i], false, target))
  }
  return segments.join(' ; ')
}

function generateUniqueWindowName() {
  const suffix = Math.random().toString(36).slice(2, 8)
  return `wtw-${Date.now()}-${suffix}`
}

function resolveWindowTarget(layout) {
  const name = typeof layout.window === 'string' ? layout.window.trim() : ''
  return name || generateUniqueWindowName()
}

function buildWtCommand(layout) {
  if (!layout || !Array.isArray(layout.tabs) || !layout.tabs.length) {
    throw new Error('layout must have at least one tab')
  }
  const target = resolveWindowTarget(layout)
  const tabSegments = layout.tabs.map(tab => buildTab(tab, target))
  return ['wt', tabSegments.join(' ; ')].join(' ')
}

function buildWtArgv(layout) {
  if (!layout || !Array.isArray(layout.tabs) || !layout.tabs.length) {
    throw new Error('layout must have at least one tab')
  }
  const target = resolveWindowTarget(layout)
  const argv = []
  layout.tabs.forEach((tab, tabIdx) => {
    const panes = Array.isArray(tab.panes) && tab.panes.length
      ? tab.panes
      : [{ profile: tab.profile, dir: tab.dir, command: tab.command }]
    panes.forEach((pane, paneIdx) => {
      if (argv.length > 0) argv.push(';')
      argv.push('-w', target)
      let profile = pane.profile
      let dir = pane.dir
      if (paneIdx === 0) {
        argv.push('new-tab')
        if (tab.title) argv.push('--title', tab.title)
        profile = profile || tab.profile
        dir = dir || tab.dir
      } else {
        argv.push('split-pane')
        argv.push(SPLIT_FLAGS[pane.split] || '-V')
        if (Number.isFinite(pane.size)) argv.push('--size', String(pane.size))
      }
      if (profile) argv.push('-p', profile)
      if (dir) argv.push('-d', dir)
      const shellCmd = composeShellCommand({ ...pane, profile })
      if (shellCmd) argv.push(shellCmd)
    })
    void tabIdx
  })
  return argv
}

module.exports = { buildWtCommand, buildWtArgv, composeShellCommand, quoteArg, resolveWindowTarget }
