# wt-wrangler
Windows Terminal layouts builder/runner (Electron)

## Install & run
```
npm install
npm start        # launches the Electron GUI
npm test         # runs the command-builder unit tests
```

## Features
* Create and edit terminal layouts as JSON files
* Load a layout using Windows Terminal (spawns `wt.exe`)

## Interface
* Open a directory containing the layout JSON files
* Layouts can be _edited_ or _run_
* A layout may contain startup commands
* A layout may have post-run commands that are injected [after a time]
* The editor will give a rough GUI showing the layout panes, names[inputs], and commands/command-sequences
* Layout panes can be split horizontally or vertically (as is in Terminal itself via Alt+... commands)

## Data Format
**Need to add the command bits**
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
