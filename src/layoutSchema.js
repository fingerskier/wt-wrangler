'use strict'

const VALID_SPLITS = ['right', 'left', 'down', 'up']

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function fail(msg) {
  return { ok: false, data: null, error: msg, warnings: [] }
}

function validateLayout(data) {
  if (!isPlainObject(data)) {
    return fail('layout must be an object')
  }
  if (!Array.isArray(data.tabs)) {
    return fail('layout.tabs must be an array')
  }
  if (data.tabs.length === 0) {
    return fail('layout.tabs is empty (need at least one tab)')
  }

  const warnings = []

  if (!Object.hasOwn(data, 'name') || data.name === '' || data.name === null || data.name === undefined) {
    warnings.push('layout.name is missing or empty (file basename will be used)')
  } else if (typeof data.name !== 'string') {
    warnings.push(`layout.name must be a string (got ${typeof data.name})`)
  }

  if (Object.hasOwn(data, 'window') && data.window !== null && data.window !== undefined && typeof data.window !== 'string') {
    warnings.push(`layout.window must be a string (got ${typeof data.window})`)
  }

  for (let ti = 0; ti < data.tabs.length; ti++) {
    const tab = data.tabs[ti]
    if (!isPlainObject(tab)) {
      return fail(`tabs[${ti}] must be an object`)
    }
    if (!Array.isArray(tab.panes)) {
      return fail(`tabs[${ti}].panes must be an array (need at least one pane)`)
    }
    if (tab.panes.length === 0) {
      return fail(`tabs[${ti}].panes is empty (need at least one pane)`)
    }
    if (Object.hasOwn(tab, 'title') && tab.title !== null && tab.title !== undefined && typeof tab.title !== 'string') {
      warnings.push(`tabs[${ti}].title must be a string`)
    }

    for (let pi = 0; pi < tab.panes.length; pi++) {
      const pane = tab.panes[pi]
      if (!isPlainObject(pane)) {
        return fail(`tabs[${ti}].panes[${pi}] must be an object`)
      }
      if (Object.hasOwn(pane, 'split')) {
        if (!VALID_SPLITS.includes(pane.split)) {
          warnings.push(`tabs[${ti}].panes[${pi}].split must be one of ${VALID_SPLITS.join('/')} (got ${JSON.stringify(pane.split)})`)
        }
      }
      if (Object.hasOwn(pane, 'size')) {
        const s = pane.size
        if (typeof s !== 'number' || !Number.isFinite(s)) {
          warnings.push(`tabs[${ti}].panes[${pi}].size must be a finite number (got ${JSON.stringify(s)})`)
        } else if (s <= 0 || s >= 1) {
          warnings.push(`tabs[${ti}].panes[${pi}].size out of range — must be (0, 1) (got ${s})`)
        }
      }
      for (const key of ['profile', 'dir', 'command', 'postCommand']) {
        if (Object.hasOwn(pane, key) && pane[key] !== null && pane[key] !== undefined && typeof pane[key] !== 'string') {
          warnings.push(`tabs[${ti}].panes[${pi}].${key} must be a string`)
        }
      }
      if (Object.hasOwn(pane, 'postDelay') && pane.postDelay !== null && pane.postDelay !== undefined) {
        const d = pane.postDelay
        if (typeof d !== 'number' || !Number.isFinite(d)) {
          warnings.push(`tabs[${ti}].panes[${pi}].postDelay must be a finite number`)
        }
      }
    }
  }

  return { ok: true, data, error: null, warnings }
}

module.exports = { validateLayout, VALID_SPLITS }
