'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const realFs = require('node:fs/promises')
const realFsSync = require('node:fs')
const { EventEmitter } = require('node:events')

const ipcHandlers = require('../src/ipcHandlers')

function makeIpcStub() {
  const handlers = new Map()
  return {
    handle(channel, fn) { handlers.set(channel, fn) },
    invoke(channel, ...args) {
      const fn = handlers.get(channel)
      if (!fn) throw new Error(`no handler registered for ${channel}`)
      return fn({ /* event */ }, ...args)
    },
    has(channel) { return handlers.has(channel) },
    channels() { return [...handlers.keys()] },
  }
}

function makeMemoryStore(initial = {}) {
  let data = { ...initial }
  return {
    read: async () => ({ ...data }),
    write: async (patch) => { data = { ...data, ...patch } },
    _peek: () => ({ ...data }),
  }
}

function makeFakeChild({ stdout = '', stderr = '', code = 0, errorBeforeClose = null } = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.unref = () => {}
  child.pid = 4242
  setImmediate(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout))
    if (stderr) child.stderr.emit('data', Buffer.from(stderr))
    if (errorBeforeClose) child.emit('error', errorBeforeClose)
    child.emit('close', code)
  })
  return child
}

function makeSpawnStub(plan) {
  // plan: array of {match: (cmd,args)=>bool, result: {stdout,stderr,code}}
  // OR a function (cmd, args, opts) => result
  const calls = []
  const fn = function spawn(cmd, args, opts) {
    calls.push({ cmd, args, opts })
    let result = { stdout: '', stderr: '', code: 0 }
    if (typeof plan === 'function') {
      result = plan(cmd, args, opts) || result
    } else if (Array.isArray(plan)) {
      const m = plan.find(p => p.match(cmd, args, opts))
      if (m) result = m.result
    }
    return makeFakeChild(result)
  }
  fn.calls = calls
  return fn
}

function decodedPwshScripts(cmd) {
  return [...cmd.matchAll(/powershell -NoExit -EncodedCommand ([A-Za-z0-9+/=]+)/g)]
    .map(match => Buffer.from(match[1], 'base64').toString('utf16le'))
}

async function tmpdir(prefix = 'wtw-ipc-') {
  return realFs.mkdtemp(path.join(os.tmpdir(), prefix))
}

test('register registers all expected channels', () => {
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    shell: { showItemInFolder() {}, openPath: async () => '' },
    fs: realFs,
    fsSync: realFsSync,
    spawn: makeSpawnStub([]),
    store: makeMemoryStore(),
    getMainWindow: () => null,
    env: {},
  })
  const expected = [
    'layouts:pickDir', 'layouts:list', 'layouts:move', 'layouts:read',
    'layouts:save', 'layouts:saveNew', 'layouts:delete',
    'wt:applyStyle', 'layouts:run', 'layouts:preview',
    'profiles:list',
    'config:get', 'config:set', 'appSettings:get', 'appSettings:set',
    'shell:reveal', 'shell:openPath',
    'git:isRepo', 'gh:update',
    'dialog:pickDir', 'dialog:pickImage',
  ]
  for (const ch of expected) {
    assert.ok(ipc.has(ch), `expected channel ${ch} to be registered`)
  }
})

test('layouts:read returns validated envelope on valid layout', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'a.json')
  const layout = { name: 'A', tabs: [{ name: 'T1', panes: [{ profile: 'P0' }] }] }
  await realFs.writeFile(file, JSON.stringify(layout), 'utf8')
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc,
    dialog: {}, shell: {},
    fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]),
    store: makeMemoryStore(),
    getMainWindow: () => null,
    env: {},
  })
  const res = await ipc.invoke('layouts:read', file)
  assert.equal(res.ok, true)
  assert.equal(res.data.name, 'A')
  assert.deepEqual(res.warnings, [])
})

test('layouts:read returns ok:false envelope on parse error', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'bad.json')
  await realFs.writeFile(file, '{not json', 'utf8')
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('layouts:read', file)
  assert.equal(res.ok, false)
  assert.match(res.error, /JSON parse/)
})

