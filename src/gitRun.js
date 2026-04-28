'use strict'

const DEFAULT_TIMEOUT_MS = 30000

// Spawn `git <args>` in `cwd`, collect stdout/stderr, and resolve with
// {code, stdout, stderr, timedOut}. If the child does not exit within
// timeoutMs, kill it and resolve with timedOut=true so callers (gh:update)
// can surface a "timeout" error class instead of hanging the renderer.
//
// Deps are injected so the timeout path is unit-testable without burning
// real wall-clock time. Production wires {spawn: child_process.spawn,
// setTimeout, clearTimeout}.
function runGit(deps, args, cwd, timeoutMs, env) {
  const { spawn, setTimeout: setTO, clearTimeout: clearTO } = deps
  const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  // Only attach env when caller actually passed something — undefined preserves
  // the existing behavior (child inherits the parent process env).
  const opts = { cwd, windowsHide: true }
  if (env !== undefined) opts.env = env
  return new Promise((resolve) => {
    const child = spawn('git', args, opts)
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer = null

    const finish = (result) => {
      if (settled) return
      settled = true
      if (timer) clearTO(timer)
      resolve(result)
    }

    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (err) => {
      finish({ code: -1, stdout, stderr: err.message || String(err), timedOut: false })
    })
    child.on('close', (code) => {
      finish({ code, stdout, stderr, timedOut: false })
    })

    timer = setTO(() => {
      // Resolve with timedOut first so a synchronous close emit from kill()
      // (e.g. a fake child in tests) can't race past us with timedOut=false.
      finish({
        code: -1,
        stdout,
        stderr: (stderr ? stderr + '\n' : '') + `timeout after ${ms}ms`,
        timedOut: true,
      })
      try { child.kill() } catch (_) {}
    }, ms)
  })
}

module.exports = { runGit, DEFAULT_TIMEOUT_MS }
