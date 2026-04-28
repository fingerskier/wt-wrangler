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

function wrapThroughShell(kind, script, opts) {
  // opts.requireQuotes signals the script uses shell metacharacters that need
  // to survive cmd.exe's argv split — `cmd /k bare & chain` would tokenize wrong.
  const requireQuotes = opts && opts.requireQuotes
  if (kind === 'cmd') return requireQuotes ? `cmd /k "${script}"` : `cmd /k ${script}`
  if (kind === 'bash') return `bash -i -c "${script.replace(/"/g, '\\"')}; exec bash"`
  return `powershell -NoExit -Command "${script.replace(/"/g, '\\"')}"`
}

function postDelaySeconds(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 3
  return n < 0 ? 0 : n
}

function composeChain(kind, main, post, delay) {
  // Compose the inner script (no shell wrapper yet). Each shell has different
  // sequencing + sleep syntax. Post runs in the SAME shell after main exits —
  // it does not inject into a running TUI/REPL child.
  if (kind === 'cmd') {
    const sleep = `timeout /t ${delay} /nobreak >nul`
    if (main && post) return `${main} & ${sleep} & ${post}`
    if (post) return `${sleep} & ${post}`
    return main
  }
  if (kind === 'bash') {
    const sleep = `sleep ${delay}`
    if (main && post) return `${main}; ${sleep}; ${post}`
    if (post) return `${sleep}; ${post}`
    return main
  }
  // pwsh / default
  const sleep = `Start-Sleep -Seconds ${delay}`
  if (main && post) return `${main}; ${sleep}; ${post}`
  if (post) return `${sleep}; ${post}`
  return main
}

function composeShellCommand(pane) {
  const main = pane.command || ''
  const post = pane.postCommand || ''
  if (!main && !post) return ''
  const kind = pane.shellKind || profileKind(pane.profile)
  const delay = postDelaySeconds(pane.postDelay)
  const script = composeChain(kind, main, post, delay)
  // cmd needs quotes around chained scripts so `&` survives argv tokenization.
  const requireQuotes = kind === 'cmd' && Boolean(post)
  return wrapThroughShell(kind, script, { requireQuotes })
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
  const panes = Array.isArray(tab.panes) && tab.panes.length ? tab.panes : [{}]
  const firstPane = { title: tab.title, ...panes[0] }
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
  layout.tabs.forEach((tab) => {
    const panes = Array.isArray(tab.panes) && tab.panes.length ? tab.panes : [{}]
    panes.forEach((pane, paneIdx) => {
      if (argv.length > 0) argv.push(';')
      argv.push('-w', target)
      if (paneIdx === 0) {
        argv.push('new-tab')
        if (tab.title) argv.push('--title', tab.title)
      } else {
        argv.push('split-pane')
        argv.push(SPLIT_FLAGS[pane.split] || '-V')
        if (Number.isFinite(pane.size)) argv.push('--size', String(pane.size))
      }
      if (pane.profile) argv.push('-p', pane.profile)
      if (pane.dir) argv.push('-d', pane.dir)
      const shellCmd = composeShellCommand(pane)
      if (shellCmd) argv.push(shellCmd)
    })
  })
  return argv
}

module.exports = { buildWtCommand, buildWtArgv, composeShellCommand, quoteArg, resolveWindowTarget, profileKind }
