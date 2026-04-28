# wt-wrangler
Windows Terminal layouts builder/runner (Electron)

## Install & run
```
npm install
npm start        # launches the Electron GUI (via electron-forge)
npm test         # runs the unit-test suite (pure modules + IPC harness + CI contract)
```

## Packaging the installer
```
npm run build-icons   # regenerates asset/logo.ico + asset/logo-setup.gif from asset/logo.png
npm run package       # produces out/Wrangler-win32-x64/
npm run make          # produces out/make/squirrel.windows/x64/WranglerSetup.exe
```
App branding (name, window icon, taskbar icon, installer icon, Squirrel install banner) is
derived from `asset/logo.png`. The derived `asset/logo.ico` and `asset/logo-setup.gif` are
gitignored — the `prepackage` / `premake` npm hooks rebuild them from the PNG before Forge runs.

## Auto-update + code signing (optional)
Wrangler is Squirrel.Windows-only. Both auto-update and Authenticode signing are opt-in via env vars — the build produces an unsigned, no-update installer when these are unset.

Auto-update (runtime, in `main.js`):
- `WRANGLER_UPDATE_URL` — Squirrel feed URL (e.g. `https://example.com/updates/wrangler/`). When set and the app is packaged on win32, `electron`'s `autoUpdater.setFeedURL(...)` is called and `checkForUpdates()` fires once after a 5s delay.

Code signing (build-time, in `forge.config.js`):
- `WRANGLER_SIGN_PARAMS` — raw signtool argv (most flexible; supports HSMs, `/sm /n "CN=..."` flows).
- `WRANGLER_CERT_FILE` (+ `WRANGLER_CERT_PASSWORD`) — `.pfx` file path with optional password.

When both are set, `WRANGLER_SIGN_PARAMS` wins. With neither, `npm run make` produces an unsigned installer (SmartScreen warning on launch).

## Features
* Create and edit terminal layouts as JSON files
* Load a layout using Windows Terminal (spawns `wt.exe`)
* Optional per-pane `postCommand` runs in the **same shell** after the main command exits (with a configurable `postDelay`, default 3s). This is useful for setup-then-launch chains like `npm install` → `npm run dev`. It does **NOT** inject keystrokes into a running TUI/REPL — for that, you'd need a focus-aware SendInput supervisor or a named-pipe expect helper, neither of which Wrangler ships today.

## Interface
* Open a directory containing the layout JSON files
* Layouts can be _edited_ or _run_
* A layout may contain startup commands
* The editor will give a rough GUI showing the layout panes, names[inputs], and commands/command-sequences
* Layout panes can be split horizontally or vertically (as is in Terminal itself via Alt+... commands)

## How the wt command is built

Building a chained `wt.exe` invocation has two non-obvious rules. Both are encoded in `src/wtCommand.js` and both matter for multi-tab layouts.

1. **Target every `new-tab`, but not `split-pane`.** `-w new` is a keyword that only scopes to the first subcommand; once a chained `;` appears, a later `new-tab` that carries a commandline can spawn separately instead of attaching. Use a concrete name — either the layout's `window` field or an auto-generated `wtw-<timestamp>-<suffix>` — and emit `-w <name>` before each `new-tab`. Do not emit `-w` before `split-pane`; splits must stay in the current tab context.

2. **Wrap every pane command through the profile's shell.** `wt`'s commandline positional requires an *executable*. A bare shell builtin like `dir` or `ls` has no `.exe` to launch, so `wt` silently drops that chained subcommand — which looks like "only the first tab opens" whenever any later tab uses a builtin. wt-wrangler wraps every pane command through the profile's shell so builtins, aliases, and shell functions all launch, and the tab stays open for output:

    | Profile                       | Wrap                                         |
    | ----------------------------- | -------------------------------------------- |
    | `cmd` / `Command Prompt`      | `cmd /k <cmd>`                               |
    | `bash` / `wsl` / `ubuntu`     | `bash -i -c "<cmd>; exec bash"`              |
    | `pwsh` / everything else           | `powershell -NoExit -Command "<cmd>"`   |

    Panes with no `profile` keep WT's `(default)` profile (`-p` is omitted), but Wrangler still reads WT's `defaultProfile` from `settings.json` to choose the matching wrapper. If the WT default profile is Command Prompt, a no-profile `ls` pane is launched as `cmd /k ls`; if Wrangler cannot read the default profile, it falls back to PowerShell.

A third rule lives in `src/ipcHandlers.js` (the IPC layer extracted from `main.js`): the process is spawned as `cmd.exe /d /c <wt.exe ...>` with verbatim arguments. That lets cmd.exe tokenize pane commands like `claude "start terse"` cleanly while preserving literal `;` WT separators between `new-tab` and `split-pane` subcommands.

For actual `Run` launches, PowerShell pane scripts are sent with `-EncodedCommand` so nested quotes survive the `cmd.exe` launch hop. The command preview remains readable and still displays the unencoded script.

## Window styles

Layout-level `windowStyle` settings are split across two Windows Terminal mechanisms:

- Profile appearance keys (`background`, `unfocusedBackground`, `opacity`, `backgroundImage`, `backgroundImageOpacity`) are applied through hidden transient WT profile fragments, then pane profile names are remapped for launch.
- Window/root keys (`useMica`, `showTabsInTitlebar`, `useAcrylicInTabRow`) are applied to WT `settings.json` for the launch session and restored when Wrangler exits.

`useMica` does not need to be set for `background` to work. When a layout only changes profile appearance keys, Wrangler rewrites the original `settings.json` bytes after writing the fragment so WT reloads its profile list before launch. Leaving `Use Mica` unset means "do not change the user's current WT setting."

## Data Format
```json
{
  "name": "dev-cockpit",
  "window": "dev",
  "tabs": [
    {
      "title": "App",
      "profile": "pwsh",
      "dir": "C:\\dev\\my-app",
      "panes": [
        {
          "profile": "pwsh",
          "dir": "C:\\dev\\my-app",
          "command": "npm run dev"
        },
        {
          "split": "right",
          "size": 0.35,
          "profile": "cmd",
          "dir": "C:\\dev\\my-app",
          "command": "npm test"
        }
      ]
    },
    {
      "title": "Server",
      "profile": "pwsh",
      "dir": "C:\\dev\\my-app\\server",
      "panes": [
        {
          "profile": "pwsh",
          "command": "npm run server"
        },
        {
          "split": "down",
          "size": 0.4,
          "profile": "pwsh",
          "command": "npm run logs"
        }
      ]
    }
  ]
}
```
