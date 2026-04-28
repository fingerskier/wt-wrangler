'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const {
  parseJsonc,
  extractProfileNames,
  readProfilesFromFile,
  stripJsonc,
  stripTrailingCommas,
  discoverProfiles,
  DEFAULT_FALLBACK,
} = require('../src/wtProfiles')

const fixture = path.join(__dirname, 'fixtures', 'settings.jsonc')

test('stripJsonc removes line and block comments, preserves strings', () => {
  const input = 'a // stripped\n"b // kept"\n/* blocked */c'
  const out = stripJsonc(input)
  assert.ok(!out.includes('stripped'))
  assert.ok(!out.includes('blocked'))
  assert.ok(out.includes('"b // kept"'))
  assert.ok(out.includes('c'))
})

test('stripTrailingCommas removes trailing commas before } or ]', () => {
  assert.equal(stripTrailingCommas('{"a":1,}'), '{"a":1}')
  assert.equal(stripTrailingCommas('[1,2,]'), '[1,2]')
})

test('parseJsonc handles comments and trailing commas', () => {
  const obj = parseJsonc('{ /* c */ "a": 1, }')
  assert.deepEqual(obj, { a: 1 })
})

test('extractProfileNames filters hidden and dedupes', () => {
  const names = extractProfileNames({
    profiles: {
      list: [
        { name: 'A' },
        { name: 'B', hidden: true },
        { name: 'C' },
        { name: 'A' },
        { name: '' },
        null,
      ],
    },
  })
  assert.deepEqual(names, ['A', 'C'])
})

test('readProfilesFromFile parses WT-style JSONC fixture', () => {
  const names = readProfilesFromFile(fixture)
  assert.deepEqual(names, [
    'Windows PowerShell',
    'Command Prompt',
    'PowerShell',
    'Ubuntu-22.04',
    'Azure Cloud Shell',
  ])
})

test('discoverProfiles falls back when no settings found', () => {
  const origLocal = process.env.LOCALAPPDATA
  process.env.LOCALAPPDATA = path.join(__dirname, 'fixtures', 'does-not-exist')
  try {
    const res = discoverProfiles()
    assert.equal(res.source, null)
    assert.deepEqual(res.profiles, DEFAULT_FALLBACK)
    assert.equal(res.fallback, true)
    assert.ok(typeof res.error === 'string' && res.error.length > 0)
    assert.match(res.error, /no settings/i)
  } finally {
    process.env.LOCALAPPDATA = origLocal
  }
})

test('discoverProfiles when settings parsed: fallback=false, no error', () => {
  // Use the test fixtures dir as a fake LOCALAPPDATA — wire only via injected
  // candidate path. Build a candidate that points to the existing fixture by
  // calling discoverProfiles with an injected list.
  const { _withCandidates } = require('../src/wtProfiles')
  const candidate = path.join(__dirname, 'fixtures', 'settings.jsonc')
  const res = _withCandidates([candidate])
  assert.equal(res.fallback, false)
  assert.equal(res.source, candidate)
  assert.ok(res.profiles.length > 0)
  assert.equal(res.error, undefined)
})

test('discoverProfiles when settings file is unparseable: fallback=true, error mentions path', () => {
  const { _withCandidates } = require('../src/wtProfiles')
  const fs = require('node:fs')
  const os = require('node:os')
  const tmp = path.join(os.tmpdir(), `wt-wrangler-bad-${Date.now()}.jsonc`)
  fs.writeFileSync(tmp, '{ this is not json at all', 'utf8')
  try {
    const res = _withCandidates([tmp])
    assert.equal(res.fallback, true)
    assert.deepEqual(res.profiles, DEFAULT_FALLBACK)
    assert.ok(typeof res.error === 'string' && res.error.length > 0)
    assert.ok(res.error.includes(tmp), 'error should mention the candidate path')
  } finally {
    try { fs.unlinkSync(tmp) } catch (_) {}
  }
})

test('discoverProfiles when settings parses but yields zero profiles: fallback=true', () => {
  const { _withCandidates } = require('../src/wtProfiles')
  const fs = require('node:fs')
  const os = require('node:os')
  const tmp = path.join(os.tmpdir(), `wt-wrangler-empty-${Date.now()}.jsonc`)
  fs.writeFileSync(tmp, '{ "profiles": { "list": [] } }', 'utf8')
  try {
    const res = _withCandidates([tmp])
    assert.equal(res.fallback, true)
    assert.deepEqual(res.profiles, DEFAULT_FALLBACK)
    assert.match(res.error, /no profiles|empty/i)
  } finally {
    try { fs.unlinkSync(tmp) } catch (_) {}
  }
})

test('discoverProfiles tries multiple candidates and picks first parseable', () => {
  const { _withCandidates } = require('../src/wtProfiles')
  const candidate = path.join(__dirname, 'fixtures', 'settings.jsonc')
  const missing = path.join(__dirname, 'fixtures', 'does-not-exist.jsonc')
  const res = _withCandidates([missing, candidate])
  assert.equal(res.source, candidate)
  assert.equal(res.fallback, false)
})
