'use strict'

// Write content to a tmp sibling and rename it into place. If the rename
// fails (target dir missing, permission denied, antivirus lock, …) the tmp
// file is unlinked so we don't accumulate orphans across runs. The unlink
// is best-effort: if it also fails, we still throw the original rename
// error so the caller sees the actual problem rather than the cleanup
// failure that would otherwise mask it.
async function writeFileAtomic(fsApi, filePath, content) {
  const tmp = `${filePath}.wtw-tmp-${process.pid}-${Date.now()}`
  await fsApi.writeFile(tmp, content, 'utf8')
  try {
    await fsApi.rename(tmp, filePath)
  } catch (err) {
    try { await fsApi.unlink(tmp) } catch (_) {}
    throw err
  }
}

module.exports = { writeFileAtomic }
