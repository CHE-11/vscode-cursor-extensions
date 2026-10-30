# Task Manager

Folder-aware tasks for VS Code and Cursor. Based on [actboy168/vscode-tasks](https://github.com/actboy168/vscode-tasks), with support for repos that contain several projects, each with its own `.vscode/tasks.json`.

## How it works

VS Code only reads the `.vscode/tasks.json` of the folder you opened. Task Manager searches the whole workspace for every `**/.vscode/tasks.json` and treats each folder that has one as a **project**:

```
vscode-cursor-extensions/        <- opened folder
├── endpointer/.vscode/tasks.json        -> project "endpointer"
├── uri-quick-linker/.vscode/tasks.json  -> project "uri-quick-linker"
└── task-manager/.vscode/tasks.json      -> project "task-manager"
```

Inside a project's tasks, `${workspaceFolder}` resolves to that project's folder, and tasks run there by default.

### Status bar scope

| Active file | Tasks in the status bar |
| --- | --- |
| Inside `endpointer/` | Only `endpointer` tasks |
| Inside `uri-quick-linker/` | Only `uri-quick-linker` tasks |
| At the repo root, or no file open | Tasks from every project |

Focusing a terminal, output panel or webview keeps the last file's scope. Set `"taskManager.scopeMode": "all"` to always show every task.

The first Task Manager item (`$(folder-opened) endpointer` or `$(folder-library) All`) shows the current scope. Click it to open the Task Manager panel.

When tasks from more than one project are visible, each group starts with a dimmed `│ endpointer` style divider (names longer than 14 characters are shortened). Click a divider to open that project's tasks.json.

### Task Manager panel

The **Task Manager** icon in the Activity Bar opens a tree of every project and its tasks:

- **Run**, **Stop** and **Restart** buttons on each task
- **Open tasks.json** on each project; right-click a task to jump to its definition
- A spinning icon and a badge count for running tasks
- A title bar toggle that switches between all projects and only the active file's project

### Startup

The extension activates on `*`, the earliest activation event. The tasks.json files found in the previous session are loaded right away, then a full workspace scan replaces them. Status bar items use a low priority so they sit after the built-in left items (branch, sync, problems).

## Supported tasks

- `shell` and `process` tasks, including `args`, `options.cwd`, `options.env`, `options.shell`, `problemMatcher`, `isBackground`, `presentation` and `group`
- `npm` tasks, run with the package manager matching the nearest lockfile (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock` or `package-lock.json`)
- `dependsOn` with `dependsOrder` set to `parallel` (the default) or `sequence`, resolved inside the same project
- Platform overrides with `windows`, `osx` and `linux`
- Variables: `${workspaceFolder}`, `${workspaceFolderBasename}`, `${file}`, `${fileBasename}`, `${fileDirname}`, `${relativeFile}`, `${lineNumber}`, `${selectedText}`, `${env:NAME}`, `${userHome}` and `${pathSeparator}`. Anything else, such as `${input:...}` or `${config:...}`, is handed to VS Code to resolve.

Nested project tasks also show up in the built-in **Tasks: Run Task** picker under the project name.

## Split terminals

To run several tasks side by side in one split terminal, add `"split": true` to the `options` of a task that uses `dependsOn`:

```json
{ "label": "Start Backend",  "type": "shell", "command": "npm run start", "isBackground": true, "options": { "cwd": "${workspaceFolder}/backend",  "statusbar": { "hide": true } } },
{ "label": "Start Frontend", "type": "shell", "command": "npm run dev",   "isBackground": true, "options": { "cwd": "${workspaceFolder}/frontend", "statusbar": { "hide": true } } },
{
  "label": "Run",
  "dependsOn": ["Start Backend", "Start Frontend"],
  "options": {
    "split": true,
    "statusbar": { "color": "#f1f412" }
  }
}
```

Clicking **Run** opens one terminal split into a Backend pane and a Frontend pane. You don't need to add `presentation.group` to each child.

- `"split": true` uses a group named after the parent task. `"split": "servers"` sets the name, so separate parent tasks can share one split terminal.
- Split children default to `"panel": "dedicated"`, so running the parent again reuses the same panes.
- A child that sets its own `presentation.group` keeps it. The standard VS Code way, where each child sets `"presentation": { "group": "groupB" }`, works too.
- Stop or Restart on the parent stops or restarts every pane.
- Parallel children start one after another, each as soon as the previous terminal opens. VS Code needs that order to split them into one terminal. They then run at the same time.

## Status bar options

Put these under `options.statusbar` in any `tasks.json`:

```json
{
  "label": "Watch",
  "type": "shell",
  "command": "pnpm run watch",
  "options": {
    "statusbar": {
      "label": "$(eye) Watch",
      "color": "#06b724",
      "detail": "Compile on save",
      "hide": false,
      "filePattern": "\\.ts$",
      "running": {
        "label": "$(sync~spin) Watching",
        "backgroundColor": "statusBarItem.warningBackground"
      }
    }
  }
}
```

| Option | Description |
| --- | --- |
| `label` | Button text. Supports `$(icon)` syntax. |
| `icon` | `{ "id": "beaker" }` codicon placed in front of the label. |
| `color` | Hex color or theme color id. |
| `backgroundColor` | `statusBarItem.errorBackground` or `statusBarItem.warningBackground`. |
| `detail` | Tooltip text. |
| `hide` | Hide the button. The task still appears in the panel. |
| `filePattern` | Regex the active file path must match for the button to show. |
| `running` | Overrides `label`, `icon`, `color` and `backgroundColor` while the task runs. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `taskManager.scopeMode` | `activeFile` | `activeFile` scopes the status bar to the active file's project; `all` always shows everything. |
| `taskManager.exclude` | `**/{node_modules,out,dist,builds,.git}/**` | Folders skipped when searching for tasks.json files. |
| `taskManager.statusbar.limit` | `null` | Maximum number of buttons; the rest move into the `...` picker. |
| `taskManager.statusbar.select.label` | `...` | Label of the overflow picker button. |
| `taskManager.statusbar.select.color` | `""` | Color of the overflow picker button. |
| `taskManager.statusbar.default.color` | `""` | Default button color. |
| `taskManager.statusbar.default.hide` | `false` | Hide every task unless it sets `options.statusbar.hide: false`. |
| `taskManager.statusbar.showProjectName` | `true` | Include the project name in tooltips. |
| `taskManager.statusbar.groupLabels` | `true` | When several projects are shown, put a `│ folder` divider in front of each group. |
| `taskManager.statusbar.showScope` | `true` | Show the scope item in front of the task buttons. |

## Keybindings

`taskManager.runTask` accepts a number to run the Nth visible status bar task:

```json
{ "key": "ctrl+alt+1", "command": "taskManager.runTask", "args": 1 }
```

## Development

```powershell
cd .\task-manager; pnpm install
pnpm run watch      # or: pnpm run compile
pnpm run package    # writes builds/task-manager-<version>.vsix
```

Press F5 and pick **Run Extension (repo root)** to test against the whole repo.
