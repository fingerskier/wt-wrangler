'use strict'

;(function () {
  const MAX = 100
  const COALESCE_MS = 400

  function create() {
    return { stack: [], idx: -1, lastPushAt: 0 }
  }

  function reset(h, snap, now) {
    h.stack = [snap]
    h.idx = 0
    h.lastPushAt = now !== undefined ? now : Date.now()
  }

  function push(h, snap, opts) {
    opts = opts || {}
    const now = opts.now !== undefined ? opts.now : Date.now()
    const atTip = h.idx === h.stack.length - 1
    if (opts.coalesce && atTip && h.idx >= 0 && now - h.lastPushAt < COALESCE_MS) {
      h.stack[h.idx] = snap
      h.lastPushAt = now
      return
    }
    if (h.idx < h.stack.length - 1) h.stack = h.stack.slice(0, h.idx + 1)
    h.stack.push(snap)
    if (h.stack.length > MAX) h.stack.shift()
    h.idx = h.stack.length - 1
    h.lastPushAt = now
  }

  function undo(h) {
    if (h.idx <= 0) return null
    h.idx--
    return h.stack[h.idx]
  }

  function redo(h) {
    if (h.idx >= h.stack.length - 1) return null
    h.idx++
    return h.stack[h.idx]
  }

  function canUndo(h) { return h.idx > 0 }
  function canRedo(h) { return h.idx < h.stack.length - 1 }

  const api = { create, reset, push, undo, redo, canUndo, canRedo, MAX, COALESCE_MS }

  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.History = api
})()
