'use strict'

const PROFILE_KEYS = [
  'background',
  'unfocusedBackground',
  'opacity',
  'backgroundImage',
  'backgroundImageOpacity',
]

const WINDOW_KEYS = [
  'useMica',
  'showTabsInTitlebar',
  'useAcrylicInTabRow',
]

function styleProfileSubset(style) {
  if (!style || typeof style !== 'object') return {}
  const out = {}
  for (const k of PROFILE_KEYS) if (style[k] !== undefined) out[k] = style[k]
  return out
}

function styleWindowSubset(style) {
  if (!style || typeof style !== 'object') return {}
  const out = {}
  for (const k of WINDOW_KEYS) if (style[k] !== undefined) out[k] = style[k]
  return out
}

function hasProfileStyle(style) {
  return Object.keys(styleProfileSubset(style)).length > 0
}

function hasWindowStyle(style) {
  return Object.keys(styleWindowSubset(style)).length > 0
}

function fnv1aHex(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function makeGuid(seed) {
  // Deterministic 5x32-bit hex from seed; not RFC4122 v4, but a stable {GUID}.
  const a = fnv1aHex(seed + ':a')
  const b = fnv1aHex(seed + ':b')
  const c = fnv1aHex(seed + ':c')
  const d = fnv1aHex(seed + ':d')
  const e = fnv1aHex(seed + ':e')
  const x = (a + b).slice(0, 8)
  const y = (b + c).slice(0, 4)
  const z = (c + d).slice(0, 4)
  const w = (d + e).slice(0, 4)
  const v = (e + a + b).slice(0, 12)
  return `{${x}-${y}-${z}-${w}-${v}}`
}

function transientName(windowName, baseName) {
  const safeWin = String(windowName || 'window').replace(/[^A-Za-z0-9_\-]/g, '_')
  const safeBase = String(baseName || 'profile').replace(/[^A-Za-z0-9_\-]/g, '_')
  return `wtw-${safeWin}-${safeBase}`
}

function findProfileByName(settings, name) {
  if (!settings || typeof settings !== 'object') return null
  const list = settings.profiles && Array.isArray(settings.profiles.list)
    ? settings.profiles.list
    : Array.isArray(settings.profiles) ? settings.profiles : []
  for (const p of list) {
    if (p && typeof p === 'object' && typeof p.name === 'string' && p.name.trim() === name) return p
  }
  return null
}

function uniqueBaseProfiles(layout) {
  const out = []
  const seen = new Set()
  if (!layout || !Array.isArray(layout.tabs)) return out
  for (const tab of layout.tabs) {
    const panes = Array.isArray(tab.panes) ? tab.panes : []
    for (const p of panes) {
      const name = (p && typeof p.profile === 'string') ? p.profile.trim() : ''
      if (name && !seen.has(name)) { seen.add(name); out.push(name) }
    }
  }
  return out
}

function buildTransientProfile(baseProfile, windowName, style, baseNameOverride) {
  const baseName = baseNameOverride || (baseProfile && baseProfile.name) || 'default'
  const seed = `${windowName}::${baseName}`
  const next = baseProfile ? JSON.parse(JSON.stringify(baseProfile)) : {}
  next.name = transientName(windowName, baseName)
  next.guid = makeGuid(seed)
  next.hidden = true
  const sub = styleProfileSubset(style)
  for (const k of Object.keys(sub)) next[k] = sub[k]
  return next
}

function buildFragment(layout, settings) {
  const style = layout && layout.windowStyle
  if (!hasProfileStyle(style)) return { fragment: null, mapping: {} }
  const winName = (layout && typeof layout.window === 'string' && layout.window.trim())
    ? layout.window.trim()
    : 'wtw'
  const bases = uniqueBaseProfiles(layout)
  if (!bases.length) return { fragment: null, mapping: {} }
  const profiles = []
  const mapping = {}
  for (const baseName of bases) {
    const base = findProfileByName(settings, baseName)
    const transient = buildTransientProfile(base, winName, style, baseName)
    profiles.push(transient)
    mapping[baseName] = transient.name
  }
  return { fragment: { profiles }, mapping }
}

function applyWindowStyleToSettings(settings, style) {
  const sub = styleWindowSubset(style)
  if (!Object.keys(sub).length) return { settings, changed: false }
  const out = settings && typeof settings === 'object' ? { ...settings } : {}
  let changed = false
  for (const k of Object.keys(sub)) {
    if (out[k] !== sub[k]) { out[k] = sub[k]; changed = true }
  }
  return { settings: out, changed }
}

function remapLayoutProfiles(layout, mapping) {
  if (!mapping || !Object.keys(mapping).length) return layout
  const next = JSON.parse(JSON.stringify(layout))
  if (!Array.isArray(next.tabs)) return next
  for (const tab of next.tabs) {
    const panes = Array.isArray(tab.panes) ? tab.panes : []
    for (const p of panes) {
      if (p && typeof p.profile === 'string' && mapping[p.profile]) {
        p.profile = mapping[p.profile]
      }
    }
  }
  return next
}

module.exports = {
  PROFILE_KEYS,
  WINDOW_KEYS,
  styleProfileSubset,
  styleWindowSubset,
  hasProfileStyle,
  hasWindowStyle,
  uniqueBaseProfiles,
  findProfileByName,
  transientName,
  makeGuid,
  buildTransientProfile,
  buildFragment,
  applyWindowStyleToSettings,
  remapLayoutProfiles,
}
