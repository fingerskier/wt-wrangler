'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const A = require('../src/wtStyleApply')

const sampleSettings = {
  useMica: false,
  profiles: {
    list: [
      { name: 'pwsh', guid: '{base-pwsh}', commandline: 'powershell.exe' },
      { name: 'cmd',  guid: '{base-cmd}',  commandline: 'cmd.exe' },
    ],
  },
}

const styledLayout = {
  name: 'foo',
  window: 'devwin',
  windowStyle: {
    background: '#112233',
    opacity: 80,
    useMica: true,
    showTabsInTitlebar: false,
  },
  tabs: [
    { title: 'a', panes: [{ profile: 'pwsh', command: 'x' }, { profile: 'cmd', split: 'right' }] },
    { title: 'b', panes: [{ profile: 'pwsh' }] },
  ],
}

test('hasProfileStyle / hasWindowStyle partition keys', () => {
  const s = styledLayout.windowStyle
  assert.equal(A.hasProfileStyle(s), true)
  assert.equal(A.hasWindowStyle(s), true)
  assert.equal(A.hasProfileStyle({ useMica: true }), false)
  assert.equal(A.hasWindowStyle({ background: '#000' }), false)
})

test('uniqueBaseProfiles dedupes pane profiles in order', () => {
  const out = A.uniqueBaseProfiles(styledLayout)
  assert.deepEqual(out, ['pwsh', 'cmd'])
})

test('buildTransientProfile clones base, hides, applies profile-level style', () => {
  const base = sampleSettings.profiles.list[0]
  const t = A.buildTransientProfile(base, 'devwin', styledLayout.windowStyle)
  assert.equal(t.name, 'wtw-devwin-pwsh')
  assert.equal(t.commandline, 'powershell.exe')
  assert.equal(t.hidden, true)
  assert.equal(t.background, '#112233')
  assert.equal(t.opacity, 80)
  // window-level keys must NOT bleed onto profile
  assert.equal(t.useMica, undefined)
  assert.match(t.guid, /^\{[0-9a-f-]+\}$/)
})

test('makeGuid is deterministic per seed', () => {
  assert.equal(A.makeGuid('seed-x'), A.makeGuid('seed-x'))
  assert.notEqual(A.makeGuid('seed-x'), A.makeGuid('seed-y'))
})

test('buildFragment returns one transient profile per unique base', () => {
  const { fragment, mapping } = A.buildFragment(styledLayout, sampleSettings)
  assert.ok(fragment)
  assert.equal(fragment.profiles.length, 2)
  assert.equal(mapping.pwsh, 'wtw-devwin-pwsh')
  assert.equal(mapping.cmd, 'wtw-devwin-cmd')
  for (const p of fragment.profiles) {
    assert.equal(p.background, '#112233')
    assert.equal(p.opacity, 80)
    assert.equal(p.hidden, true)
  }
})

test('buildFragment returns null when no profile-level style', () => {
  const layout = { ...styledLayout, windowStyle: { useMica: true } }
  const { fragment, mapping } = A.buildFragment(layout, sampleSettings)
  assert.equal(fragment, null)
  assert.deepEqual(mapping, {})
})

test('buildFragment handles unknown base profile (no settings hit)', () => {
  const layout = {
    window: 'w',
    windowStyle: { background: '#000' },
    tabs: [{ panes: [{ profile: 'mystery' }] }],
  }
  const { fragment, mapping } = A.buildFragment(layout, sampleSettings)
  assert.ok(fragment)
  assert.equal(fragment.profiles.length, 1)
  const p = fragment.profiles[0]
  assert.equal(p.name, 'wtw-w-mystery')
  assert.equal(p.background, '#000')
  assert.equal(mapping.mystery, 'wtw-w-mystery')
})

test('applyWindowStyleToSettings sets only window-level keys, returns changed flag', () => {
  const { settings, changed } = A.applyWindowStyleToSettings(sampleSettings, styledLayout.windowStyle)
  assert.equal(changed, true)
  assert.equal(settings.useMica, true)
  assert.equal(settings.showTabsInTitlebar, false)
  assert.equal(settings.background, undefined, 'profile-level keys must not land on root')
  // original untouched
  assert.equal(sampleSettings.useMica, false)
})

test('applyWindowStyleToSettings reports no-change when values already match', () => {
  const base = { useMica: true, showTabsInTitlebar: false }
  const { changed } = A.applyWindowStyleToSettings(base, { useMica: true, showTabsInTitlebar: false })
  assert.equal(changed, false)
})

test('applyWindowStyleToSettings is no-op when style has no window keys', () => {
  const { changed } = A.applyWindowStyleToSettings(sampleSettings, { background: '#000' })
  assert.equal(changed, false)
})

test('remapLayoutProfiles substitutes pane profile names per mapping', () => {
  const mapping = { pwsh: 'wtw-devwin-pwsh', cmd: 'wtw-devwin-cmd' }
  const next = A.remapLayoutProfiles(styledLayout, mapping)
  assert.equal(next.tabs[0].panes[0].profile, 'wtw-devwin-pwsh')
  assert.equal(next.tabs[0].panes[1].profile, 'wtw-devwin-cmd')
  assert.equal(next.tabs[1].panes[0].profile, 'wtw-devwin-pwsh')
  // original untouched
  assert.equal(styledLayout.tabs[0].panes[0].profile, 'pwsh')
})

test('remapLayoutProfiles is no-op for empty mapping', () => {
  const next = A.remapLayoutProfiles(styledLayout, {})
  assert.equal(next.tabs[0].panes[0].profile, 'pwsh')
})

test('transientName accepts an optional discriminator (collision avoidance)', () => {
  assert.equal(A.transientName('devwin', 'pwsh'), 'wtw-devwin-pwsh')
  assert.equal(A.transientName('devwin', 'pwsh', 'a1b2c3d4'), 'wtw-devwin-a1b2c3d4-pwsh')
})

test('buildFragment threads discriminator into transient profile names + mapping', () => {
  const { fragment, mapping } = A.buildFragment(styledLayout, sampleSettings, 'deadbeef')
  assert.equal(mapping.pwsh, 'wtw-devwin-deadbeef-pwsh')
  assert.equal(mapping.cmd, 'wtw-devwin-deadbeef-cmd')
  assert.equal(fragment.profiles[0].name, 'wtw-devwin-deadbeef-pwsh')
  assert.equal(fragment.profiles[1].name, 'wtw-devwin-deadbeef-cmd')
})

test('remapLayoutProfiles stashes original shellKind so shell wrapper survives remap', () => {
  const cmdLayout = {
    window: 'cwin',
    windowStyle: { background: '#000' },
    tabs: [{ title: 't', panes: [{ profile: 'Command Prompt', command: 'claude "start terse"' }] }],
  }
  const mapping = { 'Command Prompt': 'wtw-cwin-Command_Prompt' }
  const next = A.remapLayoutProfiles(cmdLayout, mapping)
  assert.equal(next.tabs[0].panes[0].profile, 'wtw-cwin-Command_Prompt')
  assert.equal(next.tabs[0].panes[0].shellKind, 'cmd')
})
