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
  } finally {
    process.env.LOCALAPPDATA = origLocal
  }
})