test('layouts:read returns ok:false envelope on read error', async () => {
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('layouts:read', path.join(os.tmpdir(), 'wtw-not-here-' + Date.now() + '.json'))
  assert.equal(res.ok, false)
  assert.match(res.error, /read failed/)
})

test('layouts:save writes pretty JSON to file', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'out.json')
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const layout = { name: 'X', tabs: [{ panes: [{ profile: 'P' }] }] }
  await ipc.invoke('layouts:save', file, layout)
  const written = await realFs.readFile(file, 'utf8')
  assert.equal(JSON.parse(written).name, 'X')
  assert.match(written, /\n  /, 'file should be pretty-printed')
})

test('layouts:saveNew sanitizes filename and writes', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const layout = { name: 'My Layout', tabs: [{ panes: [{ profile: 'P' }] }] }
  const target = await ipc.invoke('layouts:saveNew', dir, 'unsafe!@#name', layout)
  assert.match(path.basename(target), /^unsafe___name\.json$/)
  const exists = await realFs.stat(target).then(() => true).catch(() => false)
  assert.ok(exists)
})

test('layouts:saveNew auto-suffixes on collision instead of overwriting', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  // Pre-existing layout the user must not lose.
  await realFs.writeFile(path.join(dir, 'mine.json'), JSON.stringify({ original: true, tabs: [{ panes: [{}] }] }), 'utf8')
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const layout = { name: 'Mine', tabs: [{ panes: [{ profile: 'P' }] }] }
  const target = await ipc.invoke('layouts:saveNew', dir, 'mine', layout)
  // New file must NOT be mine.json (that would clobber).
  assert.notEqual(path.basename(target), 'mine.json')
  assert.match(path.basename(target), /^mine_1\.json$/)
  // Original survived.
  const orig = JSON.parse(await realFs.readFile(path.join(dir, 'mine.json'), 'utf8'))
  assert.equal(orig.original, true)
})

test('layouts:delete unlinks the file', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'gone.json')
  await realFs.writeFile(file, '{}', 'utf8')
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  await ipc.invoke('layouts:delete', file)
  const exists = await realFs.stat(file).then(() => true).catch(() => false)
  assert.equal(exists, false)
})

test('layouts:list tags valid file with no warnings, invalid file with error', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  await realFs.writeFile(path.join(dir, 'good.json'), JSON.stringify({
    name: 'Good', tabs: [{ name: 'T', panes: [{ profile: 'P' }] }],
  }), 'utf8')
  await realFs.writeFile(path.join(dir, 'bad.json'), JSON.stringify({
    name: 'Bad', tabs: [],
  }), 'utf8')
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const entries = await ipc.invoke('layouts:list', dir)
  const good = entries.find(e => e.file === 'good.json')
  const bad = entries.find(e => e.file === 'bad.json')
  assert.ok(good)
  assert.ok(!good.invalid)
  assert.ok(bad.invalid)
  assert.ok(bad.error)
})

test('layouts:move moves file across directories', async (t) => {
  const src = await tmpdir()
  const dst = await tmpdir()
  t.after(() => Promise.all([realFs.rm(src, { recursive: true, force: true }), realFs.rm(dst, { recursive: true, force: true })]))
  const file = path.join(src, 'm.json')
  await realFs.writeFile(file, '{"name":"M","tabs":[{"panes":[{}]}]}', 'utf8')
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const target = await ipc.invoke('layouts:move', file, dst)
  assert.equal(path.dirname(target), dst)
  const stillThere = await realFs.stat(file).then(() => true).catch(() => false)
  assert.equal(stillThere, false)
})

