'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const README = path.join(__dirname, '..', 'README.md')

function read() { return fs.readFileSync(README, 'utf8') }

test('README exists', () => {
  assert.ok(fs.existsSync(README))
})

test('README does not claim "command-builder unit tests" — suite covers many modules', () => {
  const md = read()
  assert.doesNotMatch(md, /command-builder unit tests/i,
    '"command-builder unit tests" is outdated; suite now spans 15+ modules')
})

test('README does not claim spawn lives in main.js (extracted to src/ipcHandlers.js)', () => {
  const md = read()
  // The old line read: "the process is spawned as `spawn(cmdString, ...)` in `main.js`."
  // After TODO #10 the spawn lives in src/ipcHandlers.js. Match the inaccurate phrasing.
  assert.doesNotMatch(md, /spawned as[^\n]*in\s*`?main\.js`?/i,
    'README says spawn lives in main.js — actually in src/ipcHandlers.js after the extraction')
})

test('README mentions src/ipcHandlers.js in the wt-command rules section', () => {
  const md = read()
  // Forward reference: the spawn rule should now point at the right file.
  assert.match(md, /ipcHandlers/, 'README should reference src/ipcHandlers.js where spawn lives')
})

test('README documents postCommand / postDelay (TODO #4 feature)', () => {
  const md = read()
  assert.match(md, /postCommand/i, 'postCommand should be documented in README features')
  assert.match(md, /postDelay/i, 'postDelay should be documented in README features')
})

test('README documents the auto-update env var WRANGLER_UPDATE_URL', () => {
  const md = read()
  assert.match(md, /WRANGLER_UPDATE_URL/, 'auto-update env var should be documented')
})

test('README documents code signing env vars', () => {
  const md = read()
  assert.match(md, /WRANGLER_SIGN_PARAMS/, 'sign-params env var should be documented')
  assert.match(md, /WRANGLER_CERT_FILE/, 'cert-file env var should be documented')
})
