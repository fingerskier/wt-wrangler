'use strict'

const AUTH_PATTERNS = [
  /authentication failed/i,
  /could not read username/i,
  /could not read password/i,
  /permission denied \(publickey\)/i,
  /\b403\b/,
  /remote: permission to .* denied/i,
  /terminal prompts disabled/i,
]

const NON_FAST_FORWARD_PATTERNS = [
  /non-fast-forward/i,
  /\[rejected\]/i,
  /updates were rejected/i,
  /fetch first/i,
  /failed to push some refs/i,
]

const DETACHED_HEAD_PATTERNS = [
  /head detached/i,
  /not currently on a branch/i,
  /head does not refer to a branch/i,
  /detached head/i,
]

const NO_UPSTREAM_PATTERNS = [
  /has no upstream branch/i,
  /--set-upstream/i,
]

const MESSAGES = {
  auth: 'Auth required — push from a terminal to enter credentials',
  nonFastForward: 'Remote is ahead — pull/rebase before pushing',
  detachedHead: 'Detached HEAD — checkout a branch before pushing',
  noUpstream: 'Branch has no upstream — run `git push -u origin <branch>` once from a terminal to set tracking',
}

function any(patterns, text) {
  for (const p of patterns) if (p.test(text)) return true
  return false
}

function classifyGitError(stderr, stdout, step) {
  const err = typeof stderr === 'string' ? stderr : ''
  const out = typeof stdout === 'string' ? stdout : ''
  const blob = `${err}\n${out}`
  // Priority: auth > detachedHead > noUpstream > nonFastForward. Auth eclipses
  // all (you can't even talk to the remote). Detached eclipses the rest because
  // the ref-rejection is downstream of the missing branch. noUpstream is more
  // specific and actionable than the generic "rejected" wording so it wins over
  // nonFastForward.
  if (any(AUTH_PATTERNS, blob)) {
    return { class: 'auth', message: MESSAGES.auth, step }
  }
  if (any(DETACHED_HEAD_PATTERNS, blob)) {
    return { class: 'detachedHead', message: MESSAGES.detachedHead, step }
  }
  if (any(NO_UPSTREAM_PATTERNS, blob)) {
    return { class: 'noUpstream', message: MESSAGES.noUpstream, step }
  }
  if (any(NON_FAST_FORWARD_PATTERNS, blob)) {
    return { class: 'nonFastForward', message: MESSAGES.nonFastForward, step }
  }
  const raw = (err.trim() || out.trim())
  return { class: 'unknown', message: raw || 'Unknown error', step }
}

module.exports = { classifyGitError }
