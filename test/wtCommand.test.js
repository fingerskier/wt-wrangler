'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildWtCommand, buildWtCmdCommand, buildWtArgv, composeShellCommand, composeShellArgv, resolveWindowTarget } = require('../src/wtCommand')

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

function decodedPwshScripts(cmd) {
  return [...cmd.matchAll(/powershell -NoExit -EncodedCommand ([A-Za-z0-9+/=]+)/g)]
    .map(match => Buffer.from(match[1], 'base64').toString('utf16le'))
}

test('buildWtCommand produces wt invocation with window, tabs and splits', () => {
  const cmd = buildWtCommand(readmeLayout)
  assert.ok(cmd.startsWith('wt -w dev new-tab '), cmd)
  // shellCmd is emitted as the wrapped string from wrapThroughShell — bare,
  // not double-wrapped. wt's commandline rebuilder mangles single argv tokens
  // that have both spaces AND embedded quotes, which is why buildWtArgv now
  // splits the shell wrapper into separate argv tokens (see composeShellArgv).
  // The string preview here is for display only.
  assert.match(cmd, /-w dev new-tab --title App -p pwsh -d C:\\dev\\my-app powershell -NoExit -Command "npm run dev"/)
  assert.match(cmd, /; split-pane -V --size 0\.35 -p cmd -d C:\\dev\\my-app cmd \/k npm test/)
  assert.match(cmd, /; -w dev new-tab --title Server -p pwsh -d C:\\dev\\my-app\\server powershell -NoExit -Command "npm run server"/)
  assert.match(cmd, /; split-pane -H --size 0\.4 -p pwsh powershell -NoExit -Command "npm run logs"/)
  const tabSeps = cmd.split(' ; ').length - 1
  assert.equal(tabSeps, 3, `expected 3 " ; " separators, got ${tabSeps}: ${cmd}`)
})

test('buildWtCommand targets each new-tab but not split-pane segments', () => {
  const cmd = buildWtCommand(readmeLayout)
  const wCount = (cmd.match(/-w dev /g) || []).length
  assert.equal(wCount, 2, `expected -w dev once per tab, got ${wCount}: ${cmd}`)
  assert.doesNotMatch(cmd, /; -w dev split-pane/, `split-pane should keep the current tab context: ${cmd}`)
})

test('buildWtArgv targets each new-tab but not split-pane segments', () => {
  const argv = buildWtArgv(readmeLayout)
  assert.deepEqual(argv.slice(0, 3), ['-w', 'dev', 'new-tab'])
  const semicolons = argv.filter(tok => tok === ';').length
  assert.equal(semicolons, 3)
  const wFlags = argv.filter(tok => tok === '-w').length
  assert.equal(wFlags, 2, `expected one -w per tab, got ${wFlags}`)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== 'split-pane') continue
    const segmentStart = argv.lastIndexOf(';', i) + 1
    const segment = argv.slice(segmentStart, i + 1)
    assert.ok(!segment.includes('-w'), `split-pane should not be directly window-targeted: ${JSON.stringify(argv)}`)
  }
  assert.ok(argv.includes('new-tab'))
  assert.ok(argv.includes('split-pane'))
  assert.ok(argv.includes('-V'))
  assert.ok(argv.includes('-H'))
})

test('buildWtArgv preserves dev layout shape: split first tab only, then open second tab', () => {
  const argv = buildWtArgv({
    name: 'dev',
    window: 'dev',
    tabs: [
      {
        title: 'Tab 1',
        panes: [
          { profile: 'Command Prompt', dir: '\\dev', command: 'claude "start terse"' },
          { split: 'down', profile: 'Command Prompt', dir: '\\dev' },
        ],
      },
      {
        title: 'Tab 2',
        panes: [{ dir: 'C:\\dev', command: 'ls' }],
      },
    ],
  })
  assert.deepEqual(argv, [
    '-w', 'dev',
    'new-tab', '--title', 'Tab 1', '-p', 'Command Prompt', '-d', '\\dev', 'cmd', '/k', 'claude "start terse"',
    ';',
    'split-pane', '-H', '-p', 'Command Prompt', '-d', '\\dev',
    ';',
    '-w', 'dev', 'new-tab', '--title', 'Tab 2', '-d', 'C:\\dev', 'powershell', '-NoExit', '-Command', 'ls',
  ])
})

test('buildWtCmdCommand uses real WT separators for dev layout launch', () => {
  const cmd = buildWtCmdCommand({
    name: 'dev',
    window: 'dev',
    tabs: [
      {
        title: 'Tab 1',
        panes: [
          { profile: 'Command Prompt', dir: '\\dev', command: 'claude "start terse"' },
          { split: 'down', profile: 'Command Prompt', dir: '\\dev' },
        ],
      },
      {
        title: 'Tab 2',
        panes: [{ dir: 'C:\\dev', command: 'ls' }],
      },
    ],
  })
  assert.equal(
    cmd,
    'wt.exe -w dev new-tab --title "Tab 1" -p "Command Prompt" -d \\dev cmd /k claude "start terse" ; split-pane -H -p "Command Prompt" -d \\dev ; -w dev new-tab --title "Tab 2" -d C:\\dev powershell -NoExit -EncodedCommand bABzAA==',
  )
})

