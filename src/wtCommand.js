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

function composeShellCommand(pane) {
  const main = pane.command || ''
  const post = pane.postCommand || ''
  if (!post) return main
  const delay = Number.isFinite(pane.postDelay) ? pane.postDelay : 3
  const profile = (pane.profile || '').toLowerCase()
  const isCmd = profile === 'cmd' || profile === 'command prompt'
  const isBash = profile.includes('bash') || profile.includes('wsl') || profile.includes('ubuntu')
  if (isCmd) {
    const prefix = main ? `${main} & ` : ''
    return `${prefix}timeout /t ${delay} /nobreak >nul & ${post}`
  }
  if (isBash) {
    const prefix = main ? `${main}; ` : ''
    return `${prefix}sleep ${delay}; ${post}`
  }
  const prefix = main ? `${main}; ` : ''
  return `${prefix}Start-Sleep -Seconds ${delay}; ${post}`
}

function buildPaneArgs(pane, isFirstInTab) {
  const parts = []
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

function buildTab(tab) {
  const panes = Array.isArray(tab.panes) && tab.panes.length
    ? tab.panes
    : [{ profile: tab.profile, dir: tab.dir, command: tab.command }]
  const firstPane = {
    title: tab.title,
    profile: panes[0].profile || tab.profile,
    dir: panes[0].dir || tab.dir,
    command: panes[0].command,
    postCommand: panes[0].postCommand,
    postDelay: panes[0].postDelay,
  }
  const segments = [buildPaneArgs(firstPane, true)]
  for (let i = 1; i < panes.length; i++) {
    segments.push(buildPaneArgs(panes[i], false))
  }
  return segments.join(' ; ')
}

function resolveWindowTarget(layout) {
  const name = typeof layout.window === 'string' ? layout.window.trim() : ''
  return name || 'new'
}

function buildWtCommand(layout) {
  if (!layout || !Array.isArray(layout.tabs) || !layout.tabs.length) {
    throw new Error('layout must have at least one tab')
  }
  const head = ['wt', '-w', quoteArg(resolveWindowTarget(layout))]
  const tabSegments = layout.tabs.map(buildTab)
  return [head.join(' '), tabSegments.join(' ; ')].join(' ')
}

function buildWtArgv(layout) {
  if (!layout || !Array.isArray(layout.tabs) || !layout.tabs.length) {
    throw new Error('layout must have at least one tab')
  }
  const argv = ['-w', resolveWindowTarget(layout)]
  layout.tabs.forEach((tab, tabIdx) => {
    if (tabIdx > 0) argv.push(';')
    const panes = Array.isArray(tab.panes) && tab.panes.length
      ? tab.panes
      : [{ profile: tab.profile, dir: tab.dir, command: tab.command }]
    panes.forEach((pane, paneIdx) => {
      let profile = pane.profile
      let dir = pane.dir
      if (paneIdx === 0) {
        argv.push('new-tab')
        if (tab.title) argv.push('--title', tab.title)
        profile = profile || tab.profile
        dir = dir || tab.dir
      } else {
        argv.push(';')
        argv.push('split-pane')
        argv.push(SPLIT_FLAGS[pane.split] || '-V')
        if (Number.isFinite(pane.size)) argv.push('--size', String(pane.size))
      }
      if (profile) argv.push('-p', profile)
      if (dir) argv.push('-d', dir)
      const shellCmd = composeShellCommand({ ...pane, profile })
      if (shellCmd) argv.push(shellCmd)
    })
  })
  return argv
}

module.exports = { buildWtCommand, buildWtArgv, composeShellCommand, quoteArg, resolveWindowTarget }
