'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'test.yml')

function readWorkflow() {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8')
}

test('CI workflow file exists at .github/workflows/test.yml', () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH), `expected ${WORKFLOW_PATH} to exist`)
})

test('CI workflow runs on windows-latest (wt-wrangler is Windows-only)', () => {
  const yaml = readWorkflow()
  assert.match(yaml, /runs-on:\s*windows-latest/, 'must run on windows-latest — wt.exe is Windows-only')
})

test('CI workflow triggers on push and pull_request', () => {
  const yaml = readWorkflow()
  // Top-level `on:` block must include both push and pull_request
  assert.match(yaml, /^on:/m, 'missing top-level "on:" trigger block')
  assert.match(yaml, /\bpush\b/, 'must trigger on push')
  assert.match(yaml, /\bpull_request\b/, 'must trigger on pull_request')
})

test('CI workflow targets the main branch', () => {
  const yaml = readWorkflow()
  assert.match(yaml, /\bmain\b/, 'must reference the main branch')
})

test('CI workflow installs deps with npm ci (lockfile-respecting)', () => {
  const yaml = readWorkflow()
  assert.match(yaml, /\bnpm ci\b/, 'must use "npm ci" (faster + lockfile-respecting) over "npm install"')
})

test('CI workflow runs npm test', () => {
  const yaml = readWorkflow()
  assert.match(yaml, /\bnpm test\b/, 'must run "npm test"')
})

test('CI workflow uses actions/checkout', () => {
  const yaml = readWorkflow()
  assert.match(yaml, /actions\/checkout@/, 'must use actions/checkout')
})

test('CI workflow uses actions/setup-node', () => {
  const yaml = readWorkflow()
  assert.match(yaml, /actions\/setup-node@/, 'must use actions/setup-node')
})

test('CI workflow pins to a Node version (>=20)', () => {
  const yaml = readWorkflow()
  // Match a setup-node `node-version: 20` or `'20.x'` or `>=20` form.
  assert.match(yaml, /node-version:\s*['"]?(2\d|3\d)/, 'must pin to Node 20+')
})