test('layouts:pickDir returns null when canceled', async () => {
  const ipc = makeIpcStub()
  const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  ipcHandlers.register({
    ipcMain: ipc, dialog, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('layouts:pickDir')
  assert.equal(res, null)
})

test('layouts:pickDir writes lastDir to store on selection', async () => {
  const ipc = makeIpcStub()
  const store = makeMemoryStore()
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\picked\\dir'] }) }
  ipcHandlers.register({
    ipcMain: ipc, dialog, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store,
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('layouts:pickDir')
  assert.equal(res, 'C:\\picked\\dir')
  assert.equal(store._peek().lastDir, 'C:\\picked\\dir')
})

test('layouts:preview returns wt command string', async () => {
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const layout = { name: 'L', tabs: [{ panes: [{ profile: 'PowerShell' }] }] }
  const cmd = await ipc.invoke('layouts:preview', layout)
  assert.match(cmd, /^wt(\.exe)? /)
})

test('layouts:run launches via cmd.exe command string with WT-safe separators', async () => {
  // Direct argv-form keeps literal inner quotes inside command tokens. Launch
  // through cmd.exe so WT receives clean tokens and real semicolon separators.
  const ipc = makeIpcStub()
  const spawn = makeSpawnStub((cmd, args, opts) => {
    assert.equal(cmd, 'cmd.exe')
    assert.ok(Array.isArray(args), 'spawn args should be an argv array')
    assert.deepEqual(args.slice(0, 2), ['/d', '/c'])
    assert.ok(!opts || !opts.shell, 'shell:true should stay off; cmd.exe is launched directly')
    assert.equal(opts.windowsVerbatimArguments, true)
    return { code: 0 }
  })
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn, store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const layout = {
    name: 'L',
    window: 'L',
    tabs: [
      { panes: [{ profile: 'Windows PowerShell', command: 'npx paperclipai run' }] },
      { panes: [{ profile: 'Command Prompt' }] },
    ],
  }
  const res = await ipc.invoke('layouts:run', layout)
  assert.ok(Array.isArray(res.argv))
  assert.match(res.preview, /^wt/)
  assert.match(res.runCommand, /^wt\.exe /)
  assert.equal(res.pid, 4242)
  assert.equal(spawn.calls.length, 1)
  const passed = spawn.calls[0].args[2]
  assert.ok(passed.includes(' ; '), `expected real WT separators: ${passed}`)
  assert.ok(!passed.includes('\\;'), `backslash-semicolon is passed to pane commands from cmd.exe: ${passed}`)
  assert.match(passed, /powershell -NoExit -EncodedCommand /)
  assert.deepEqual(decodedPwshScripts(passed), ['npx paperclipai run'])
  assert.doesNotMatch(passed, /"powershell -NoExit -Command "npx paperclipai run""/)
})

test('layouts:run wraps no-profile commands using Windows Terminal default profile kind', async () => {
  const temp = await tmpdir()
  const origLocal = process.env.LOCALAPPDATA
  const settingsDir = path.join(temp, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState')
  await realFs.mkdir(settingsDir, { recursive: true })
  await realFs.writeFile(path.join(settingsDir, 'settings.json'), JSON.stringify({
    defaultProfile: '{0caa0dad-35be-5f56-a8ff-afceeeaa6101}',
    profiles: {
      list: [
        {
          guid: '{0caa0dad-35be-5f56-a8ff-afceeeaa6101}',
          name: 'Command Prompt',
          commandline: 'cmd.exe',
        },
      ],
    },
  }), 'utf8')
  process.env.LOCALAPPDATA = temp
  try {
    const ipc = makeIpcStub()
    const spawn = makeSpawnStub(() => ({ code: 0 }))
    ipcHandlers.register({
      ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
      spawn, store: makeMemoryStore(),
      getMainWindow: () => null, env: {},
    })
    const layout = {
      name: 'L',
      window: 'L',
      tabs: [{ title: 'Default', panes: [{ dir: 'C:\\dev', command: 'ls' }] }],
    }
    const res = await ipc.invoke('layouts:run', layout)
    assert.match(res.runCommand, /new-tab --title Default -d C:\\dev cmd \/k ls/)
    assert.doesNotMatch(res.runCommand, /powershell -NoExit -Command "ls"/)
    assert.ok(!res.runCommand.includes(' -p '), `default profile pane should not emit -p: ${res.runCommand}`)
  } finally {
    if (origLocal === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = origLocal
  }
})

test('config:get returns store data and nulls non-directory lastDir', async () => {
  const ipc = makeIpcStub()
  const store = makeMemoryStore({ lastDir: path.join(os.tmpdir(), 'wtw-not-a-real-' + Date.now()) })
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store,
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('config:get')
  assert.equal(res.lastDir, null)
})

test('config:set writes patch and rejects non-object', async () => {
  const ipc = makeIpcStub()
  const store = makeMemoryStore()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store,
    getMainWindow: () => null, env: {},
  })
  assert.equal(await ipc.invoke('config:set', 'oops'), false)
  assert.equal(await ipc.invoke('config:set', { foo: 'bar' }), true)
  assert.equal(store._peek().foo, 'bar')
})

test('appSettings:get returns normalized settings + themes', async () => {
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('appSettings:get')
  assert.ok(res.settings)
  assert.ok(Array.isArray(res.themes))
  assert.ok(res.themes.length >= 1)
})

test('appSettings:set sanitizes and persists patch', async () => {
  const ipc = makeIpcStub()
  const store = makeMemoryStore()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store,
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('appSettings:set', { theme: 'graphite', __proto__: { evil: true } })
  assert.equal(res.ok, true)
  assert.equal(res.settings.theme, 'graphite')
})

test('shell:reveal calls showItemInFolder with truthy path', async () => {
  const ipc = makeIpcStub()
  let captured = null
  const shell = { showItemInFolder(p) { captured = p }, openPath: async () => '' }
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  assert.equal(await ipc.invoke('shell:reveal', 'C:\\foo'), true)
  assert.equal(captured, 'C:\\foo')
  assert.equal(await ipc.invoke('shell:reveal', null), false)
  assert.equal(await ipc.invoke('shell:reveal', ''), false)
})

test('shell:openPath delegates to shell.openPath', async () => {
  const ipc = makeIpcStub()
  const shell = { showItemInFolder() {}, openPath: async (p) => `opened:${p}` }
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  assert.equal(await ipc.invoke('shell:openPath', 'C:\\bar'), 'opened:C:\\bar')
  assert.equal(await ipc.invoke('shell:openPath', null), '')
})

test('git:isRepo true when .git directory present, false otherwise', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  await realFs.mkdir(path.join(dir, '.git'))
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  assert.equal(await ipc.invoke('git:isRepo', dir), true)
  assert.equal(await ipc.invoke('git:isRepo', path.join(dir, 'nope')), false)
  assert.equal(await ipc.invoke('git:isRepo', null), false)
})

test('gh:update returns ok:false when not a git repo', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('gh:update', dir)
  assert.equal(res.ok, false)
  assert.equal(res.step, 'check')
})

test('gh:update happy path: add+commit+push success', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  await realFs.mkdir(path.join(dir, '.git'))
  const ipc = makeIpcStub()
  const spawn = makeSpawnStub((_cmd, args) => ({ code: 0, stdout: '', stderr: '' }))
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn, store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('gh:update', dir)
  assert.equal(res.ok, true)
  assert.equal(res.committed, true)
  // 3 git invocations: add, commit, push
  assert.equal(spawn.calls.length, 3)
  assert.deepEqual(spawn.calls[0].args, ['add', '-A'])
  assert.equal(spawn.calls[1].args[0], 'commit')
  assert.deepEqual(spawn.calls[2].args, ['push'])
})

test('gh:update tolerates "nothing to commit" then pushes', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  await realFs.mkdir(path.join(dir, '.git'))
  const ipc = makeIpcStub()
  const spawn = makeSpawnStub((_cmd, args) => {
    if (args[0] === 'commit') return { code: 1, stdout: 'nothing to commit, working tree clean', stderr: '' }
    return { code: 0 }
  })
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn, store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('gh:update', dir)
  assert.equal(res.ok, true)
  assert.equal(res.committed, false)
})

