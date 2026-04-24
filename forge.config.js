'use strict'

const path = require('node:path')

const ICON_BASE = path.resolve(__dirname, 'asset', 'logo')
const ICO = `${ICON_BASE}.ico`
const LOADING_GIF = path.resolve(__dirname, 'asset', 'logo-setup.gif')

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
      config: {
        name: 'Wrangler',
        setupExe: 'WranglerSetup.exe',
        setupIcon: ICO,
        loadingGif: LOADING_GIF,
        iconUrl: 'file:///' + ICO.replace(/\\/g, '/'),
        noMsi: true,
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
}
