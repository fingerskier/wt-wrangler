'use strict'

;(function () {
  const ZONE_TO_SPLIT = {
    top: 'up',
    bottom: 'down',
    left: 'left',
    right: 'right',
  }

  function zoneToSplit(zone) {
    return ZONE_TO_SPLIT[zone] || null
  }

  function pickZone(xFrac, yFrac) {
    const x = xFrac, y = yFrac
    if (y < x && y < 1 - x) return 'top'
    if (y > x && y > 1 - x) return 'bottom'
    if (x < y && x < 1 - y) return 'left'
    return 'right'
  }

  function reorderPanesForDrop(panes, dragIdx, targetIdx, zone) {
    if (!Array.isArray(panes)) return null
    if (dragIdx === 0) return null
    if (dragIdx === targetIdx) return null
    if (dragIdx < 0 || dragIdx >= panes.length) return null
    if (targetIdx < 0 || targetIdx >= panes.length) return null
    const split = zoneToSplit(zone)
    if (!split) return null
    const dragged = Object.assign({}, panes[dragIdx], { split })
    const out = panes.slice()
    out.splice(dragIdx, 1)
    const insertAt = dragIdx < targetIdx ? targetIdx : targetIdx + 1
    out.splice(insertAt, 0, dragged)
    return out
  }

  function pickTabSide(xFrac) {
    return xFrac < 0.5 ? 'before' : 'after'
  }

  function reorderTabsForDrop(tabs, dragIdx, targetIdx, side) {
    if (!Array.isArray(tabs)) return null
    if (side !== 'before' && side !== 'after') return null
    if (dragIdx < 0 || dragIdx >= tabs.length) return null
    if (targetIdx < 0 || targetIdx >= tabs.length) return null
    if (dragIdx === targetIdx) return null
    const baseIdx = side === 'after' ? targetIdx + 1 : targetIdx
    const insertAt = dragIdx < baseIdx ? baseIdx - 1 : baseIdx
    if (insertAt === dragIdx) return null
    const out = tabs.slice()
    const [item] = out.splice(dragIdx, 1)
    out.splice(insertAt, 0, item)
    return out
  }

  const VALID_SPLIT_DIRS = ['right', 'left', 'down', 'up']

  function clonePane(p) {
    return p && typeof p === 'object' ? { ...p } : {}
  }

  function splitFromPane(panes, sourceIdx, dir, template) {
    if (!Array.isArray(panes)) return null
    if (sourceIdx < 0 || sourceIdx >= panes.length) return null
    if (!VALID_SPLIT_DIRS.includes(dir)) return null
    const tpl = template && typeof template === 'object' ? { ...template } : {}
    const newPane = { ...tpl, split: dir }
    // Last-pane case: just append.
    if (sourceIdx === panes.length - 1) {
      return [...panes.map(clonePane), newPane]
    }
    // Middle-pane case: move source to end, then append.
    const out = panes.map(clonePane)
    const [moved] = out.splice(sourceIdx, 1)
    if (sourceIdx === 0) {
      // Source was the tab root (no split field). After move, the new pane[0]
      // becomes root — drop its split field. The moved-from-root pane needs a
      // default split since it now sits at the end of the chain.
      if (out.length > 0) delete out[0].split
      if (!moved.split) moved.split = 'right'
    }
    out.push(moved)
    out.push(newPane)
    return out
  }

  const api = { reorderPanesForDrop, zoneToSplit, pickZone, reorderTabsForDrop, pickTabSide, splitFromPane }

  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.PaneTree = api
})()
