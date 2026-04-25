'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { reorderPanesForDrop, zoneToSplit, pickZone } = require('../renderer/paneTree')

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
