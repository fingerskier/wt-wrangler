# TODO — top 10

Generated 2026-04-27 from Reqall (project #2045 fingerskier/wt-wrangler), GitHub issues (none open), and local docs (README.md + main.js review). Ranked by impact × leverage; pending items only — shipped specs excluded.

**All 10 items DONE as of 2026-04-28.** Backlog clear.

---

## Round 2 — top 3 (regenerated 2026-04-28 from code audit)

After shipping the original top-10, an audit of `src/layoutSchema.js`, `src/wtCommand.js`, and `README.md` surfaced three new high-leverage gaps:

### R2.1 ~~Tighten layoutSchema validation~~ — DONE 2026-04-28
**Status: DONE.** `validateLayout` now warns on three previously-silent misconfigurations:
- `panes[0]` (tab root) carrying a `split` field — wt builds the tab via `new-tab`, so the split flag is silently dropped at runtime.
- `panes[1+]` *without* a `split` field — schema previously tolerated this; wt falls back to vertical (down) which is rarely the user's intent.
- `pane.postDelay` < 0 — would previously be passed straight to `Start-Sleep -Seconds` / `sleep`, breaking the post-command chain.
Zero `postDelay` is still accepted silently (legitimate "no delay" case). 6 new tests in `test/layoutSchema.test.js`; suite 249 → 255 green.

### R2.2 ~~GitHub Actions workflow running `npm test` on push + PR~~ — DONE 2026-04-28
**Status: DONE.** New workflow at `.github/workflows/test.yml`: `runs-on: windows-latest` (matches the wt.exe runtime constraint), triggers on push + pull_request to `main`, uses `actions/checkout@v4` and `actions/setup-node@v4` (Node 20 + npm cache), installs via `npm ci`, runs `npm test`. New `test/ciWorkflow.test.js` (9 contract tests) parses the YAML and asserts every required line is present so accidental edits to the workflow are caught locally before push. Suite 255 → 264 green.

### R2.3 ~~README staleness audit~~ — DONE 2026-04-28
**Status: DONE.** Two stale claims fixed:
- "`npm test` runs the command-builder unit tests" → "runs the unit-test suite (pure modules + IPC harness + CI contract)".
- "A third rule lives in `main.js`: the process is spawned as `spawn(cmdString, …)`" → "lives in `src/ipcHandlers.js` (the IPC layer extracted from `main.js`)".
New `test/readme.test.js` (7 cases) pins README contract: forbids both stale phrases, and requires forward-references to `ipcHandlers`, `postCommand`/`postDelay`, and the auto-update + signing env vars. Future docs drift gets caught by `npm test`. Suite 264 → 271 green.

---

**Round 2 complete.** Backlog clear again.

---

## Round 3 — top 1 (regenerated 2026-04-28)

### R3.2 ~~config.write concurrent-call race~~ — DONE 2026-04-28
**Status: DONE.** `makeStore.write` previously did `read → spread → write` with no mutex; concurrent calls (e.g. `appSettings:set` + `layouts:pickDir`'s `lastDir` write at startup) read the same baseline, each spread its own patch, each wrote — last writer won, the other's patch was silently lost. Fixed by adding a per-store promise-chain mutex: `let writeQueue = Promise.resolve(); function write(patch) { const next = writeQueue.then(async () => {/*read+spread+write*/}); writeQueue = next.catch(() => {}); return next; }`. The `.catch(() => {})` guards against one rejection poisoning the queue. Three new tests in `test/config.test.js` (two concurrent multi-key writes both land; 20-way concurrent writes preserve every key; same-key concurrent writes obey scheduled order). Suite 277 → 280 green.

### R3.1 ~~layouts:saveNew silently overwrites existing files~~ — DONE 2026-04-28
**Status: DONE.** New pure helper `availableLayoutFile(dirPath, baseName)` in `src/layouts.js`: reads dir once, lower-cases all names (handles case-insensitive Windows FS — asking for `foo` when `FOO.json` exists still suffixes), and walks `<base>.json`, `<base>_1.json`, `<base>_2.json`, … returning the first free slot. Bounded at 1000 attempts. `ipcHandlers::layouts:saveNew` now calls the helper instead of building the path inline. 5 new tests in `test/layouts.test.js` (basic, _1, _2, gap-filling, case-insensitivity) + 1 collision test in `test/ipcHandlers.test.js` asserting the original file's content survives untouched. Suite 271 → 277 green.

---

## 1. ~~Revert WT settings.json window-style patches after launch~~ — DONE 2026-04-27
**Status: DONE.** Implemented via `src/wtStyleSession.js` (pure in-memory tracker; first pre-patch content per path is preserved as the snapshot) wired into `main.js`: `applyStyleForLaunch` records the original `settings.json` raw content before the first window-style patch of the session, and `app.on('will-quit')` restores all pending snapshots before the app exits. 9 new node:test cases (`test/wtStyleSession.test.js`); full suite 93/93 green. Failed restores stay pending so a retry-on-next-quit can pick them up. Disk backup (`.wtw-backup-<stamp>`) is retained as a paranoid safety net.

## 2. ~~Garbage-collect WT fragment files + name-collision guard~~ — DONE 2026-04-27
**Status: DONE.** New pure module `src/wtFragments.js` (FNV1a-8 `styleHash(layout)` over normalized `windowStyle` + window name; `fragmentFileName(layout)` → `<safeWin>-<hash>.json`; `staleFragmentFiles(entries, keepSet, now, maxAgeMs)`). `wtStyleApply.transientName` and `buildFragment` extended to accept a discriminator threaded into transient profile names so `wtw-<win>-<hash>-<base>` differs across layouts that share window+base but differ in style. main.js `writeFragmentFile` now uses the hash-suffixed filename, and `app.whenReady` fires a one-shot `sweepStaleFragments` that deletes `*.json` in `Fragments\wt-wrangler\` older than 30 days (fire-and-forget; never blocks startup). 13 new tests in `test/wtFragments.test.js` + 2 discriminator tests in `test/wtStyleApply.test.js`. Full suite 108/108 green.

## 3. ~~Auto-update + Authenticode signing on Squirrel.Windows~~ — DONE 2026-04-27
**Status: DONE.** New pure module `src/updater.js` exposing `getFeedURL(env)`, `buildSignConfig(env)`, `maybeCheckForUpdates({feedURL, autoUpdater, isPackaged, platform, schedule, delayMs})`. Auto-update wired in `main.js::whenReady` — fires only when packaged on win32 with `WRANGLER_UPDATE_URL` set; uses electron's built-in `autoUpdater` (Squirrel.Windows). Signing wired in `forge.config.js` — `buildSignConfig(process.env)` returns `{signWithParams}` (preferred) or `{certificateFile, certificatePassword?}` based on `WRANGLER_SIGN_PARAMS` / `WRANGLER_CERT_FILE` / `WRANGLER_CERT_PASSWORD`. Both default to off — flip-the-switch via env once a cert and feed URL exist. README documents the env vars. 14 new tests (`test/updater.test.js`); full suite 122/122 green.

## 4. ~~Replacement for post-run command injection~~ — DONE 2026-04-27 (partial; documented limit)
**Status: DONE — bounded scope.** Re-introduced `panes[].postCommand` + `panes[].postDelay` (default 3s) under documented constraint: post runs in the **same shell after main exits**, not inside a running TUI/REPL child. composeShellCommand wraps per-shell: pwsh `<cmd>; Start-Sleep -Seconds N; <post>`, cmd `"<cmd> & timeout /t N /nobreak >nul & <post>"` (quoted so `&` survives argv tokenization), bash `<cmd>; sleep N; <post>; exec bash`. Post-only (no main) wraps `<sleep>; <post>`, avoiding the bare-program wt.exe error from the original removal (#2020). UI: pane card adds Post-command + Post-delay inputs. README documents the limitation. 11 new tests in `test/wtCommand.test.js`; full suite 133/133 green. **Not addressed**: actual TUI/REPL keystroke injection (claude/vim) — still requires a focus-aware SendInput supervisor or named-pipe expect helper. Tracked as future work.

## 5. ~~GH Update: surface auth / merge-conflict / detached-HEAD~~ — DONE 2026-04-27
**Status: DONE.** New pure module `src/ghUpdate.js` exposing `classifyGitError(stderr, stdout, step)` → `{class, message, step}`. Detects three actionable classes by regex over combined stderr+stdout: `auth` (403, "Authentication failed", "could not read Username/Password", SSH "Permission denied (publickey)", "remote: Permission to … denied", "terminal prompts disabled"), `nonFastForward` ("non-fast-forward", "[rejected]", "Updates were rejected", "fetch first", "failed to push some refs"), `detachedHead` ("HEAD detached", "not currently on a branch", "HEAD does not refer to a branch", "detached HEAD"). Priority: auth > detachedHead > nonFastForward (auth eclipses everything; detached eclipses ref-rejection downstream). Unknown class falls back to trimmed raw stderr/stdout. main.js `gh:update` handler returns `{ok:false, step, error: <friendly>, errorClass, raw}`; renderer toast shows the friendly `error` and logs `raw` to console for debugging. 18 new tests in `test/ghUpdate.test.js`; full suite 151/151 green.

## 6. ~~App-settings persistence (theme, default profile, default saveDir)~~ — DONE 2026-04-27
**Status: DONE.** New pure module `src/appSettings.js` exposes `THEMES` (`workshop-plate` baseline + `graphite` alt), `DEFAULT_SETTINGS`, `KNOWN_KEYS`, `normalizeSettings(raw)`, `sanitizePatch(patch)`, `isSafeSubdir(v)`. Sub-folder validation rejects `..`, `.`, absolute paths (`/foo`, `\\foo`, `C:\\foo`, UNC). New IPC `appSettings:get` returns `{settings, themes}`; `appSettings:set` runs `sanitizePatch` then writes through `store.write` (existing open-map config). preload exposes `appSettingsGet`/`appSettingsSet`. `renderer/index.html` adds a ⚙ button + modal with theme select, default profile input, default save sub-folder input, confirm-on-delete checkbox. `renderer/app.js`: loads settings on startup, applies theme via `documentElement.dataset.theme`, uses `defaultProfile` in `emptyLayout()`, gates `confirmOnDelete` in `deleteCurrent()`, auto-selects `defaultSaveSubdir` in `setLayoutsDir()` when subdir exists in folder listing. `styles.css` adds `html[data-theme="graphite"]` accent overrides + `.settings-row` form styling. 28 new tests in `test/appSettings.test.js`; full suite 179/179 green.

## 7. ~~Layout JSON schema validation on read~~ — DONE 2026-04-27
**Status: DONE.** New pure module `src/layoutSchema.js` exposes `validateLayout(data)` → `{ok, data, error, warnings}`. Hard errors (ok=false): non-object, missing/non-array/empty `tabs`, tab not object, tab.panes not array or empty, pane not object — error string includes `tabs[<i>]`/`tabs[<i>].panes[<j>]` index for navigation. Warnings (ok=true, flagged): missing/empty/non-string `name`, non-string `window`, pane `split` not in right/left/down/up, pane `size` non-numeric or outside (0,1), non-string `profile`/`dir`/`command`/`postCommand`, non-numeric `postDelay`. Unknown extra keys are tolerated silently. `main.js::layouts:read` returns the validated envelope; `main.js::layouts:list` re-reads each file, validates, and tags entries with `invalid: true` + `error` (hard) or `warnings: string[]` (soft) so the sidebar can show ⛔/⚠️ badges. Renderer call sites updated to read `res.data` and surface `res.error`; `paneTree.js` rendering of file-item adds `.error`/`.warn` class + tooltip + badge suffix. New `.layout-list li.warn` rule in styles.css. 26 new tests in `test/layoutSchema.test.js`; full suite 205/205 green.

## 8. ~~Profile-discovery failure indicator~~ — DONE 2026-04-28
**Status: DONE.** `src/wtProfiles.js::discoverProfiles` now returns `{source, profiles, fallback: bool, error?: string}`. New helper `_withCandidates(candidates)` (exported for tests; pure logic separated from filesystem-path discovery) iterates candidates, returns the first parseable one with at least one profile. When all candidates fail, returns `{source: null, profiles: DEFAULT_FALLBACK, fallback: true, error}` where `error` is the last per-candidate failure (`<path>: <msg>`), or generic `"no settings.json found in any known location"` / `"…found but unreadable"` when no per-path message exists. Renderer state gains `profileFallback`/`profileError`; new `refreshProfileWarning()` injects a ⚠️ span next to each `select[data-field="profile"]` with the error in `title` when fallback. Hooked into `renderProfileOptions` so it reapplies on editor re-render. New `.profile-warn` styling. 4 new tests in `test/wtProfiles.test.js`; full suite 209/209 green.

## 9. ~~Split-into-non-last-pane in the editor~~ — DONE 2026-04-28
**Status: DONE — best-effort.** New pure helper `splitFromPane(panes, sourceIdx, dir, template)` in `renderer/paneTree.js`. Last-pane case appends as before. Middle-pane case clones the array, splices the source out and pushes it to the end, then appends the new pane with `split=dir`. Root-pane case (sourceIdx=0): pane[1] is promoted to root (its `split` field is dropped), and the moved-from-root pane gets a default `split='right'` since it now has a predecessor in the chain. Renderer (`renderer/app.js::renderPane`): split buttons no longer disabled on non-last panes; `doSplit` routes through `splitFromPane` and emits a "spatial layout may have shifted" toast on the non-last path. **Trade-off documented:** wt's focus chain is path-dependent, so true spatial preservation is not generally achievable without a `move-focus` CLI primitive (which wt lacks). The reorder produces the desired *new* pane attached to the user's selection, but pre-existing spatial relationships on the moved pane's siblings can shift; users can drag-reorder via existing DnD (spec #2048) to fix any visible drift. 9 new tests in `test/paneTree.test.js`; full suite 218/218 green.

## 10. ~~Main-process IPC test coverage~~ — DONE 2026-04-28
**Status: DONE.** Extracted all 21 IPC handler registrations + their helpers (`applyStyleForLaunch`, `findExistingSettingsPath`, `fragmentDir`, `writeFragmentFile`, `sweepStaleFragments`, `writeFileAtomic`, `ensureSettingsBackup`, `isGitRepo`, `runGit`, `gitFail`) from `main.js` into new pure module `src/ipcHandlers.js` exporting `register(deps)` where `deps = {ipcMain, dialog, shell, fs, fsSync, spawn, store, getMainWindow, env, styleSession}`. main.js shrank from 431 → 96 lines and now just constructs deps and calls `register` after `app.whenReady`. New harness `test/ipcHandlers.test.js` (31 tests) stubs `ipcMain` with a `Map`-backed `handle/invoke` shim, mocks `dialog`/`shell`/`spawn`/`store`/`getMainWindow`, and uses real `fs` against `os.tmpdir()` for filesystem-backed handlers. Covers every channel — `layouts:pickDir/list/move/read/save/saveNew/delete/run/preview`, `wt:applyStyle`, `profiles:list`, `config:get/set`, `appSettings:get/set`, `shell:reveal/openPath`, `git:isRepo`, `gh:update` (including auth + non-fast-forward classifier branches via injected stderr), `dialog:pickDir/pickImage`. Full suite 218 → 249 green.
