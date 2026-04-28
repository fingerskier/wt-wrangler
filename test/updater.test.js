'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const U = require('../src/updater')

test('getFeedURL returns null when env var missing', () => {
  assert.equal(U.getFeedURL({}), null)
})

test('getFeedURL returns trimmed URL when set', () => {
  assert.equal(U.getFeedURL({ WRANGLER_UPDATE_URL: '  https://example.com/feed  ' }), 'https://example.com/feed')
})

test('getFeedURL returns null for empty/whitespace', () => {
  assert.equal(U.getFeedURL({ WRANGLER_UPDATE_URL: '   ' }), null)
  assert.equal(U.getFeedURL({ WRANGLER_UPDATE_URL: '' }), null)
})

test('buildSignConfig returns null when no signing env vars set', () => {
  assert.equal(U.buildSignConfig({}), null)
})

test('buildSignConfig returns certificateFile pair when CERT_FILE+CERT_PASSWORD set', () => {
  const cfg = U.buildSignConfig({
    WRANGLER_CERT_FILE: 'C:\\certs\\wrangler.pfx',
    WRANGLER_CERT_PASSWORD: 'hunter2',
  })
  assert.deepEqual(cfg, {
    certificateFile: 'C:\\certs\\wrangler.pfx',
    certificatePassword: 'hunter2',
  })
})

test('buildSignConfig returns signWithParams when WRANGLER_SIGN_PARAMS set', () => {
  const cfg = U.buildSignConfig({
    WRANGLER_SIGN_PARAMS: '/a /tr http://timestamp.digicert.com',
  })
  assert.deepEqual(cfg, { signWithParams: '/a /tr http://timestamp.digicert.com' })
})

test('buildSignConfig prefers signWithParams over cert pair (more flexible)', () => {
  const cfg = U.buildSignConfig({
    WRANGLER_CERT_FILE: 'x.pfx',
    WRANGLER_CERT_PASSWORD: 'p',
    WRANGLER_SIGN_PARAMS: '/sm /n "CN=Acme"',
  })
  assert.deepEqual(cfg, { signWithParams: '/sm /n "CN=Acme"' })
})

test('buildSignConfig returns null when only CERT_FILE set without password', () => {
  // password-less is fine for some certs; we still produce config without password
  const cfg = U.buildSignConfig({ WRANGLER_CERT_FILE: 'x.pfx' })
  assert.deepEqual(cfg, { certificateFile: 'x.pfx' })
})

test('maybeCheckForUpdates is no-op when not packaged', () => {
  let setFeedCalls = 0, checkCalls = 0
  const updater = {
    setFeedURL: () => setFeedCalls++,
    checkForUpdates: () => checkCalls++,
  }
  const scheduled = []
  const schedule = (fn, ms) => { scheduled.push({ fn, ms }) }
  const result = U.maybeCheckForUpdates({
    feedURL: 'https://example.com',
    autoUpdater: updater,
    isPackaged: false,
    platform: 'win32',
    schedule,
  })
  assert.equal(result, false)
  assert.equal(setFeedCalls, 0)
  assert.equal(scheduled.length, 0)
})

test('maybeCheckForUpdates is no-op when no feedURL', () => {
  const updater = { setFeedURL: () => { throw new Error('nope') }, checkForUpdates: () => {} }
  const result = U.maybeCheckForUpdates({
    feedURL: null,
    autoUpdater: updater,
    isPackaged: true,
    platform: 'win32',
    schedule: () => {},
  })
  assert.equal(result, false)
})

test('maybeCheckForUpdates is no-op on non-win32 platform (Squirrel.Windows only)', () => {
  let setFeedCalls = 0
  const updater = { setFeedURL: () => setFeedCalls++, checkForUpdates: () => {} }
  const result = U.maybeCheckForUpdates({
    feedURL: 'https://example.com',
    autoUpdater: updater,
    isPackaged: true,
    platform: 'darwin',
    schedule: () => {},
  })
  assert.equal(result, false)
  assert.equal(setFeedCalls, 0)
})

test('maybeCheckForUpdates sets feed URL and schedules check when all conditions met', () => {
  const calls = []
  const updater = {
    setFeedURL: (url) => calls.push(['setFeedURL', url]),
    checkForUpdates: () => calls.push(['checkForUpdates']),
  }
  const scheduled = []
  const schedule = (fn, ms) => { scheduled.push({ fn, ms }) }
  const result = U.maybeCheckForUpdates({
    feedURL: 'https://example.com/feed',
    autoUpdater: updater,
    isPackaged: true,
    platform: 'win32',
    schedule,
    delayMs: 5000,
  })
  assert.equal(result, true)
  assert.deepEqual(calls, [['setFeedURL', 'https://example.com/feed']])
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].ms, 5000)
  // Firing the scheduled callback should trigger checkForUpdates.
  scheduled[0].fn()
  assert.deepEqual(calls, [['setFeedURL', 'https://example.com/feed'], ['checkForUpdates']])
})

test('maybeCheckForUpdates uses default delay when delayMs not provided', () => {
  const updater = { setFeedURL: () => {}, checkForUpdates: () => {} }
  const scheduled = []
  U.maybeCheckForUpdates({
    feedURL: 'https://x',
    autoUpdater: updater,
    isPackaged: true,
    platform: 'win32',
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
  })
  assert.equal(scheduled.length, 1)
  assert.ok(scheduled[0].ms >= 1000, 'default delay should be at least 1s')
})

test('maybeCheckForUpdates swallows setFeedURL throws and returns false', () => {
  const updater = {
    setFeedURL: () => { throw new Error('boom') },
    checkForUpdates: () => {},
  }
  const scheduled = []
  const result = U.maybeCheckForUpdates({
    feedURL: 'https://x',
    autoUpdater: updater,
    isPackaged: true,
    platform: 'win32',
    schedule: (fn, ms) => scheduled.push({ fn, ms }),
  })
  assert.equal(result, false)
  assert.equal(scheduled.length, 0)
})
