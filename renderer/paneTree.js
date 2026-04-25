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

  const api = { reorderPanesForDrop, zoneToSplit, pickZone, reorderTabsForDrop, pickTabSide }

  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.PaneTree = api
})()
