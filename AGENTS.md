# Extension format

Each active extension is one folder at the repo root. The folder name is kebab-case and does not include the `ce-` prefix (`fold-level`). `package-all.mjs` only discovers direct children of the repo root whose `package.json` has `engines.vscode`, `name`, and `scripts.package`.

Leave `archived/` and `postgresql/` as they are. New extensions go at the repo root.

## Files

```
fold-level/
  package.json
  package.js
  pnpm-lock.yaml
  tsconfig.json
  README.md
  CHANGELOG.md
  LICENSE                 # when the code comes from another project
  .gitignore
  .vscodeignore
  .vscode/
    launch.json
    settings.json
  src/
    extension.ts
  assets/
    fold-level.png
```

`extension.ts` exports `activate` and `deactivate`. It registers commands, views, and listeners, and pushes them onto `context.subscriptions`. Behavior that can be tested lives in other files under `src/`. Tests are `src/*.test.ts` and use `node:test`.

## package.json

```json
{
  "name": "ce-fold-level",
  "displayName": "CE | Fold Level",
  "description": "One sentence.",
  "version": "1.0.0",
  "publisher": "che-11",
  "author": "che-11",
  "repository": {
    "type": "git",
    "url": "https://github.com/CHE-11/vscode-cursor-extensions.git",
    "directory": "fold-level"
  },
  "icon": "assets/fold-level.png",
  "engines": { "vscode": "^1.88.0" },
  "main": "./out/src/extension.js",
  "scripts": {
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "test": "pnpm run compile && node --test out/src/**/*.test.js",
    "package": "node package.js"
  }
}
```

`name` is `ce-` plus the folder name. `displayName` is `CE | ` plus the title, so the extensions group together in the Extensions view. `publisher` and `author` are `che-11`. `engines.vscode` is `^1.88.0` and `@types/vscode` is `~1.88.0`, raised together when the code needs a newer API. `@types/node` is `18.x`.

Every extension has a PNG icon at least 128×128, and the `icon` field points at that file. Put it at `icon.png` or `assets/<folder>.png`. When the field or the file is missing, add both. Match the icons already in the repo: a rounded square, one flat color, and a simple white mark.

Command ids, menu ids, and view ids start with the folder name: `fold-level.unfoldAll`. The command `category` is the title without `CE | `. Configuration keys use the same folder prefix. Keep ids that are already published.

Activation stays as narrow as the feature allows. An empty `activationEvents` array is the default, because VS Code then activates on a contributed command. Use `onStartupFinished` only when the extension must draw UI before any command, such as a status-bar item. Do not use `*`.

Add few runtime dependencies. This repo exists to keep startup cheap and the dependency set understandable.

## Build

`package.js` is the build. Copy `fold-level/package.js` and change only the folder slug in `contentUrl` and `imagesUrl`, plus the extension name in the log lines. It bumps the patch version, runs `pnpm run compile`, packs a VSIX with `pnpm dlx @vscode/vsce`, and copies that VSIX to `_latest_builds_/`. It is plain CommonJS, run with `node package.js`.

Package one extension with `pnpm run package` from its folder. Package, install, or publish every active extension from the repo root with `node package-all.mjs`, `node install-all-vsix.mjs`, or `node publish-all.mjs`. Those three commands are the tasks in the root `.vscode/tasks.json`.

Use pnpm. Each extension has its own `pnpm-lock.yaml`. There is no root workspace manifest.

`compile` is `tsc -p ./` and writes `out/src/extension.js`, which `main` points at. Add esbuild only when the extension has to bundle a language server or other runtime that `tsc` cannot emit alone. `package.js` still calls `pnpm run compile`, and `main` still points at the file that compile emits. Leave an extension's existing `main` and `outDir` in place.

Do not put a `tasks.json` in an extension. The root `.vscode/tasks.json` is the only task list. An extension `.vscode` folder holds `launch.json` and `settings.json`. `launch.json` runs the Extension Development Host for that folder opened as its own workspace, and it has no `preLaunchTask`. Compile with `pnpm run watch` in a terminal, then start the debugger. `settings.json` sets `typescript.tsc.autoDetect` to `off`.

`.vscodeignore` excludes `.vscode/**`, `src/**`, `builds/**`, `node_modules/**`, `.gitignore`, `package.js`, `pnpm-lock.yaml`, `**/tsconfig.json`, `**/*.map`, `**/*.ts`, and `**/*.test.js`. The extension `.gitignore` lists `out`, `node_modules`, and `.vscode-test`. VSIX files under `<extension>/builds/` stay untracked. The tracked build is the single file `package.js` adds under `_latest_builds_/`.

Do not hand-edit `version`. Packaging bumps it. Update `CHANGELOG.md` when behavior changes.

## Docs

The extension `README.md` says what it does. When the code comes from another project, name that repository and author, and keep its license. Add one section for the new extension to the root `README.md`.

## TypeScript

```json
{
  "compilerOptions": {
    "module": "Node16",
    "target": "ES2022",
    "outDir": "out",
    "lib": ["ES2022"],
    "sourceMap": true,
    "rootDir": ".",
    "strict": true
  },
  "include": ["src/**/*.ts"]
}
```
