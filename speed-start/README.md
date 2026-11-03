# Speed Start

Speed Start finds folders, large files, and startup extensions that slow Cursor down, then lets you ignore the paths you pick.

It stays unloaded until you open the Speed Start view or run one of its commands. Run **Speed Start: Analyze Workspace** from the Command Palette or the Heavy Paths view. The scan counts files and sizes. It does not read file contents, and it does not walk directories already covered by `.gitignore` or `.cursorignore`.

## Heavy paths

The sidebar lists:

- **Not ignored** — directories at 500 files or 5 MB, and files at 1 MB. Children of a heavy directory stay collapsed under it.
- **Already ignored** — ignored directories that were not walked.

Select one or more paths, then:

- **Add to .cursorignore** so Cursor stops indexing them. Agent, Tab, and @ mentions stop reading them too.
- **Add to .gitignore** when the folder should stay out of git. Files that are already committed stay tracked. Cursor also skips gitignored paths.
- **Exclude from search and watcher** to update workspace `search.exclude` and `files.watcherExclude`.

Common build folder names (`dist`, `build`, `coverage`, `node_modules`, `out`, `.next`, `.turbo`) can be written as the specific path or as `**/name/`. After a `.cursorignore` or `.gitignore` change, run **Reindex** from the Command Palette once.

If the workspace sits under MEGA, Dropbox, OneDrive, Google Drive, or iCloud, the view says so. Sync clients can rewrite timestamps and make Cursor scan again. Speed Start cannot pause sync.

**Speed Start: Copy Report** copies a markdown summary of the heavy paths, suggested ignore lines, and startup extensions.

## Startup extensions

The second view lists extensions that activate on `*`, `onStartupFinished`, or `workspaceContains`. Third-party extensions are separate from built-in `vscode.*` and `anysphere.*` extensions. Title-bar actions open Startup Performance, Process Explorer, Running Extensions, and Extension Bisect.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `speedStart.directoryFileCount` | 500 | List a directory at this many files |
| `speedStart.directorySizeMB` | 5 | List a directory at this total size |
| `speedStart.fileSizeMB` | 1 | List a single file at this size |
| `speedStart.maxEntries` | 40 | Top-level rows in each group |
| `speedStart.maxFilesVisited` | 200000 | Stop the walk after this many entries |

## Development

Open this folder and press F5. `pnpm run compile` builds it, and `pnpm test` compiles and runs the matcher tests.
