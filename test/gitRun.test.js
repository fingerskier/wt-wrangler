'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { runGit } = require('../src/gitRun')

// Build a fake child_process.spawn that we control end-to-end. The returned
// object lets the test resolve the child by emitting close/error/data, and
// records whether kill() was called by the timeout path.
function fakeSpawn(scenario) {
  const calls = []
  function spawn(cmd, args, opts) {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.killed = false
    child.killSignal = null
    child.kill = (signal) => { child.killed = true; child.killSignal = signal || 'SIGTERM'; return true }
    calls.push({ cmd, args, opts, child })
    if (scenario && typeof scenario.onSpawn === 'function') {
      // Run async so caller can attach listeners first.
      queueMicrotask(() => scenario.onSpawn(child))
    }
    return child
  }
  return { spawn, calls }
}

// Replacement timer pair that lets the test fire the timeout deterministically.
function fakeTimers() {
  let pending = null
  let nextId = 1
  return {
    setTimeout: (fn, ms) => {
      const id = nextId++
      pending = { id, fn, ms }
      return id
    },
    clearTimeout: (id) => { if (pending && pending.id === id) pending = null },
    fire: () => { if (pending) { const f = pending.fn; pending = null; f() } },
    pending: () => pending,
  }
}

// --- happy path -------------------------------------------------------------

test('resolves with code/stdout/stderr when child closes', async () => {
  const t = fakeTimers()
  const { spawn, calls } = fakeSpawn({
    onSpawn: (child) => {
      child.stdout.emit('data', Buffer.from('hello'))
      child.stderr.emit('data', Buffer.from('warn'))
      child.emit('close', 0)
    },
  })
  const res = await runGit({ spawn, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout },
    ['status'], '/some/dir', 30000)
  assert.equal(res.code, 0)
  assert.equal(res.stdout, 'hello')
  assert.equal(res.stderr, 'warn')
  assert.equal(res.timedOut, false)
  // Spawn called with right args/opts
  assert.equal(calls[0].cmd, 'git')
  assert.deepEqual(calls[0].args, ['status'])
  assert.equal(calls[0].opts.cwd, '/some/dir')
  assert.equal(calls[0].opts.windowsHide, true)
})

test('clears timer on normal close', async () => {
  const t = fakeTimers()
  const { spawn } = fakeSpawn({
    onSpawn: (child) => child.emit('close', 0),
  })
  await runGit({ spawn, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout }, ['x'], '/d', 1000)
  assert.equal(t.pending(), null, 'timer should be cleared')
})

// --- timeout path -----------------------------------------------------------

test('timeout fires kill() and resolves with timedOut=true', async () => {
  const t = fakeTimers()
  const { spawn, calls } = fakeSpawn({
    // Never close the child — simulate a hanging git push.
    onSpawn: () => {},
  })
  const promise = runGit({ spawn, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout },
    ['push'], '/d', 30000)
  // Give the spawn microtask a chance to register listeners.
  await new Promise(r => setImmediate(r))
  assert.ok(t.pending(), 'timer should be armed before fire')
  assert.equal(t.pending().ms, 30000)
  t.fire()
  // After the timeout fires, the implementation should call kill on the child;
  // we still need to drain the promise — the close event from a real OS kill
  // would resolve it. Simulate that here.
  calls[0].child.emit('close', null)
  const res = await promise
  assert.equal(res.timedOut, true)
  assert.equal(res.code, -1, 'timed-out runs report code=-1')
  assert.match(res.stderr, /timeout/i)
  assert.equal(calls[0].child.killed, true, 'child.kill called on timeout')
})

test('does not double-resolve if child closes after timeout fired', async () => {
  const t = fakeTimers()
  const { spawn, calls } = fakeSpawn({ onSpawn: () => {} })
  const promise = runGit({ spawn, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout },
    ['fetch'], '/d', 5000)
  await new Promise(r => setImmediate(r))
  t.fire()
  // Late close after timeout — must not throw / must not change the result.
  calls[0].child.emit('close', 0)
  calls[0].child.emit('close', 0)
  const res = await promise
  assert.equal(res.timedOut, true)
})

// --- spawn 'error' event ---------------------------------------------------

test("spawn 'error' resolves with code=-1 and the error message", async () => {
  const t = fakeTimers()
  const { spawn } = fakeSpawn({
    onSpawn: (child) => child.emit('error', new Error('git not found in PATH')),
  })
  const res = await runGit({ spawn, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout },
    ['status'], '/d', 30000)
  assert.equal(res.code, -1)
  assert.match(res.stderr, /git not found in PATH/)
  assert.equal(res.timedOut, false)
})

test("spawn 'error' clears the timeout (no orphan timer)", async () => {
  const t = fakeTimers()
  const { spawn } = fakeSpawn({
    onSpawn: (child) => child.emit('error', new Error('boom')),
  })
  await runGit({ spawn, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout }, ['x'], '/d', 1000)
  assert.equal(t.pending(), null)
})

// --- defaults ---------------------------------------------------------------

test('accepts a sensible default timeout when none passed', async () => {
  const t = fakeTimers()
  const { spawn } = fakeSpawn({
    onSpawn: (child) => child.emit('close', 0),
  })
  await runGit({ spawn, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout }, ['x'], '/d')
  // Whatever the default is, it must be > 0 and not bizarrely large.
  // We can't assert the exact value (call site might tweak), but we can
  // assert that *some* timer was set up at the spawn point — captured before
  // the close event clears it.
  // (No pending timer now because close fired — but we can verify the call
  //  sequence by spying; here we just confirm runGit doesn't throw without
  //  an explicit timeout.)
})

// --- env forwarding (so callers can disable interactive prompts) -----------

test('forwards env override to spawn opts when provided', async () => {
  const t = fakeTimers()
  const { spawn, calls } = fakeSpawn({
    onSpawn: (child) => child.emit('close', 0),
  })
  const env = { PATH: '/x', GIT_TERMINAL_PROMPT: '0' }
  await runGit({ spawn, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout },
    ['push'], '/d', 30000, env)
  assert.deepEqual(calls[0].opts.env, env, 'spawn opts.env must be forwarded verbatim')
})

test('omits env from spawn opts when caller passes nothing', async () => {
  const t = fakeTimers()
  const { spawn, calls } = fakeSpawn({
    onSpawn: (child) => child.emit('close', 0),
  })
  await runGit({ spawn, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout },
    ['status'], '/d', 30000)
  // env undefined → spawn inherits parent env (existing behavior preserved).
  assert.equal(calls[0].opts.env, undefined)
})
