'use strict'

;(function () {
  const KEYS = [
    { key: 'background',             type: 'color',  label: 'Background',           hint: '#rrggbb' },
    { key: 'unfocusedBackground',    type: 'color',  label: 'Unfocused background', hint: '#rrggbb' },
    { key: 'useMica',                type: 'bool',   label: 'Use Mica' },
    { key: 'showTabsInTitlebar',     type: 'bool',   label: 'Tabs in titlebar' },
    { key: 'useAcrylicInTabRow',     type: 'bool',   label: 'Acrylic tab row' },
    { key: 'opacity',                type: 'percent', label: 'Opacity (%)',          hint: '0-100' },
    { key: 'backgroundImage',        type: 'path',   label: 'Background image',     hint: 'file path' },
    { key: 'backgroundImageOpacity', type: 'unit',   label: 'Image opacity',        hint: '0.0-1.0' },
  ]

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }

  function normField(type, raw) {
    if (raw === undefined || raw === null) return undefined
    if (type === 'color' || type === 'path') {
      const s = String(raw).trim()
      return s === '' ? undefined : s
    }
    if (type === 'bool') return raw === true || raw === false ? raw : undefined
    if (type === 'percent') {
      const n = Number(raw)
      if (!Number.isFinite(n)) return undefined
      return Math.round(clamp(n, 0, 100))
    }
    if (type === 'unit') {
      const n = Number(raw)
      if (!Number.isFinite(n)) return undefined
      return clamp(n, 0, 1)
    }
    return undefined
  }

  function normalize(input) {
    const src = (input && typeof input === 'object') ? input : {}
    const out = {}
    for (const { key, type } of KEYS) out[key] = normField(type, src[key])
    return out
  }

  function serialize(style) {
    const norm = normalize(style)
    const out = {}
    let any = false
    for (const { key } of KEYS) {
      if (norm[key] !== undefined) { out[key] = norm[key]; any = true }
    }
    return any ? out : undefined
  }

  function hasAny(style) {
    const norm = normalize(style)
    for (const { key } of KEYS) if (norm[key] !== undefined) return true
    return false
  }

  const api = { KEYS, normalize, serialize, hasAny }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.WindowStyle = api
})()
