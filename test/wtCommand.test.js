'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildWtCommand, buildWtArgv, composeShellCommand, resolveWindowTarget } = require('../src/wtCommand')

const readmeLayout = {
  name: 'dev-cockpit',
  window: 'dev',
  tabs: [
    {
      title: 'App',
      panes: [
        { profile: 'pwsh', dir: 'C:\\dev\\my-app', command: 'npm run dev' },
        { split: 'right', size: 0.35, profile: 'cmd', dir: 'C:\\dev\\my-app', command: 'npm test' },
      ],
    },
    {
      title: 'Server',
      panes: [
        { profile: 'pwsh', dir: 'C:\\dev\\my-app\\server', command: 'npm run server' },
        { split: 'down', size: 0.4, profile: 'pwsh', command: 'npm run logs' },
      ],
    },
  ],
}

test('buildWtCommand produces wt invocation with window, tabs and splits', () => {
  const cmd = buildWtCommand(readmeLayout)
  assert.ok(cmd.startsWith('wt -w dev new-tab '), cmd)
  assert.match(cmd, /-w dev new-tab --title App -p pwsh -d C:\\dev\\my-app powershell -NoExit -Command "npm run dev"/)
  assert.match(cmd, /-w dev split-pane -V --size 0\.35 -p cmd -d C:\\dev\\my-app cmd \/k npm test/)
  assert.match(cmd, /-w dev new-tab --title Server -p pwsh -d C:\\dev\\my-app\\server powershell -NoExit -Command "npm run server"/)
  assert.match(cmd, /-w dev split-pane -H --size 0\.4 -p pwsh powershell -NoExit -Command "npm run logs"/)
  const tabSeps = cmd.split(' ; ').length - 1
  assert.equal(tabSeps, 3, `expected 3 " ; " separators, got ${tabSeps}: ${cmd}`)
})

test('buildWtCommand repeats -w <name> on every subcommand segment', () => {
  const cmd = buildWtCommand(readmeLayout)
  const wCount = (cmd.match(/-w dev /g) || []).length
  assert.equal(wCount, 4, `expected -w dev on all 4 segments, got ${wCount}: ${cmd}`)
})

test('buildWtArgv repeats -w token before every subcommand', () => {
  const argv = buildWtArgv(readmeLayout)
  assert.deepEqual(argv.slice(0, 2), ['-w', 'dev'])
  const semicolons = argv.filter(tok => tok === ';').length
  assert.equal(semicolons, 3)
  const wFlags = argv.filter(tok => tok === '-w').length
  assert.equal(wFlags, 4, `expected -w before each of 4 segments, got ${wFlags}`)
  assert.ok(argv.includes('new-tab'))
  assert.ok(argv.includes('split-pane'))
  assert.ok(argv.includes('-V'))
  assert.ok(argv.includes('-H'))
})

test('composeShellCommand wraps bare cmd builtin so dir-style commands launch', () => {
  const out = composeShellCommand({ profile: 'cmd', command: 'dir' })
  assert.equal(out, 'cmd /k dir')
})

test('composeShellCommand wraps bare pwsh command through powershell -NoExit', () => {
  const out = composeShellCommand({ profile: 'pwsh', command: 'Get-Process' })
  assert.equal(out, 'powershell -NoExit -Command "Get-Process"')
})

test('composeShellCommand wraps bash command keeping session interactive', () => {
  const out = composeShellCommand({ profile: 'Ubuntu', command: 'npm start' })
  assert.equal(out, 'bash -i -c "npm start; exec bash"')
})

test('composeShellCommand returns empty when no command', () => {
  assert.equal(composeShellCommand({ profile: 'cmd' }), '')
})

test('buildWtCommand throws on empty layout', () => {
  assert.throws(() => buildWtCommand({}), /at least one tab/)
})

test('buildWtCommand generates unique window name when none provided', () => {
  const cmd = buildWtCommand({
    name: 'orphan',
    tabs: [{ title: 'One', profile: 'pwsh', panes: [{ profile: 'pwsh', command: 'echo hi' }] }],
  })
  assert.match(cmd, /^wt -w wtw-\d+-[a-z0-9]+ new-tab /, cmd)
})

test('buildWtArgv generates unique window name when none provided', () => {
  const argv = buildWtArgv({
    tabs: [{ title: 'One', profile: 'pwsh', panes: [{ profile: 'pwsh', command: 'echo hi' }] }],
  })
  assert.equal(argv[0], '-w')
  assert.match(argv[1], /^wtw-\d+-[a-z0-9]+$/)
})

test('whitespace-only window name falls back to generated name', () => {
  const cmd = buildWtCommand({
    window: '   ',
    tabs: [{ title: 'x', panes: [{ profile: 'pwsh', command: 'a' }] }],
  })
  assert.match(cmd, /^wt -w wtw-\d+-[a-z0-9]+ new-tab /, cmd)
})

test('resolveWindowTarget returns trimmed layout.window when provided', () => {
  assert.equal(resolveWindowTarget({ window: '  myWin  ' }), 'myWin')
})

test('resolveWindowTarget generates fresh name per call when empty', () => {
  const a = resolveWindowTarget({})
  const b = resolveWindowTarget({ window: '' })
  assert.match(a, /^wtw-\d+-[a-z0-9]+$/)
  assert.match(b, /^wtw-\d+-[a-z0-9]+$/)
  assert.notEqual(a, b)
})
