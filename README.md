# wt-wrangler
Windows Terminal layouts builder/runner (Electron)

## Install & run
```
npm install
npm start        # launches the Electron GUI (via electron-forge)
npm test         # runs the command-builder unit tests
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

## Features
* Create and edit terminal layouts as JSON files
* Load a layout using Windows Terminal (spawns `wt.exe`)

## Interface
* Open a directory containing the layout JSON files
* Layouts can be _edited_ or _run_
* A layout may contain startup commands
* The editor will give a rough GUI showing the layout panes, names[inputs], and commands/command-sequences
* Layout panes can be split horizontally or vertically (as is in Terminal itself via Alt+... commands)

## How the wt command is built

Building a chained `wt.exe` invocation has two non-obvious rules. Both are encoded in `src/wtCommand.js` and both matter for multi-tab layouts.

1. **Repeat `-w <name>` on every subcommand.** `-w new` is a keyword that only scopes to the first subcommand; once a chained `;` appears, any later `new-tab` or `split-pane` that carries a commandline will spawn a separate window instead of attaching. Use a concrete name — either the layout's `window` field or an auto-generated `wtw-<timestamp>-<suffix>` — and emit `-w <name>` before every segment. The first subcommand creates the window by that name, the rest attach to it.

2. **Wrap every pane command through the profile's shell.** `wt`'s commandline positional requires an *executable*. A bare shell builtin like `dir` or `ls` has no `.exe` to launch, so `wt` silently drops that chained subcommand — which looks like "only the first tab opens" whenever any later tab uses a builtin. wt-wrangler wraps every pane command through the profile's shell so builtins, aliases, and shell functions all launch, and the tab stays open for output:

    | Profile                       | Wrap                                         |
    | ----------------------------- | -------------------------------------------- |
    | `cmd` / `Command Prompt`      | `cmd /k <cmd>`                               |
    | `bash` / `wsl` / `ubuntu`     | `bash -i -c "<cmd>; exec bash"`              |
    | `pwsh` / default / everything else | `powershell -NoExit -Command "<cmd>"`   |

A third rule lives in `main.js`: the process is spawned as `spawn(cmdString, { shell: true, ... })`. `shell: true` is required so that cmd.exe tokenizes the literal `;` as its own argv element before it reaches `wt.exe`.

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
