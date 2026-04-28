'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { validateLayout } = require('../src/layoutSchema')

function ok(data) {
  return validateLayout(data)
}

const minimal = () => ({
  name: 'demo',
  tabs: [{ panes: [{ profile: 'pwsh', command: 'echo hi' }] }],
})

test('validateLayout: valid minimal layout', () => {
  const r = ok(minimal())
  assert.equal(r.ok, true)
  assert.equal(r.error, null)
  assert.deepEqual(r.warnings, [])
  assert.equal(r.data.tabs.length, 1)
})

test('validateLayout: full README example passes', () => {
  const data = {
    name: 'dev-cockpit',
    window: 'dev',
    tabs: [
      { title: 'App', panes: [
        { profile: 'pwsh', dir: 'C:\\dev\\app', command: 'npm run dev' },
        { split: 'right', size: 0.35, profile: 'cmd', dir: 'C:\\dev\\app', command: 'npm test' },
      ]},
      { title: 'Server', panes: [
        { profile: 'pwsh', command: 'npm run server' },
        { split: 'down', size: 0.4, profile: 'pwsh', command: 'npm run logs' },
      ]},
    ],
  }
  const r = ok(data)
  assert.equal(r.ok, true)
  assert.deepEqual(r.warnings, [])
})

test('validateLayout: null is invalid', () => {
  const r = ok(null)
  assert.equal(r.ok, false)
  assert.match(r.error, /object/i)
})

test('validateLayout: non-object is invalid', () => {
  assert.equal(ok('hi').ok, false)
  assert.equal(ok(42).ok, false)
  assert.equal(ok([]).ok, false)
})

test('validateLayout: missing tabs is invalid', () => {
  const r = ok({ name: 'x' })
  assert.equal(r.ok, false)
  assert.match(r.error, /tabs/i)
})

test('validateLayout: tabs not an array is invalid', () => {
  const r = ok({ name: 'x', tabs: 'nope' })
  assert.equal(r.ok, false)
  assert.match(r.error, /tabs/i)
})

test('validateLayout: empty tabs array is invalid', () => {
  const r = ok({ name: 'x', tabs: [] })
  assert.equal(r.ok, false)
  assert.match(r.error, /tabs/i)
})

test('validateLayout: tab missing panes is invalid', () => {
  const r = ok({ name: 'x', tabs: [{ title: 'A' }] })
  assert.equal(r.ok, false)
  assert.match(r.error, /pane/i)
})

test('validateLayout: tab panes empty is invalid', () => {
  const r = ok({ name: 'x', tabs: [{ panes: [] }] })
  assert.equal(r.ok, false)
  assert.match(r.error, /pane/i)
})

test('validateLayout: tab is not object → invalid', () => {
  const r = ok({ name: 'x', tabs: [null] })
  assert.equal(r.ok, false)
  assert.match(r.error, /tab/i)
})

test('validateLayout: pane is not object → invalid', () => {
  const r = ok({ name: 'x', tabs: [{ panes: [null] }] })
  assert.equal(r.ok, false)
  assert.match(r.error, /pane/i)
})

test('validateLayout: warnings — missing name', () => {
  const r = ok({ tabs: [{ panes: [{}] }] })
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some(w => /name/i.test(w)))
})

test('validateLayout: warnings — non-string name', () => {
  const r = ok({ name: 42, tabs: [{ panes: [{}] }] })
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some(w => /name/i.test(w)))
})

test('validateLayout: warnings — non-string window', () => {
  const r = ok({ name: 'x', window: 42, tabs: [{ panes: [{}] }] })
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some(w => /window/i.test(w)))
})

test('validateLayout: warnings — pane size out of range', () => {
  const data = { name: 'x', tabs: [{ panes: [{}, { split: 'right', size: 1.5 }] }] }
  const r = ok(data)
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some(w => /size/i.test(w)))
})

test('validateLayout: warnings — pane size non-numeric', () => {
  const data = { name: 'x', tabs: [{ panes: [{}, { split: 'right', size: 'half' }] }] }
  const r = ok(data)
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some(w => /size/i.test(w)))
})

test('validateLayout: warnings — invalid pane.split value', () => {
  const data = { name: 'x', tabs: [{ panes: [{}, { split: 'sideways' }] }] }
  const r = ok(data)
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some(w => /split/i.test(w)))
})

test('validateLayout: warnings — pane command non-string', () => {
  const data = { name: 'x', tabs: [{ panes: [{ command: 42 }] }] }
  const r = ok(data)
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some(w => /command/i.test(w)))
})

test('validateLayout: warnings — pane postDelay non-numeric', () => {
  const data = { name: 'x', tabs: [{ panes: [{ postCommand: 'x', postDelay: 'soon' }] }] }
  const r = ok(data)
  assert.equal(r.ok, true)
  assert.ok(r.warnings.some(w => /postDelay/i.test(w)))
})

test('validateLayout: returns the original data unchanged when ok', () => {
  const input = minimal()
  const r = ok(input)
  assert.equal(r.data, input)
})

test('validateLayout: data field is null when ok=false', () => {
  const r = ok(null)
  assert.equal(r.ok, false)
  assert.equal(r.data, null)
})

test('validateLayout: error references first failing tab index', () => {
  const data = { name: 'x', tabs: [
    { panes: [{}] },
    { panes: [] }, // tab[1] empty
  ]}
  const r = ok(data)
  assert.equal(r.ok, false)
  assert.match(r.error, /tab\s*1|index\s*1|second tab|tabs\[1\]/i)
})

test('validateLayout: error mentions which tab when panes missing', () => {
  const data = { name: 'x', tabs: [{ panes: [{}] }, { /* no panes */ }] }
  const r = ok(data)
  assert.equal(r.ok, false)
  assert.match(r.error, /tab/i)
})

test('validateLayout: warnings array non-mutated when no warnings', () => {
  const r = ok(minimal())
  assert.deepEqual(r.warnings, [])
  assert.ok(Array.isArray(r.warnings))
})

test('validateLayout: tolerates extra unknown keys without warning', () => {
  const data = { ...minimal(), arbitraryExtra: 'hello' }
  const r = ok(data)
  assert.equal(r.ok, true)
  assert.equal(r.warnings.length, 0)
})

test('validateLayout: pane.split valid values are right/left/down/up', () => {
  for (const split of ['right', 'left', 'down', 'up']) {
    const data = { name: 'x', tabs: [{ panes: [{}, { split, size: 0.5 }] }] }
    assert.equal(ok(data).ok, true, `split=${split} should be ok`)
    assert.equal(ok(data).warnings.length, 0, `split=${split} no warnings`)
  }
})
