# vscode-cursor-extensions

VS Code and Cursor extensions. Each folder is its own extension. Some of these are based on others extensions, some are total copies, and some are from scratch. 

The goal was to reduce the number of extensions I have, understand their dependencies, risks, and startup speed, and make it easier to manage them.

**All extensions code names starts with `ce-` prefix. This groups them together in the Extensions Menu for easy access.**

## [auto-rename-tag](./auto-rename-tag)
Automatically renames paired HTML/XML tags when you type the opening tag. Based on [formulahendry/vscode-auto-rename-tag](https://github.com/formulahendry/vscode-auto-rename-tag).

## [close-tabs](./close-tabs)
Adds tab-menu commands to close unchanged files, diff editors, tabs to the left, and tabs of a chosen type. Based on [Balastrong/close-tabs](https://github.com/Balastrong/close-tabs).

## [code-runner](./code-runner)
Runs the active file, or the current selection, from a play button in the editor title. The sidebar edits the program used for each language, extension, and filename glob. A second file opens its own terminal while the first is still running.

## [code-counter](./code-counter)
Counts code, comment, and blank lines in a workspace, a folder, or the active editor. The activity bar lists those commands and the file types and globs the count walks. Based on [uctakeoff/vscode-counter](https://github.com/uctakeoff/vscode-counter).

## [settings-sync](./settings-sync)
Syncs settings, keybindings, snippets, launch config, extensions, and the 10 newest Cursor agent chats through a GitHub Gist. The activity bar shows sync status and the setup actions. The token stays in Secret Storage, and downloads ask before changing extensions. Based on [shanalikhan/settings-sync](https://github.com/shanalikhan/settings-sync).

## [endpointer](./endpointer)
Jump from a frontend API call to the matching backend route in a monorepo. It indexes routes and frontend calls, lists them in a sidebar, and lets you paste endpoint templates that link the two sides together.

## [error-gutters](./error-gutters)
Shows error, warning, and info icons in the gutter beside lines with diagnostics. Based on [PinkaminaDianePie/error-gutters](https://github.com/PinkaminaDianePie/error-gutters).

## [fold-level](./fold-level)
Puts fold-level buttons on the status bar so the active editor can be collapsed to a chosen depth. Based on [denjay/fold-level](https://github.com/denjay/fold-level).

## [make-hidden](./make-hidden)
Hides files and folders from the explorer with context menu actions, a Hidden Items view, and saved workspaces. Based on [Devine-Davies/vs-make-hidden](https://github.com/Devine-Davies/vs-make-hidden).

## [speed-start](./speed-start)
Finds folders, large files, and startup extensions that slow Cursor down, then adds the ones you pick to `.cursorignore`, `.gitignore`, or the workspace search and watcher excludes.

## [styled-jsx](./styled-jsx)
Syntax highlighting and language features for styled-jsx. Completions, hover, diagnostics, and colors run inside `<style jsx>` blocks and `css` template literals. Based on [iFwu/vscode-styled-jsx](https://github.com/iFwu/vscode-styled-jsx) and [Grimones/vscode-styled-jsx-languageserver](https://github.com/Grimones/vscode-styled-jsx-languageserver).

## [task-manager](./task-manager)
Folder-aware tasks for workspaces that contain several projects. It finds every `.vscode/tasks.json` in the workspace, shows those tasks in the status bar and a sidebar, and scopes the status bar to the project of the active file.

## [uri-quick-linker](./uri-quick-linker)
Copy a file URI with its line number, paste it as a commented link, and click the link to jump back to that location. Right-click in the editor for **Copy URI and Line Number**, **Paste Commented URI**, and **Format URI's**.

