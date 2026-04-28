'use strict'

const path = require('node:path')
const { buildSignConfig } = require('./src/updater')

const ICON_BASE = path.resolve(__dirname, 'asset', 'logo')
const ICO = `${ICON_BASE}.ico`
const LOADING_GIF = path.resolve(__dirname, 'asset', 'logo-setup.gif')

const squirrelConfig = {
  name: 'Wrangler',
  setupExe: 'WranglerSetup.exe',
  setupIcon: ICO,
  loadingGif: LOADING_GIF,
  iconUrl: 'file:///' + ICO.replace(/\\/g, '/'),
  noMsi: true,
}

// Authenticode signing — opt-in via env. Set ONE of:
//   WRANGLER_SIGN_PARAMS   (raw signtool args; most flexible — supports HSMs, /sm /n CN= flows)
//   WRANGLER_CERT_FILE [+ WRANGLER_CERT_PASSWORD]   (.pfx file path + optional password)
// When neither is set the build produces an unsigned installer (SmartScreen warning on launch).
Object.assign(squirrelConfig, buildSignConfig(process.env) || {})

module.exports = {
  packagerConfig: {
    name: 'Wrangler',
    executableName: 'Wrangler',
    icon: ICON_BASE,
    asar: true,
    extraResource: ['asset/logo.png', 'asset/logo.ico'],
    ignore: [
      /^\/\.git($|\/)/,
      /^\/test($|\/)/,
      /^\/examples($|\/)/,
      /^\/scripts($|\/)/,
      /^\/\.claude($|\/)/,
      /^\/forge\.config\.js$/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: squirrelConfig,
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
}
