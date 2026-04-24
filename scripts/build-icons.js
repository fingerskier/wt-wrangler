'use strict'

const path = require('node:path')
const fs = require('node:fs/promises')
const sharp = require('sharp')
const pngToIco = require('png-to-ico').default

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'asset', 'logo.png')
const OUT_ICO = path.join(ROOT, 'asset', 'logo.ico')
const OUT_GIF = path.join(ROOT, 'asset', 'logo-setup.gif')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const GIF_W = 640
const GIF_H = 480
const GIF_BG = { r: 26, g: 26, b: 26, alpha: 1 }

async function buildIco() {
  const base = sharp(SRC)
  const meta = await base.metadata()
  if (!meta.width || !meta.height) throw new Error(`bad logo.png: ${SRC}`)
  const pngBuffers = await Promise.all(
    ICO_SIZES.map(size =>
      sharp(SRC)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  )
  const ico = await pngToIco(pngBuffers)
  await fs.writeFile(OUT_ICO, ico)
  console.log(`wrote ${path.relative(ROOT, OUT_ICO)} (${ICO_SIZES.join(',')})`)
}

async function buildGif() {
  const logoSide = Math.min(GIF_W, GIF_H) - 80
  const logo = await sharp(SRC)
    .resize(logoSide, logoSide, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const left = Math.floor((GIF_W - logoSide) / 2)
  const top = Math.floor((GIF_H - logoSide) / 2)
  await sharp({
    create: { width: GIF_W, height: GIF_H, channels: 4, background: GIF_BG },
  })
    .composite([{ input: logo, left, top }])
    .gif()
    .toFile(OUT_GIF)
  console.log(`wrote ${path.relative(ROOT, OUT_GIF)} (${GIF_W}x${GIF_H})`)
}

async function main() {
  await fs.access(SRC)
  await buildIco()
  await buildGif()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
