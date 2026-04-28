# TODO — top 10

Generated 2026-04-27 from Reqall (project #2045 fingerskier/wt-wrangler), GitHub issues (none open), and local docs (README.md + main.js review). Ranked by impact × leverage; pending items only — shipped specs excluded.

## 1. ~~Revert WT settings.json window-style patches after launch~~ — DONE 2026-04-27
**Status: DONE.** Implemented via `src/wtStyleSession.js` (pure in-memory tracker; first pre-patch content per path is preserved as the snapshot) wired into `main.js`: `applyStyleForLaunch` records the original `settings.json` raw content before the first window-style patch of the session, and `app.on('will-quit')` restores all pending snapshots before the app exits. 9 new node:test cases (`test/wtStyleSession.test.js`); full suite 93/93 green. Failed restores stay pending so a retry-on-next-quit can pick them up. Disk backup (`.wtw-backup-<stamp>`) is retained as a paranoid safety net.

## 2. ~~Garbage-collect WT fragment files + name-collision guard~~ — DONE 2026-04-27
**Status: DONE.** New pure module `src/wtFragments.js` (FNV1a-8 `styleHash(layout)` over normalized `windowStyle` + window name; `fragmentFileName(layout)` → `<safeWin>-<hash>.json`; `staleFragmentFiles(entries, keepSet, now, maxAgeMs)`). `wtStyleApply.transientName` and `buildFragment` extended to accept a discriminator threaded into transient profile names so `wtw-<win>-<hash>-<base>` differs across layouts that share window+base but differ in style. main.js `writeFragmentFile` now uses the hash-suffixed filename, and `app.whenReady` fires a one-shot `sweepStaleFragments` that deletes `*.json` in `Fragments\wt-wrangler\` older than 30 days (fire-and-forget; never blocks startup). 13 new tests in `test/wtFragments.test.js` + 2 discriminator tests in `test/wtStyleApply.test.js`. Full suite 108/108 green.

## 3. Auto-update + Authenticode signing on Squirrel.Windows
App is Windows-only (depends on `wt.exe`) and ships via Squirrel.Windows through Electron Forge — but the installer is unsigned (every download triggers SmartScreen) and the running app has no update path. `forge.config.js` has no `signWithParams` / `certificateFile` block, and `main.js` never invokes the Squirrel updater. Wire `update.exe --update <feedURL>` (or `electron-updater` against a static feed) plus add Authenticode signing config — both are flip-the-switch in forge once a cert and feed URL exist. Reqall todo #2007 lumped this under "electron-builder packaging" but the real gap is signing + updates, not cross-platform.

## 4. Replacement for post-run command injection
Reqall arch #2020 documents that post-run commands were removed because `wt.exe` has no `send-input` CLI. Original use-case (run `claude`, then inject `/rename foo`+ENTER 2s later) is unmet. Options to evaluate: (a) bundle a small named-pipe expect helper per profile, (b) use a focus-aware SendInput wrapper invoked from a detached supervisor process, (c) lean on profile `commandline` to wrap the child REPL with a startup-script flag. Pick one and reinstate the JSON fields under a feature gate.

## 5. GH Update: surface auth / merge-conflict / detached-HEAD
Reqall spec #2053 explicitly punts on errors — current behavior toasts `GH update failed: <step> <stderr>` and stops. In practice users hit (a) `git push` 403 / no-creds, (b) non-fast-forward, (c) detached HEAD. Detect these three classes in `main.js::ghUpdate` and emit actionable toasts ("auth required — open terminal", "remote ahead — pull first", "detached HEAD — checkout a branch") instead of raw stderr.

## 6. App-settings persistence (theme, default profile, default saveDir)
`src/config.js` was designed as an open-map store (Reqall spec #2010) but only `lastDir` is written today. Add a settings panel writing through `config:set` for: default profile (used when creating a new layout), default save sub-folder, theme variant (workshop-plate baseline + at least one alt), confirm-on-delete toggle. All low-risk; unblocks the workshop-plate alt skins teased in spec #2019.

## 7. Layout JSON schema validation on read
`ipcMain.handle('layouts:read', ...)` does a bare `JSON.parse` and propagates whatever throws. Malformed layouts surface as a stack trace in the toast; missing required fields (no `tabs`, empty `panes`) silently render an editor with phantom state. Add a tiny validator (no need for ajv — hand-rolled for the 6-key schema) called from `layouts:read` and `layouts:list`. Return `{ ok, data, error, warnings }` and let the renderer show a per-file badge in the sidebar tree.

## 8. Profile-discovery failure indicator
`src/wtProfiles.js` silently falls back to `['Windows PowerShell', 'Command Prompt', 'PowerShell', 'Ubuntu']` when no settings.json parses (Reqall spec #2008). User has no signal that their *real* profiles aren't loaded — the datalist just mysteriously omits them. Have `profiles:list` return `{ source, profiles, fallback: bool, error?: string }` and render a small ⚠️ near the profile input when `fallback === true`.

## 9. Split-into-non-last-pane in the editor
`renderer/paneTree.js` + Reqall spec #2018 restrict the `│→` / `─↓` split icons to the last leaf because the wt CLI splits the focused (last-added) pane and there's no `mf` move-focus. Power users want to insert a split mid-tree. Implementation: when the user splits a non-last pane in the GUI, internally re-order the `panes[]` array so the target pane becomes last, adjust subsequent `split`/`size` so the spatial result is identical, then perform the split. Pure renderer change.

## 10. Main-process IPC test coverage
`test/` has solid unit coverage for the pure modules (`wtCommand`, `wtStyleApply`, `wtProfiles`, `config`, `layouts`, `history`, `paneTree`, `windowStyle`) but `main.js` IPC paths — `layouts:run`, `gh:update`, `wt:applyStyle`, `dialog:pick*`, `shell:*` — have zero. Add a tiny harness that mocks `electron` (`ipcMain`/`dialog`/`shell`) and `child_process.spawn`, then exercises every handler with happy + error paths. Catches regressions like #2128 (windowStyle clobbering shell wrapper kind) before they ship.
