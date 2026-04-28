'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { reorderPanesForDrop, zoneToSplit, pickZone, reorderTabsForDrop, pickTabSide, splitFromPane } = require('../renderer/paneTree')

test('zoneToSplit maps zones to wt split directions', () => {
  assert.equal(zoneToSplit('top'), 'up')
  assert.equal(zoneToSplit('bottom'), 'down')
  assert.equal(zoneToSplit('left'), 'left')
  assert.equal(zoneToSplit('right'), 'right')
  assert.equal(zoneToSplit('weird'), null)
})

test('pickZone divides card into 4 triangular quadrants', () => {
  assert.equal(pickZone(0.5, 0.1), 'top')
  assert.equal(pickZone(0.5, 0.9), 'bottom')
  assert.equal(pickZone(0.1, 0.5), 'left')
  assert.equal(pickZone(0.9, 0.5), 'right')
})

test('drop right pane onto bottom of left → switches axis to top/bottom', () => {
  const panes = [
    { split: 'right', profile: 'P0' },
    { split: 'right', profile: 'P1' },
  ]
  const out = reorderPanesForDrop(panes, 1, 0, 'bottom')
  assert.deepEqual(out, [
    { split: 'right', profile: 'P0' },
    { split: 'down', profile: 'P1' },
  ])
})

test('drop preserves other pane fields (size, dir, command)', () => {
  const panes = [
    { split: 'right', profile: 'A', dir: '/a', command: 'ls', size: 0.4 },
    { split: 'right', profile: 'B', dir: '/b', command: 'pwd', size: 0.3 },
  ]
  const out = reorderPanesForDrop(panes, 1, 0, 'top')
  assert.deepEqual(out[1], { split: 'up', profile: 'B', dir: '/b', command: 'pwd', size: 0.3 })
})

test('reorder when dragIdx > targetIdx places dragged immediately after target', () => {
  const panes = [
    { profile: 'P0' },
    { split: 'right', profile: 'P1' },
    { split: 'down', profile: 'P2' },
    { split: 'right', profile: 'P3' },
  ]
  const out = reorderPanesForDrop(panes, 3, 1, 'right')
  assert.equal(out.length, 4)
  assert.equal(out[0].profile, 'P0')
  assert.equal(out[1].profile, 'P1')
  assert.deepEqual(out[2], { split: 'right', profile: 'P3' })
  assert.equal(out[3].profile, 'P2')
})

test('reorder when dragIdx < targetIdx places dragged immediately after target', () => {
  const panes = [
    { profile: 'P0' },
    { split: 'right', profile: 'P1' },
    { split: 'down', profile: 'P2' },
  ]
  const out = reorderPanesForDrop(panes, 1, 2, 'top')
  assert.equal(out.length, 3)
  assert.equal(out[0].profile, 'P0')
  assert.equal(out[1].profile, 'P2')
  assert.deepEqual(out[2], { split: 'up', profile: 'P1' })
})

test('returns null when dragging the root pane', () => {
  const panes = [{ profile: 'P0' }, { split: 'right', profile: 'P1' }]
  assert.equal(reorderPanesForDrop(panes, 0, 1, 'bottom'), null)
})

test('returns null when dropping on self', () => {
  const panes = [{ profile: 'P0' }, { split: 'right', profile: 'P1' }]
  assert.equal(reorderPanesForDrop(panes, 1, 1, 'bottom'), null)
})

test('returns null for invalid zone', () => {
  const panes = [{ profile: 'P0' }, { split: 'right', profile: 'P1' }]
  assert.equal(reorderPanesForDrop(panes, 1, 0, 'middle'), null)
})

test('does not mutate original panes array', () => {
  const panes = [{ profile: 'P0' }, { split: 'right', profile: 'P1' }]
  const snapshot = JSON.stringify(panes)
  reorderPanesForDrop(panes, 1, 0, 'top')
  assert.equal(JSON.stringify(panes), snapshot)
})

test('pickTabSide picks before/after by horizontal half', () => {
  assert.equal(pickTabSide(0.2), 'before')
  assert.equal(pickTabSide(0.5), 'after')
  assert.equal(pickTabSide(0.9), 'after')
})

test('reorderTabsForDrop moves a tab before the target', () => {
  const tabs = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }]
  const out = reorderTabsForDrop(tabs, 3, 1, 'before')
  assert.deepEqual(out.map(t => t.id), ['A', 'D', 'B', 'C'])
})

test('reorderTabsForDrop moves a tab after the target', () => {
  const tabs = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]
  const out = reorderTabsForDrop(tabs, 0, 2, 'after')
  assert.deepEqual(out.map(t => t.id), ['B', 'C', 'A'])
})

test('reorderTabsForDrop handles dragIdx < targetIdx with side adjustment', () => {
  const tabs = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }]
  const out = reorderTabsForDrop(tabs, 0, 2, 'before')
  assert.deepEqual(out.map(t => t.id), ['B', 'A', 'C', 'D'])
})

