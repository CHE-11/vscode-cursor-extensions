# vscode-cursor-extensions

Personal VS Code and Cursor extensions. Each folder is its own extension.

## [task-manager](./task-manager)

Folder-aware tasks for workspaces that contain several projects. It finds every `.vscode/tasks.json` in the workspace, shows those tasks in the status bar and a sidebar, and scopes the status bar to the project of the active file.

## [uri-quick-linker](./uri-quick-linker)

Copy a file URI with its line number, paste it as a commented link, and click the link to jump back to that location. Right-click in the editor for **Copy URI and Line Number**, **Paste Commented URI**, and **Format URI's**.

## [endpointer](./endpointer)

Jump from a frontend API call to the matching backend route in a monorepo. It indexes routes and frontend calls, lists them in a sidebar, and lets you paste endpoint templates that link the two sides together.

## [speed-start](./speed-start)

Finds folders, large files, and startup extensions that slow Cursor down, then adds the ones you pick to `.cursorignore`, `.gitignore`, or the workspace search and watcher excludes.