test('gh:update classifies auth failure on push', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  await realFs.mkdir(path.join(dir, '.git'))
  const ipc = makeIpcStub()
  const spawn = makeSpawnStub((_cmd, args) => {
    if (args[0] === 'push') return { code: 1, stdout: '', stderr: 'remote: Permission to user/repo.git denied to user.\nfatal: unable to access' }
    return { code: 0 }
  })
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn, store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('gh:update', dir)
  assert.equal(res.ok, false)
  assert.equal(res.step, 'push')
  assert.equal(res.errorClass, 'auth')
})

test('gh:update sets GIT_TERMINAL_PROMPT=0 on every git child', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  await realFs.mkdir(path.join(dir, '.git'))
  const ipc = makeIpcStub()
  const spawn = makeSpawnStub((_cmd, _args) => ({ code: 0, stdout: '', stderr: '' }))
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn, store: makeMemoryStore(),
    getMainWindow: () => null, env: { PATH: '/x' },
  })
  const res = await ipc.invoke('gh:update', dir)
  assert.equal(res.ok, true)
  // All three git children (add, commit, push) must have terminal prompts disabled
  // so a missing credential helper fails fast (within seconds via the existing auth
  // classifier) instead of waiting for the 30s timeout.
  for (const c of spawn.calls) {
    assert.equal(c.opts.env && c.opts.env.GIT_TERMINAL_PROMPT, '0',
      `expected GIT_TERMINAL_PROMPT=0 on ${c.args[0]}`)
  }
})

