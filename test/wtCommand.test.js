'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildWtCommand, buildWtArgv, composeShellCommand } = require('../src/wtCommand')

const readmeLayout = {
  name: 'dev-cockpit',
  window: 'dev',
  tabs: [
    {
      title: 'App',
      profile: 'pwsh',
      dir: 'C:\\dev\\my-app',
      panes: [
        { profile: 'pwsh', dir: 'C:\\dev\\my-app', command: 'npm run dev' },
        { split: 'right', size: 0.35, profile: 'cmd', dir: 'C:\\dev\\my-app', command: 'npm test' },
      ],
    },
    {
      title: 'Server',
      profile: 'pwsh',
      dir: 'C:\\dev\\my-app\\server',
      panes: [
        { profile: 'pwsh', command: 'npm run server' },
        { split: 'down', size: 0.4, profile: 'pwsh', command: 'npm run logs' },
      ],
    },
  ],
}

test('buildWtCommand produces wt invocation with window, tabs and splits', () => {
  const cmd = buildWtCommand(readmeLayout)
  assert.ok(cmd.startsWith('wt -w dev '), cmd)
  assert.match(cmd, /new-tab --title App -p pwsh -d C:\\dev\\my-app npm run dev/)
  assert.match(cmd, /split-pane -V --size 0\.35 -p cmd -d C:\\dev\\my-app npm test/)
  assert.match(cmd, /new-tab --title Server -p pwsh -d C:\\dev\\my-app\\server npm run server/)
  assert.match(cmd, /split-pane -H --size 0\.4 -p pwsh npm run logs/)
  const tabSeps = cmd.split(' ; ').length - 1
  assert.equal(tabSeps, 3, `expected 3 " ; " separators, got ${tabSeps}: ${cmd}`)
})

test('buildWtArgv returns argv array with ; tokens between tabs and splits', () => {
  const argv = buildWtArgv(readmeLayout)
  assert.deepEqual(argv.slice(0, 2), ['-w', 'dev'])
  const semicolons = argv.filter(tok => tok === ';').length
  assert.equal(semicolons, 3)
  assert.ok(argv.includes('new-tab'))
  assert.ok(argv.includes('split-pane'))
  assert.ok(argv.includes('-V'))
  assert.ok(argv.includes('-H'))
})

test('composeShellCommand wraps pwsh post-run with Start-Sleep', () => {
  const out = composeShellCommand({
    profile: 'pwsh',
    command: 'npm run dev',
    postCommand: 'git status',
    postDelay: 5,
  })
  assert.equal(out, 'npm run dev; Start-Sleep -Seconds 5; git status')
})

test('composeShellCommand wraps cmd post-run with timeout', () => {
  const out = composeShellCommand({
    profile: 'cmd',
    command: 'build.bat',
    postCommand: 'dir',
    postDelay: 2,
  })
  assert.equal(out, 'build.bat & timeout /t 2 /nobreak >nul & dir')
})

test('composeShellCommand wraps bash post-run with sleep', () => {
  const out = composeShellCommand({
    profile: 'Ubuntu',
    command: 'npm start',
    postCommand: 'echo done',
  })
  assert.equal(out, 'npm start; sleep 3; echo done')
})

test('buildWtCommand throws on empty layout', () => {
  assert.throws(() => buildWtCommand({}), /at least one tab/)
})
