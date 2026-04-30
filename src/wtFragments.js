'use strict'

// WT-fragment filename + stale-detection helpers. Pure module — no IO.

function fnv1aHex8(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

function safeWindowName(layout) {
  const raw = layout && typeof layout.window === 'string' ? layout.window.trim() : ''
  if (!raw) return 'wtw'
  return raw.replace(/[^A-Za-z0-9_\-]/g, '_')
}

function styleHash(layout) {
  const style = (layout && layout.windowStyle && typeof layout.windowStyle === 'object') ? layout.windowStyle : {}
  // Sorted-key serialization keeps the hash stable across object-key reorderings.
  const keys = Object.keys(style).sort()
  const normalized = keys.map(k => [k, style[k]])
  const seed = JSON.stringify({ window: safeWindowName(layout), style: normalized })
  return fnv1aHex8(seed)
}

function fragmentFileName(layout) {
  return `${safeWindowName(layout)}-${styleHash(layout)}.json`
}

function staleFragmentFiles(entries, keepSet, now, maxAgeMs) {
  if (!Array.isArray(entries) || entries.length === 0) return []
  const cutoff = now - maxAgeMs
  const out = []
  for (const e of entries) {
    if (!e || typeof e.name !== 'string') continue
    if (!e.name.endsWith('.json')) continue
    if (e.name.endsWith('.tmp')) continue
    if (keepSet && keepSet.has(e.name)) continue
    if (typeof e.mtimeMs !== 'number') continue
    if (e.mtimeMs <= cutoff) out.push(e.name)
  }
  return out
}

function hasDuplicateProfileGuids(fragmentJson) {
  if (!fragmentJson || typeof fragmentJson !== 'object') return false
  const profiles = Array.isArray(fragmentJson.profiles) ? fragmentJson.profiles : []
  const seen = new Set()
  for (const p of profiles) {
    if (!p || typeof p !== 'object') continue
    const g = typeof p.guid === 'string' ? p.guid.trim().toLowerCase() : ''
    if (!g) continue
    if (seen.has(g)) return true
    seen.add(g)
  }
  return false
}

module.exports = { styleHash, fragmentFileName, safeWindowName, staleFragmentFiles, hasDuplicateProfileGuids }