test('gh:update reports timeout errorClass when git push hangs', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  await realFs.mkdir(path.join(dir, '.git'))
  const ipc = makeIpcStub()
  // Spawn that emits close immediately for add/commit, but never closes for push.
  // We need real timers here, so use a tiny per-call timeout — but ipcHandlers
  // calls runGitPure with the production default. Instead simulate a timed-out
  // result directly by emitting on the spawn child: we make push's child hang,
  // then synthetically end it after a short real timeout via a kill listener.
  const spawn = function (cmd, args) {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => { child.emit('close', null) }
    if (args[0] === 'push') {
      // Never close on its own — the timeout in runGit must call kill().
      // We'll trigger that by clobbering setTimeout below.
    } else {
      setImmediate(() => child.emit('close', 0))
    }
    return child
  }
  // Pin global setTimeout so the timer fires deterministically. ipcHandlers
  // reaches into the global; we monkey-patch for the duration of the test.
  const originalSetTimeout = global.setTimeout
  let firedTimer = null
  global.setTimeout = (fn, ms) => {
    // Fast-fire timers >100ms (the runGit timeout); leave short ones (the
    // 600ms wt-applyStyle delay etc.) alone — but gh:update doesn't use them.
    if (ms > 100) {
      firedTimer = setImmediate(fn)
      return firedTimer
    }
    return originalSetTimeout(fn, ms)
  }
  t.after(() => { global.setTimeout = originalSetTimeout })
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn, store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('gh:update', dir)
  assert.equal(res.ok, false)
  assert.equal(res.step, 'push')
  assert.equal(res.errorClass, 'timeout')
  assert.match(res.error, /timed out/i)
})

test('gh:update classifies non-fast-forward push rejection', async (t) => {
  const dir = await tmpdir()
  t.after(() => realFs.rm(dir, { recursive: true, force: true }))
  await realFs.mkdir(path.join(dir, '.git'))
  const ipc = makeIpcStub()
  const spawn = makeSpawnStub((_cmd, args) => {
    if (args[0] === 'push') return { code: 1, stdout: '', stderr: '! [rejected]   main -> main (non-fast-forward)' }
    return { code: 0 }
  })
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn, store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('gh:update', dir)
  assert.equal(res.ok, false)
  assert.equal(res.errorClass, 'nonFastForward')
})

test('dialog:pickDir returns picked path', async () => {
  const ipc = makeIpcStub()
  let receivedOpts = null
  const dialog = { showOpenDialog: async (_w, opts) => { receivedOpts = opts; return { canceled: false, filePaths: ['C:\\d'] } } }
  ipcHandlers.register({
    ipcMain: ipc, dialog, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => 'WIN', env: {},
  })
  const res = await ipc.invoke('dialog:pickDir', 'C:\\start')
  assert.equal(res, 'C:\\d')
  assert.equal(receivedOpts.defaultPath, 'C:\\start')
  assert.deepEqual(receivedOpts.properties, ['openDirectory'])
})

