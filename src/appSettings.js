'use strict'

const THEMES = ['workshop-plate', 'graphite']

const KNOWN_KEYS = ['theme', 'defaultProfile', 'defaultSaveSubdir', 'confirmOnDelete']

const DEFAULT_SETTINGS = Object.freeze({
  theme: 'workshop-plate',
  defaultProfile: null,
  defaultSaveSubdir: null,
  confirmOnDelete: true,
})

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function trimString(v) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length ? t : null
}

function normalizeSubdir(v) {
  // Strip whitespace, then trailing / or \ separators. Then validate.
  if (typeof v !== 'string') return null
  let s = v.trim()
  if (!s) return null
  s = s.replace(/[\\/]+$/, '')
  if (!isSafeSubdir(s)) return null
  return s
}

function isSafeSubdir(v) {
  if (typeof v !== 'string') return false
  const s = v.trim()
  if (!s) return false
  // Reject absolute paths.
  if (/^[\\/]/.test(s)) return false        // starts with / or \
  if (/^[A-Za-z]:[\\/]/.test(s)) return false // drive-letter absolute
  // Reject parent traversal in any segment (forward OR back slashes).
  const segments = s.split(/[\\/]+/)
  for (const seg of segments) {
    if (seg === '..' || seg === '.') return false
    if (!seg.length) return false
  }
  return true
}

function pickTheme(v) {
  return THEMES.includes(v) ? v : null
}

function pickBoolean(v) {
  return typeof v === 'boolean' ? v : null
}

function normalizeSettings(raw) {
  if (!isPlainObject(raw)) return { ...DEFAULT_SETTINGS }
  const theme = pickTheme(raw.theme) ?? DEFAULT_SETTINGS.theme
  const cod = pickBoolean(raw.confirmOnDelete)
  const confirmOnDelete = cod === null ? DEFAULT_SETTINGS.confirmOnDelete : cod
  const defaultProfile = trimString(raw.defaultProfile)
  const defaultSaveSubdir = normalizeSubdir(raw.defaultSaveSubdir)
  return { theme, defaultProfile, defaultSaveSubdir, confirmOnDelete }
}

function sanitizePatch(patch) {
  if (!isPlainObject(patch)) return {}
  const out = {}
  if (Object.hasOwn(patch, 'theme')) {
    const t = pickTheme(patch.theme)
    if (t) out.theme = t
  }
  if (Object.hasOwn(patch, 'confirmOnDelete')) {
    const b = pickBoolean(patch.confirmOnDelete)
    if (b !== null) out.confirmOnDelete = b
  }
  if (Object.hasOwn(patch, 'defaultProfile')) {
    if (patch.defaultProfile === null) out.defaultProfile = null
    else {
      const s = typeof patch.defaultProfile === 'string' ? patch.defaultProfile.trim() : null
      if (s === null) {
        // non-string, non-null → drop
      } else if (s === '') {
        out.defaultProfile = null
      } else {
        out.defaultProfile = s
      }
    }
  }
  if (Object.hasOwn(patch, 'defaultSaveSubdir')) {
    if (patch.defaultSaveSubdir === null) out.defaultSaveSubdir = null
    else {
      const v = normalizeSubdir(patch.defaultSaveSubdir)
      if (v !== null) out.defaultSaveSubdir = v
    }
  }
  return out
}

module.exports = { THEMES, DEFAULT_SETTINGS, KNOWN_KEYS, normalizeSettings, sanitizePatch, isSafeSubdir }