test('reorderTabsForDrop returns null on no-op moves', () => {
  const tabs = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]
  assert.equal(reorderTabsForDrop(tabs, 1, 1, 'before'), null)
  assert.equal(reorderTabsForDrop(tabs, 0, 1, 'before'), null)
  assert.equal(reorderTabsForDrop(tabs, 1, 0, 'after'), null)
})

test('reorderTabsForDrop returns null on bad inputs', () => {
  const tabs = [{ id: 'A' }, { id: 'B' }]
  assert.equal(reorderTabsForDrop(tabs, 0, 1, 'middle'), null)
  assert.equal(reorderTabsForDrop(tabs, -1, 0, 'before'), null)
  assert.equal(reorderTabsForDrop(tabs, 0, 5, 'before'), null)
})

test('reorderTabsForDrop does not mutate input', () => {
  const tabs = [{ id: 'A' }, { id: 'B' }, { id: 'C' }]
  const snap = JSON.stringify(tabs)
  reorderTabsForDrop(tabs, 2, 0, 'before')
  assert.equal(JSON.stringify(tabs), snap)
})

test('splitFromPane: last-pane split appends new pane with split=dir', () => {
  const panes = [
    { profile: 'P0' },
    { split: 'right', profile: 'P1' },
  ]
  const out = splitFromPane(panes, 1, 'down', { profile: 'P1', dir: 'C:\\d' })
  assert.deepEqual(out, [
    { profile: 'P0' },
    { split: 'right', profile: 'P1' },
    { split: 'down', profile: 'P1', dir: 'C:\\d' },
  ])
})

test('splitFromPane: middle-pane split moves source to end then appends new', () => {
  const panes = [
    { profile: 'A' },
    { split: 'right', profile: 'B' },
    { split: 'down', profile: 'C' },
  ]
  const out = splitFromPane(panes, 1, 'right', { profile: 'B' })
  // source (idx 1) moves to end; new pane appended after it
  assert.equal(out.length, 4)
  assert.equal(out[0].profile, 'A')
  assert.equal(out[1].profile, 'C')
  assert.equal(out[2].profile, 'B')
  assert.equal(out[3].profile, 'B')
  assert.equal(out[3].split, 'right')
})

test('splitFromPane: source pane retains its existing split field when moved', () => {
  const panes = [
    { profile: 'A' },
    { split: 'right', profile: 'B' },
    { split: 'down', profile: 'C' },
  ]
  const out = splitFromPane(panes, 1, 'right', { profile: 'B' })
  // moved B keeps split='right' (its original split direction)
  assert.equal(out[2].split, 'right')
})

test('splitFromPane: splitting pane[0] (tab root) promotes pane[1] to root', () => {
  const panes = [
    { profile: 'A' },
    { split: 'right', profile: 'B' },
    { split: 'down', profile: 'C' },
  ]
  const out = splitFromPane(panes, 0, 'right', { profile: 'A' })
  assert.equal(out.length, 4)
  // pane[0] (formerly B) should have its split field cleared since it's now root
  assert.equal(out[0].profile, 'B')
  assert.ok(!Object.hasOwn(out[0], 'split'), 'promoted root must not carry split field')
  assert.equal(out[1].profile, 'C')
  assert.equal(out[2].profile, 'A')
  // moved root previously had no split; assign default 'right'
  assert.ok(out[2].split, 'moved root must get a split field')
  assert.equal(out[3].profile, 'A')
  assert.equal(out[3].split, 'right')
})

test('splitFromPane: single-pane tab works as last-pane split', () => {
  const panes = [{ profile: 'P0' }]
  const out = splitFromPane(panes, 0, 'down', { profile: 'P0' })
  assert.equal(out.length, 2)
  assert.equal(out[1].split, 'down')
})

test('splitFromPane: rejects invalid sourceIdx', () => {
  assert.equal(splitFromPane([{}], -1, 'right', {}), null)
  assert.equal(splitFromPane([{}], 5, 'right', {}), null)
  assert.equal(splitFromPane(null, 0, 'right', {}), null)
})

test('splitFromPane: rejects invalid dir', () => {
  assert.equal(splitFromPane([{}], 0, 'sideways', {}), null)
  assert.equal(splitFromPane([{}], 0, '', {}), null)
})

test('splitFromPane: does not mutate input', () => {
  const panes = [{ profile: 'A' }, { split: 'right', profile: 'B' }, { split: 'down', profile: 'C' }]
  const snap = JSON.stringify(panes)
  splitFromPane(panes, 1, 'right', { profile: 'B' })
  assert.equal(JSON.stringify(panes), snap)
})

test('splitFromPane: new pane template is not aliased to source', () => {
  const panes = [{ profile: 'A' }, { split: 'right', profile: 'B' }]
  const tpl = { profile: 'NEW', dir: 'X' }
  const out = splitFromPane(panes, 1, 'down', tpl)
  out[out.length - 1].profile = 'MUTATED'
  assert.equal(tpl.profile, 'NEW', 'template should not be mutated by callers')
})
