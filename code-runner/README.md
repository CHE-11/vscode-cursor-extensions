# Code Runner

Run the file you are editing, or the current selection, and edit the program used for each file type from the sidebar.

## Run

- **Run Code** (`Ctrl+Alt+N`) runs the active file. The play button is in the editor title and at the top of the Code Runner sidebar. The same command is on the editor context menu and the explorer file menu.
- A selection runs from a temporary file next to the original. Untitled editors do too. Turn on `codeRunner.ignoreSelection` to always run the whole file.
- **Stop Code Run** (`Ctrl+Alt+M`) sends Ctrl+C in the terminal, or kills the output-channel process.
- **Run By Language** (`Ctrl+Alt+J`) picks a language and runs the active editor with that program.
- **Run Custom Command** (`Ctrl+Alt+K`) runs `codeRunner.customCommand`.

Runs use the integrated terminal by default. Set `codeRunner.runInTerminal` to `false` to capture stdout and stderr in the **Code Runner** output channel.

On Windows, when the integrated terminal is PowerShell, `&&` chains are rewritten so the default C, C++, and Java programs still run.

## Programs

The Code Runner sidebar lists languages, extensions, globs, and the custom command. Edit writes that one entry into the workspace folder settings, or into user settings when no folder is open. Reset removes the override and brings the default back. Delete does the same, and asks before removing a program that has no default.

The program is chosen in this order: filename glob, shebang (`#!`, not `#![`), language id, file extension, then `codeRunner.defaultLanguage`. The first matching glob wins. `*` and `?` match inside the file name.

Placeholders:

| Placeholder | Value |
| --- | --- |
| `$workspaceRoot` | Workspace folder, or the file directory when no folder is open |
| `$dir` | Directory of the file, with a trailing slash |
| `$dirWithoutTrailingSlash` | That directory without the trailing slash |
| `$fullFileName` | Full path of the file |
| `$fileName` | File name |
| `$fileNameWithoutExt` | File name without the last extension |
| `$driveLetter` | Windows drive letter, such as `C:` |
| `$pythonPath` | `python.defaultInterpreterPath`, or `python` |

Paths are quoted and use forward slashes. `$dir$fileNameWithoutExt` becomes one quoted path. If the command contains no placeholder, the quoted full path is appended. A command that uses `$dir` or `$pythonPath` and still needs the file should include `$fullFileName` or `$fileName`.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `codeRunner.runInTerminal` | `true` | Run in the integrated terminal |
| `codeRunner.saveFileBeforeRun` | `true` | Save the file before running it |
| `codeRunner.saveAllFilesBeforeRun` | `false` | Save every dirty file first |
| `codeRunner.fileDirectoryAsCwd` | `false` | Use the file's directory as the working directory |
| `codeRunner.cwd` | empty | Working directory override |
| `codeRunner.clearPreviousOutput` | `false` | Clear the terminal or output channel first |
| `codeRunner.ignoreSelection` | `false` | Ignore the editor selection |
| `codeRunner.preserveFocus` | `true` | Keep focus in the editor |
| `codeRunner.respectShebang` | `true` | Honor `#!` when no glob matches |
| `codeRunner.defaultLanguage` | empty | Fallback language id |
| `codeRunner.customCommand` | `echo Hello` | Command for Run Custom Command |
| `codeRunner.temporaryFileName` | `tempCodeRunnerFile` | Base name for selection files |

`codeRunner.executorMap`, `codeRunner.executorMapByFileExtension`, and `codeRunner.executorMapByGlob` hold the programs. The sidebar edits those settings.

Command ids use the `codeRunner` prefix so they do not collide with the Marketplace extension `formulahendry.code-runner`. The shortcuts are the same, so do not install both if you want `Ctrl+Alt+N` to hit this one.

## Development

Open `code-runner` and run the **Run Extension** launch config.

```powershell
pnpm install
pnpm test
```

`pnpm run package` writes `builds/code-runner-<version>.vsix`.