test('buildWtCmdCommand encodes pwsh scripts so embedded quotes survive cmd.exe launch', () => {
  const cmd = buildWtCmdCommand({
    name: 'dev',
    window: 'dev',
    tabs: [{
      title: 'Tab 1',
      panes: [{ profile: 'Windows PowerShell', dir: '\\dev', command: 'claude "start terse"' }],
    }],
  })
  assert.match(cmd, /-p "Windows PowerShell"/)
  assert.match(cmd, /powershell -NoExit -EncodedCommand /)
  assert.doesNotMatch(cmd, /-Command "claude/)
  assert.deepEqual(decodedPwshScripts(cmd), ['claude "start terse"'])
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

test('composeShellCommand prefers pane.shellKind over profile name', () => {
  const out = composeShellCommand({
    profile: 'wtw-Claude_Plugins-Command_Prompt',
    shellKind: 'cmd',
    command: 'claude "start terse"',
  })
  assert.equal(out, 'cmd /k claude "start terse"')
})

test('composeShellCommand chains postCommand after postDelay (pwsh)', () => {
  const out = composeShellCommand({
    profile: 'pwsh',
    command: 'echo hi',
    postCommand: 'echo bye',
    postDelay: 2,
  })
  assert.equal(out, 'powershell -NoExit -Command "echo hi; Start-Sleep -Seconds 2; echo bye"')
})

test('composeShellCommand chains postCommand after postDelay (cmd, quoted for & chain)', () => {
  const out = composeShellCommand({
    profile: 'cmd',
    command: 'echo hi',
    postCommand: 'echo bye',
    postDelay: 5,
  })
  assert.equal(out, 'cmd /k "echo hi & timeout /t 5 /nobreak >nul & echo bye"')
})

test('composeShellCommand chains postCommand after postDelay (bash, before exec-bash keepalive)', () => {
  const out = composeShellCommand({
    profile: 'Ubuntu',
    command: 'npm start',
    postCommand: 'echo done',
    postDelay: 1,
  })
  assert.equal(out, 'bash -i -c "npm start; sleep 1; echo done; exec bash"')
})

test('composeShellCommand defaults postDelay to 3 when omitted', () => {
  const out = composeShellCommand({ profile: 'pwsh', command: 'a', postCommand: 'b' })
  assert.equal(out, 'powershell -NoExit -Command "a; Start-Sleep -Seconds 3; b"')
})

test('composeShellCommand handles postCommand with no main command (pwsh)', () => {
  const out = composeShellCommand({ profile: 'pwsh', postCommand: 'echo only', postDelay: 2 })
  assert.equal(out, 'powershell -NoExit -Command "Start-Sleep -Seconds 2; echo only"')
})

test('composeShellCommand handles postCommand with no main command (cmd)', () => {
  const out = composeShellCommand({ profile: 'cmd', postCommand: 'echo only', postDelay: 2 })
  assert.equal(out, 'cmd /k "timeout /t 2 /nobreak >nul & echo only"')
})

test('composeShellCommand handles postCommand with no main command (bash)', () => {
  const out = composeShellCommand({ profile: 'bash', postCommand: 'echo only', postDelay: 2 })
  assert.equal(out, 'bash -i -c "sleep 2; echo only; exec bash"')
})

test('composeShellCommand returns empty when both command and postCommand absent', () => {
  assert.equal(composeShellCommand({ profile: 'pwsh' }), '')
  assert.equal(composeShellCommand({ profile: 'pwsh', postCommand: '' }), '')
})

test('composeShellCommand ignores non-numeric postDelay (uses default 3)', () => {
  const out = composeShellCommand({ profile: 'pwsh', command: 'a', postCommand: 'b', postDelay: 'two' })
  assert.equal(out, 'powershell -NoExit -Command "a; Start-Sleep -Seconds 3; b"')
})

test('composeShellCommand clamps negative postDelay to 0', () => {
  const out = composeShellCommand({ profile: 'pwsh', command: 'a', postCommand: 'b', postDelay: -5 })
  assert.equal(out, 'powershell -NoExit -Command "a; Start-Sleep -Seconds 0; b"')
})

test('buildWtCommand emits postCommand-bearing pane through wrapped shell', () => {
  const layout = {
    window: 'w',
    tabs: [{
      title: 'T',
      panes: [{ profile: 'pwsh', command: 'main', postCommand: 'after', postDelay: 1 }],
    }],
  }
  const cmd = buildWtCommand(layout)
  assert.match(cmd, /powershell -NoExit -Command "main; Start-Sleep -Seconds 1; after"/)
})

// --- Regression: (default) profile and embedded-quote preservation -----

test('composeShellCommand defaults no-profile commands to a shell wrapper', () => {
  // Bare builtins/aliases like `ls` are not executables; WT drops later chained
  // tabs when they are emitted directly.
  const out = composeShellCommand({ command: 'claude "start terse"' })
  assert.equal(out, 'powershell -NoExit -Command "claude \\"start terse\\""')
})

test('composeShellCommand uses defaultShellKind when pane has no profile/shellKind', () => {
  const out = composeShellCommand({ command: 'claude "start terse"' }, 'cmd')
  assert.equal(out, 'cmd /k claude "start terse"')
})

test('composeShellCommand: pane.profile still wins over defaultShellKind', () => {
  const out = composeShellCommand({ profile: 'pwsh', command: 'echo hi' }, 'cmd')
  assert.equal(out, 'powershell -NoExit -Command "echo hi"')
})

test('buildWtCommand emits readable preview for claude "start terse"', () => {
  const layout = {
    window: 'X',
    tabs: [{ title: 'T', panes: [{ profile: 'cmd', command: 'claude "start terse"' }] }],
  }
  const cmd = buildWtCommand(layout)
  assert.match(cmd, /cmd \/k claude "start terse"/)
})

test('buildWtCommand respects defaultShellKind for empty-profile panes', () => {
  const layout = {
    window: 'X',
    tabs: [{ title: 'T', panes: [{ command: 'claude "start terse"' }] }],
  }
  const withCmd = buildWtCommand(layout, { defaultShellKind: 'cmd' })
  assert.match(withCmd, /cmd \/k claude "start terse"/)
  assert.ok(!/-p /.test(withCmd), 'no -p emitted when pane.profile is empty')
})

test('buildWtCommand wraps empty-profile commands when no defaultShellKind is configured', () => {
  const layout = {
    window: 'X',
    tabs: [{ title: 'T', panes: [{ command: 'claude "start terse"' }] }],
  }
  const cmd = buildWtCommand(layout)
  assert.match(cmd, /powershell -NoExit -Command "claude \\"start terse\\""/)
  assert.ok(!/-p /.test(cmd), 'no -p emitted when pane.profile is empty')
})

test('buildWtArgv splits shell wrapper into separate argv tokens (avoids wt re-wrap mangling)', () => {
  // wt joins trailing positionals with spaces and naively wraps elements
  // containing whitespace in "..." — without escaping inner quotes. So a
  // single argv element `cmd /k claude "start terse"` produces a child
  // commandline like `"cmd /k claude "start terse""` — CreateProcess fails
  // ("file not found"). Splitting into ['cmd','/k','claude','start terse']-
  // shaped tokens lets wt wrap only `start terse` (which has no inner quotes)
  // — clean re-join, child runs.
  const argv = buildWtArgv({
    window: 'X',
    tabs: [{ title: 'T', panes: [{ profile: 'cmd', command: 'claude "start terse"' }] }],
  })
  // Tokens for the cmd wrapper come through as separate argv entries.
  const tail = argv.slice(-3)
  assert.deepEqual(tail, ['cmd', '/k', 'claude "start terse"'])
})

test('buildWtArgv splits pwsh wrapper into separate argv tokens (regression: paperclip case)', () => {
  // Regression: composeShellCommand emits `powershell -NoExit -Command "<script>"`
  // as one string. Pushing that as a single argv element triggered wt's
  // re-wrap-with-embedded-quotes bug. Splitting into 4 tokens fixes it.
  const argv = buildWtArgv({
    window: 'Paperclip',
    tabs: [{ title: 'Paperclip', panes: [{
      profile: 'Windows PowerShell',
      command: 'npx paperclipai run',
    }] }],
  })
  const tail = argv.slice(-4)
  assert.deepEqual(tail, ['powershell', '-NoExit', '-Command', 'npx paperclipai run'])
})

test('composeShellArgv returns argv tokens for cmd wrapper', () => {
  assert.deepEqual(
    composeShellArgv({ profile: 'cmd', command: 'dir' }),
    ['cmd', '/k', 'dir'],
  )
})

test('composeShellArgv returns argv tokens for pwsh wrapper', () => {
  assert.deepEqual(
    composeShellArgv({ profile: 'pwsh', command: 'Get-Process' }),
    ['powershell', '-NoExit', '-Command', 'Get-Process'],
  )
})

test('composeShellArgv returns argv tokens for bash wrapper (script + exec bash chained)', () => {
  assert.deepEqual(
    composeShellArgv({ profile: 'Ubuntu', command: 'npm start' }),
    ['bash', '-i', '-c', 'npm start; exec bash'],
  )
})

test('composeShellArgv returns [] when no command/postCommand', () => {
  assert.deepEqual(composeShellArgv({ profile: 'pwsh' }), [])
})

test('composeShellArgv defaults no-profile commands to pwsh argv wrapper', () => {
  assert.deepEqual(
    composeShellArgv({ command: 'claude "start terse"' }),
    ['powershell', '-NoExit', '-Command', 'claude "start terse"'],
  )
})

test('composeShellArgv chains postCommand into script with shell-correct sleep', () => {
  assert.deepEqual(
    composeShellArgv({ profile: 'pwsh', command: 'a', postCommand: 'b', postDelay: 2 }),
    ['powershell', '-NoExit', '-Command', 'a; Start-Sleep -Seconds 2; b'],
  )
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
