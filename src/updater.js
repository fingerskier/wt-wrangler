'use strict'

// Auto-update + Authenticode signing helpers. Pure module — IO/electron deps injected.
//
// Squirrel.Windows runtime check uses the electron `autoUpdater` module (passed in).
// Forge build-time signing config is materialized from env vars so a CI host can flip
// signing on without touching forge.config.js.

const DEFAULT_CHECK_DELAY_MS = 5_000

function getFeedURL(env) {
  if (!env || typeof env !== 'object') return null
  const raw = env.WRANGLER_UPDATE_URL
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length ? trimmed : null
}

function buildSignConfig(env) {
  if (!env || typeof env !== 'object') return null
  const params = typeof env.WRANGLER_SIGN_PARAMS === 'string' ? env.WRANGLER_SIGN_PARAMS.trim() : ''
  if (params) return { signWithParams: params }
  const certFile = typeof env.WRANGLER_CERT_FILE === 'string' ? env.WRANGLER_CERT_FILE.trim() : ''
  const certPass = typeof env.WRANGLER_CERT_PASSWORD === 'string' ? env.WRANGLER_CERT_PASSWORD : ''
  if (!certFile) return null
  const out = { certificateFile: certFile }
  if (certPass) out.certificatePassword = certPass
  return out
}

function maybeCheckForUpdates(opts) {
  const { feedURL, autoUpdater, isPackaged, platform, schedule, delayMs } = opts || {}
  if (!isPackaged) return false
  if (platform !== 'win32') return false
  if (!feedURL) return false
  if (!autoUpdater || typeof autoUpdater.setFeedURL !== 'function') return false
  try {
    autoUpdater.setFeedURL(feedURL)
  } catch (_) {
    return false
  }
  const ms = (typeof delayMs === 'number' && delayMs > 0) ? delayMs : DEFAULT_CHECK_DELAY_MS
  schedule(() => {
    try { autoUpdater.checkForUpdates() } catch (_) {}
  }, ms)
  return true
}

module.exports = { getFeedURL, buildSignConfig, maybeCheckForUpdates, DEFAULT_CHECK_DELAY_MS }
