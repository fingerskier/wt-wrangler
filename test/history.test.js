'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const H = require('../renderer/history.js')

test('create returns empty state', () => {
  const h = H.create()
  assert.deepEqual(h.stack, [])
  assert.equal(h.idx, -1)
  assert.equal(H.canUndo(h), false)
  assert.equal(H.canRedo(h), false)
})

test('reset seeds a single snapshot', () => {
  const h = H.create()
  H.reset(h, { a: 1 }, 1000)
  assert.equal(h.stack.length, 1)
  assert.equal(h.idx, 0)
  assert.equal(H.canUndo(h), false)
  assert.equal(H.canRedo(h), false)
})

test('push appends and advances idx', () => {
  const h = H.create()
  H.reset(h, { v: 0 }, 0)
  H.push(h, { v: 1 }, { now: 1000 })
  H.push(h, { v: 2 }, { now: 2000 })
  assert.equal(h.stack.length, 3)
  assert.equal(h.idx, 2)
  assert.equal(H.canUndo(h), true)
  assert.equal(H.canRedo(h), false)
})

test('coalesce within window replaces top entry', () => {
  const h = H.create()
  H.reset(h, { v: 0 }, 0)
  H.push(h, { v: 1 }, { now: 1000 })
  H.push(h, { v: 2 }, { coalesce: true, now: 1100 })
  assert.equal(h.stack.length, 2)
  assert.deepEqual(h.stack[1], { v: 2 })
})

test('coalesce outside window still appends', () => {
  const h = H.create()
  H.reset(h, { v: 0 }, 0)
  H.push(h, { v: 1 }, { now: 1000 })
  H.push(h, { v: 2 }, { coalesce: true, now: 2000 })
  assert.equal(h.stack.length, 3)
})

test('undo returns prior snapshot and decrements idx', () => {
  const h = H.create()
  H.reset(h, { v: 0 }, 0)
  H.push(h, { v: 1 }, { now: 1000 })
  H.push(h, { v: 2 }, { now: 2000 })
  assert.deepEqual(H.undo(h), { v: 1 })
  assert.equal(h.idx, 1)
  assert.deepEqual(H.undo(h), { v: 0 })
  assert.equal(h.idx, 0)
  assert.equal(H.undo(h), null)
})

test('redo walks forward after undo', () => {
  const h = H.create()
  H.reset(h, { v: 0 }, 0)
  H.push(h, { v: 1 }, { now: 1000 })
  H.push(h, { v: 2 }, { now: 2000 })
  H.undo(h); H.undo(h)
  assert.deepEqual(H.redo(h), { v: 1 })
  assert.deepEqual(H.redo(h), { v: 2 })
  assert.equal(H.redo(h), null)
})

test('push after undo truncates the redo branch', () => {
  const h = H.create()
  H.reset(h, { v: 0 }, 0)
  H.push(h, { v: 1 }, { now: 1000 })
  H.push(h, { v: 2 }, { now: 2000 })
  H.undo(h)
  H.push(h, { v: 9 }, { now: 3000 })
  assert.equal(h.stack.length, 3)
  assert.deepEqual(h.stack[2], { v: 9 })
  assert.equal(H.canRedo(h), false)
})

test('coalesce after undo forks a new branch instead of replacing', () => {
  const h = H.create()
  H.reset(h, { v: 0 }, 0)
  H.push(h, { v: 1 }, { now: 1000 })
  H.push(h, { v: 2 }, { now: 2000 })
  H.undo(h)
  H.push(h, { v: 9 }, { coalesce: true, now: 2050 })
  assert.equal(h.stack.length, 3)
  assert.deepEqual(h.stack[2], { v: 9 })
  assert.equal(H.canRedo(h), false)
})

test('stack caps at MAX entries', () => {
  const h = H.create()
  H.reset(h, { v: 0 }, 0)
  for (let i = 1; i <= H.MAX + 10; i++) H.push(h, { v: i }, { now: i * 1000 })
  assert.equal(h.stack.length, H.MAX)
  assert.equal(h.stack[h.stack.length - 1].v, H.MAX + 10)
})