test('dialog:pickDir returns null on cancel', async () => {
  const ipc = makeIpcStub()
  const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  ipcHandlers.register({
    ipcMain: ipc, dialog, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  assert.equal(await ipc.invoke('dialog:pickDir'), null)
})

test('dialog:pickImage uses image filters and returns picked file', async () => {
  const ipc = makeIpcStub()
  let receivedOpts = null
  const dialog = { showOpenDialog: async (_w, opts) => { receivedOpts = opts; return { canceled: false, filePaths: ['C:\\img.png'] } } }
  ipcHandlers.register({
    ipcMain: ipc, dialog, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('dialog:pickImage')
  assert.equal(res, 'C:\\img.png')
  assert.deepEqual(receivedOpts.properties, ['openFile'])
  assert.ok(Array.isArray(receivedOpts.filters))
  assert.ok(receivedOpts.filters.some(f => f.extensions.includes('png')))
})

test('wt:applyStyle returns no-op result when layout has no windowStyle', async () => {
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('wt:applyStyle', { tabs: [] })
  assert.equal(res.applied.profile, false)
  assert.equal(res.applied.window, false)
  assert.equal(res.fragmentPath, null)
})

test('wt:applyStyle refreshes settings after profile-only fragment write', async (t) => {
  const temp = await tmpdir()
  const origLocal = process.env.LOCALAPPDATA
  t.after(async () => {
    if (origLocal === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = origLocal
    await realFs.rm(temp, { recursive: true, force: true })
  })

  const settingsDir = path.join(temp, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState')
  await realFs.mkdir(settingsDir, { recursive: true })
  const settingsPath = path.join(settingsDir, 'settings.json')
  const settingsRaw = JSON.stringify({
    profiles: {
      list: [
        { name: 'pwsh', guid: '{base-pwsh}', commandline: 'powershell.exe' },
      ],
    },
  }, null, 2) + '\n'
  await realFs.writeFile(settingsPath, settingsRaw, 'utf8')
  process.env.LOCALAPPDATA = temp

  const writes = []
  const fsSpy = Object.create(realFs)
  fsSpy.writeFile = async (file, content, enc) => {
    writes.push({ file, content })
    return realFs.writeFile(file, content, enc)
  }

  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: fsSpy, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: { LOCALAPPDATA: temp },
  })

  const layout = {
    name: 'L',
    window: 'L',
    windowStyle: { background: '#112233' },
    tabs: [{ title: 'T', panes: [{ profile: 'pwsh' }] }],
  }
  const res = await ipc.invoke('wt:applyStyle', layout)
  assert.equal(res.applied.profile, true)
  assert.equal(res.applied.window, false)
  assert.equal(res.settingsPath, settingsPath)
  assert.equal(res.backupPath, null)
  assert.ok(writes.some(w => path.basename(w.file).startsWith('settings.json.wtw-tmp-') && w.content === settingsRaw))
  assert.equal(await realFs.readFile(settingsPath, 'utf8'), settingsRaw)
})

test('wt:applyStyle catches errors and returns {error}', async () => {
  const ipc = makeIpcStub()
  // Force fragmentDir failure: env without LOCALAPPDATA + a layout that triggers profile fragment write.
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: { /* no LOCALAPPDATA */ },
  })
  const layout = {
    name: 'L', windowStyle: { opacity: 0.5 },
    tabs: [{ name: 'T', panes: [{ profile: 'PowerShell' }] }],
  }
  const res = await ipc.invoke('wt:applyStyle', layout)
  assert.ok(res.error, 'expected error returned')
  assert.match(res.error, /LOCALAPPDATA/)
})

test('profiles:list returns discovery envelope shape', async () => {
  const ipc = makeIpcStub()
  ipcHandlers.register({
    ipcMain: ipc, dialog: {}, shell: {}, fs: realFs, fsSync: realFsSync,
    spawn: makeSpawnStub([]), store: makeMemoryStore(),
    getMainWindow: () => null, env: {},
  })
  const res = await ipc.invoke('profiles:list')
  assert.ok(typeof res === 'object' && res !== null)
  assert.ok(Array.isArray(res.profiles))
})
