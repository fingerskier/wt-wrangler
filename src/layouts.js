'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { writeFileAtomic } = require('./atomicWrite')

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

async function availableLayoutFile(dirPath, baseName) {
  // List dir once and lower-case-compare so case-insensitive Windows filesystems
  // are handled correctly: asking for 'foo' when 'FOO.json' exists should still
  // suffix, otherwise writing 'foo.json' would clobber FOO.json.
  let names
  try {
    names = await fs.readdir(dirPath)
  } catch (_) {
    names = []
  }
  const taken = new Set(names.map(n => n.toLowerCase()))
  const candidate = (suffix) => suffix === 0 ? `${baseName}.json` : `${baseName}_${suffix}.json`
  for (let i = 0; i < 1000; i++) {
    const name = candidate(i)
    if (!taken.has(name.toLowerCase())) return path.join(dirPath, name)
  }
  throw new Error(`could not find available filename for "${baseName}" after 1000 attempts`)
}

// Atomic layout writes: a power loss or process kill mid-write must not leave
// the user's saved layout truncated or corrupted. writeFileAtomic writes to a
// tmp sibling and renames into place; on rename failure the original file is
// left untouched and the tmp is cleaned up.
async function saveLayoutFile(fsApi, filePath, layout) {
  const pretty = JSON.stringify(layout, null, 2)
  await writeFileAtomic(fsApi, filePath, pretty)
  return filePath
}

async function saveNewLayoutFile(fsApi, dirPath, suggestedName, layout) {
  // availableLayoutFile uses fs/promises directly (it only reads); keep the
  // collision-safe naming logic centralized rather than reimplementing here.
  const target = await availableLayoutFile(dirPath, suggestedName)
  await writeFileAtomic(fsApi, target, JSON.stringify(layout, null, 2))
  return target
}

module.exports = { listEntries, moveLayoutFile, availableLayoutFile, saveLayoutFile, saveNewLayoutFile }
