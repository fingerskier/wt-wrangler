'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { classifyGitError } = require('../src/ghUpdate')

test('classifyGitError: HTTPS 403 is auth', () => {
  const stderr = "remote: Permission to user/repo.git denied to user.\nfatal: unable to access 'https://github.com/user/repo.git/': The requested URL returned error: 403"
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'auth')
  assert.match(r.message, /[Aa]uth/)
})

test('classifyGitError: "Authentication failed" is auth', () => {
  const stderr = 'remote: Invalid username or password.\nfatal: Authentication failed for https://github.com/user/repo.git/'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'auth')
})

test('classifyGitError: "could not read Username" is auth', () => {
  const stderr = "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'auth')
})

test('classifyGitError: SSH "Permission denied (publickey)" is auth', () => {
  const stderr = 'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'auth')
})

test('classifyGitError: "non-fast-forward" is nonFastForward', () => {
  const stderr = ' ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs to ...'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'nonFastForward')
  assert.match(r.message, /pull|rebase|ahead/i)
})

test('classifyGitError: "fetch first" is nonFastForward', () => {
  const stderr = "hint: Updates were rejected because the remote contains work that you do\nhint: not have locally. This is usually caused by another repository pushing\nhint: to the same ref. You may want to first integrate the remote changes\nhint: (e.g., 'git pull ...') before pushing again.\nhint: See the 'Note about fast-forwards' in 'git push --help' for details."
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'nonFastForward')
})

test('classifyGitError: "rejected" alone is nonFastForward', () => {
  const stderr = 'To github.com:user/repo.git\n ! [rejected]        main -> main (fetch first)'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'nonFastForward')
})

test('classifyGitError: "not currently on a branch" is detachedHead', () => {
  const stderr = 'fatal: You are not currently on a branch.\nTo push the history leading to the current (detached HEAD) state now,\nuse\n    git push origin HEAD:<name-of-remote-branch>'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'detachedHead')
  assert.match(r.message, /[Dd]etached|branch/)
})

test('classifyGitError: "HEAD detached" is detachedHead', () => {
  const stderr = 'HEAD detached at abc1234'
  const r = classifyGitError(stderr, '', 'commit')
  assert.equal(r.class, 'detachedHead')
})

test('classifyGitError: "HEAD does not refer to a branch" is detachedHead', () => {
  const stderr = 'fatal: HEAD does not refer to a branch.'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'detachedHead')
})

test('classifyGitError: detached HEAD takes priority over nonFastForward markers', () => {
  // contrived: both rejected and detached present — detached is the actionable root cause
  const stderr = 'fatal: You are not currently on a branch.\n ! [rejected] (non-fast-forward)'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'detachedHead')
})

test('classifyGitError: auth takes priority over nonFastForward', () => {
  const stderr = 'fatal: Authentication failed for https://github.com/user/repo.git/\n ! [rejected] (non-fast-forward)'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'auth')
})

test('classifyGitError: unknown returns trimmed raw stderr', () => {
  const stderr = '   some weird unrelated git failure   \n'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'unknown')
  assert.equal(r.message, 'some weird unrelated git failure')
})

test('classifyGitError: empty stderr falls back to stdout', () => {
  const r = classifyGitError('', 'something on stdout', 'push')
  assert.equal(r.class, 'unknown')
  assert.equal(r.message, 'something on stdout')
})

test('classifyGitError: empty inputs yield generic Unknown error message', () => {
  const r = classifyGitError('', '', 'push')
  assert.equal(r.class, 'unknown')
  assert.match(r.message, /[Uu]nknown/)
})

test('classifyGitError: case-insensitive matching', () => {
  const stderr = 'AUTHENTICATION FAILED'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'auth')
})

test('classifyGitError: step is preserved on result', () => {
  const r = classifyGitError('non-fast-forward rejected', '', 'push')
  assert.equal(r.step, 'push')
})

test('classifyGitError: tolerates undefined inputs', () => {
  const r = classifyGitError(undefined, undefined, undefined)
  assert.equal(r.class, 'unknown')
  assert.ok(r.message)
})

// --- R3.9: noUpstream classification ---------------------------------------

test('classifyGitError: "has no upstream branch" is noUpstream', () => {
  const stderr = "fatal: The current branch feature/x has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin feature/x"
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'noUpstream')
  assert.match(r.message, /upstream|--set-upstream|push -u/i)
})

test('classifyGitError: "--set-upstream" hint alone is noUpstream', () => {
  const stderr = 'use git push --set-upstream origin main'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'noUpstream')
})

test('classifyGitError: auth still wins over noUpstream when both present', () => {
  // Hypothetical mixed output where push hits auth before discovering upstream config.
  const stderr = "fatal: Authentication failed\nhint: use git push --set-upstream origin main"
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'auth')
})

test('classifyGitError: noUpstream beats nonFastForward when both keywords appear', () => {
  // Edge case: noUpstream is a more specific actionable signal than the generic
  // "rejected" wording, so it wins. (Real-world this combo doesn't happen but
  // we want the priority order documented in tests.)
  const stderr = 'has no upstream branch\nUpdates were rejected'
  const r = classifyGitError(stderr, '', 'push')
  assert.equal(r.class, 'noUpstream')
})
