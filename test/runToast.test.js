'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { interpretRunToast } = require('../renderer/runToast')

test('returns just "Launching" when no style was attempted', () => {
  const out = interpretRunToast({ pid: 1, style: { applied: { profile: false, window: false } } })
  assert.deepEqual(out, [{ kind: 'success', message: 'Launching Windows Terminal…' }])
})

test('returns just "Launching" when res has no style at all', () => {
  const out = interpretRunToast({ pid: 1 })
  assert.deepEqual(out, [{ kind: 'success', message: 'Launching Windows Terminal…' }])
})

test('returns just "Launching" when res itself is null/undefined', () => {
  assert.deepEqual(interpretRunToast(null), [{ kind: 'success', message: 'Launching Windows Terminal…' }])
  assert.deepEqual(interpretRunToast(undefined), [{ kind: 'success', message: 'Launching Windows Terminal…' }])
})

test('surfaces style.error before the launching toast (the bug R3.7 fixes)', () => {
  const out = interpretRunToast({ pid: 1, style: { error: 'LOCALAPPDATA not set' } })
  // First toast: error so the user sees what went wrong.
  assert.equal(out[0].kind, 'error')
  assert.match(out[0].message, /LOCALAPPDATA not set/)
  // Then we still tell them the terminal is launching — wt.exe was spawned regardless.
  assert.equal(out[1].kind, 'success')
  assert.match(out[1].message, /launching/i)
})

test('emits one error toast per warning, no success toast', () => {
  const out = interpretRunToast({
    pid: 1,
    style: { warnings: ['could not parse settings.json', 'fragment write skipped'], applied: { profile: false, window: false } },
  })
  assert.equal(out.length, 2)
  assert.equal(out[0].kind, 'error')
  assert.match(out[0].message, /Style:.*could not parse/)
  assert.equal(out[1].kind, 'error')
  assert.match(out[1].message, /Style:.*fragment write skipped/)
})

test('reports profile-only style as "Style applied (profile fragment)"', () => {
  const out = interpretRunToast({
    pid: 1,
    style: { applied: { profile: true, window: false }, warnings: [] },
  })
  assert.deepEqual(out, [{ kind: 'success', message: 'Style applied (profile fragment). Launching…' }])
})

test('reports window-only style as "Style applied (window settings)"', () => {
  const out = interpretRunToast({
    pid: 1,
    style: { applied: { profile: false, window: true }, warnings: [] },
  })
  assert.deepEqual(out, [{ kind: 'success', message: 'Style applied (window settings). Launching…' }])
})

test('reports both as "(profile fragment + window settings)"', () => {
  const out = interpretRunToast({
    pid: 1,
    style: { applied: { profile: true, window: true }, warnings: [] },
  })
  assert.deepEqual(out, [{ kind: 'success', message: 'Style applied (profile fragment + window settings). Launching…' }])
})

test('error wins over warnings — error path takes precedence', () => {
  const out = interpretRunToast({
    pid: 1,
    style: { error: 'boom', warnings: ['ignored when error present'] },
  })
  assert.equal(out[0].kind, 'error')
  assert.match(out[0].message, /boom/)
  // Warnings array is ignored when error is set — error is the more actionable signal.
  assert.equal(out.length, 2)
  assert.match(out[1].message, /launching/i)
})
