'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

async function listEntries(dirPath) {
  if (!dirPath) return []
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const dirs = entries
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort()
  const files = entries
    .filter(d => d.isFile() && d.name.toLowerCase().endsWith('.json'))
    .map(d => d.name)
    .sort()
  const out = []
  for (const name of dirs) {
    out.push({ type: 'dir', name, path: path.join(dirPath, name) })
  }
  for (const name of files) {
    const full = path.join(dirPath, name)
    try {
      const raw = await fs.readFile(full, 'utf8')
      const data = JSON.parse(raw)
      out.push({ type: 'file', file: name, path: full, name: data.name || name.replace(/\.json$/i, '') })
    } catch (err) {
      out.push({ type: 'file', file: name, path: full, name, error: String(err.message || err) })
    }
  }
  return out
}

async function moveLayoutFile(srcPath, destDir) {
  const name = path.basename(srcPath)
  const target = path.join(destDir, name)
  if (path.resolve(srcPath) === path.resolve(target)) return target
  const exists = await fs.stat(target).then(() => true).catch(() => false)
  if (exists) throw new Error(`Destination already has ${name}`)
  try {
    await fs.rename(srcPath, target)
  } catch (err) {
    if (err.code === 'EXDEV') {
      await fs.copyFile(srcPath, target)
      await fs.unlink(srcPath)
    } else {
      throw err
    }
  }
  return target
}

module.exports = { listEntries, moveLayoutFile }
