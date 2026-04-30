'use strict'

const { profileKind } = require('./wtCommand')
const { findDefaultProfile } = require('./wtProfiles')

// Sentinel used in mapping/keys for panes that have no explicit profile
// ("(default)" in the renderer = empty string). Resolves at fragment-build
// time to the actual default profile from settings.json so background colors
// also apply to default-profile panes.
const DEFAULT_BASE_KEY = '(default)'

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

function transientName(windowName, baseName, discriminator) {
  const safeWin = String(windowName || 'window').replace(/[^A-Za-z0-9_\-]/g, '_')
  const safeBase = String(baseName || 'profile').replace(/[^A-Za-z0-9_\-]/g, '_')
  if (discriminator) {
    const safeDisc = String(discriminator).replace(/[^A-Za-z0-9_\-]/g, '_')
    return `wtw-${safeWin}-${safeDisc}-${safeBase}`
  }
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

function paneBaseKey(pane) {
  const raw = (pane && typeof pane.profile === 'string') ? pane.profile.trim() : ''
  return raw || DEFAULT_BASE_KEY
}

function uniqueBaseProfiles(layout) {
  const out = []
  const seen = new Set()
  if (!layout || !Array.isArray(layout.tabs)) return out
  for (const tab of layout.tabs) {
    const panes = Array.isArray(tab.panes) ? tab.panes : []
    for (const p of panes) {
      const key = paneBaseKey(p)
      if (!seen.has(key)) { seen.add(key); out.push(key) }
    }
  }
  return out
}

function buildTransientProfile(baseProfile, windowName, style, baseNameOverride, discriminator) {
  const baseName = baseNameOverride || (baseProfile && baseProfile.name) || 'default'
  const seed = `${windowName}::${discriminator || ''}::${baseName}`
  const next = baseProfile ? JSON.parse(JSON.stringify(baseProfile)) : {}
  next.name = transientName(windowName, baseName, discriminator)
  next.guid = makeGuid(seed)
  next.hidden = true
  const sub = styleProfileSubset(style)
  for (const k of Object.keys(sub)) next[k] = sub[k]
  return next
}

function buildFragment(layout, settings, discriminator) {
  const style = layout && layout.windowStyle
  if (!hasProfileStyle(style)) return { fragment: null, mapping: {} }
  const winName = (layout && typeof layout.window === 'string' && layout.window.trim())
    ? layout.window.trim()
    : 'wtw'
  const bases = uniqueBaseProfiles(layout)
  if (!bases.length) return { fragment: null, mapping: {} }
  const profiles = []
  const mapping = {}
  // Dedupe by the *resolved* base profile name so that when (default)
  // resolves to a profile that's also referenced explicitly elsewhere
  // (e.g. defaultProfile == "Command Prompt" + a pane that names it),
  // we emit a single transient — same seed → same GUID would otherwise
  // produce duplicates and trip WT's "duplicate GUID" startup error.
  const byResolvedName = new Map()
  for (const baseKey of bases) {
    let base, resolvedName
    if (baseKey === DEFAULT_BASE_KEY) {
      base = findDefaultProfile(settings)
      resolvedName = (base && typeof base.name === 'string' && base.name.trim()) || 'default'
    } else {
      base = findProfileByName(settings, baseKey)
      resolvedName = baseKey
    }
    const existing = byResolvedName.get(resolvedName)
    if (existing) {
      mapping[baseKey] = existing
      continue
    }
    const transient = buildTransientProfile(base, winName, style, resolvedName, discriminator)
    profiles.push(transient)
    mapping[baseKey] = transient.name
    byResolvedName.set(resolvedName, transient.name)
  }
  return { fragment: { profiles }, mapping }
}

function computeWindowKeyDelta(originalSettings, style) {
  const sub = styleWindowSubset(style)
  const out = {}
  for (const k of Object.keys(sub)) {
    const had = originalSettings && typeof originalSettings === 'object' &&
      Object.prototype.hasOwnProperty.call(originalSettings, k)
    out[k] = had
      ? { had: true, original: originalSettings[k], patched: sub[k] }
      : { had: false, patched: sub[k] }
  }
  return out
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
      if (!p || typeof p !== 'object') continue
      const raw = typeof p.profile === 'string' ? p.profile.trim() : ''
      const key = raw || DEFAULT_BASE_KEY
      if (!mapping[key]) continue
      if (!p.shellKind) p.shellKind = profileKind(raw)
      p.profile = mapping[key]
    }
  }
  return next
}

module.exports = {
  PROFILE_KEYS,
  WINDOW_KEYS,
  DEFAULT_BASE_KEY,
  styleProfileSubset,
  styleWindowSubset,
  hasProfileStyle,
  hasWindowStyle,
  paneBaseKey,
  uniqueBaseProfiles,
  findProfileByName,
  transientName,
  makeGuid,
  buildTransientProfile,
  buildFragment,
  applyWindowStyleToSettings,
  computeWindowKeyDelta,
  remapLayoutProfiles,
}
