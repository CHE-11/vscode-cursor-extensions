# Settings Sync

Settings Sync uploads and downloads your editor settings through a GitHub Gist.

Maintained by che-11. The behavior comes from [settings-sync](https://github.com/shanalikhan/settings-sync) by [Shan Khan](https://github.com/shanalikhan). That project is MIT licensed, and its license is in [LICENSE](LICENSE).

## What it syncs

- `settings.json`, `keybindings.json`, and `launch.json`
- Snippets
- The list of installed extensions
- Extra files you add from Settings Sync: Options

`@sync os=`, `@sync host=`, `@sync env=`, and `@sync-ignore` pragmas still select or skip lines inside settings and keybindings. The local ignore lists live in `syncLocalSettings.json` in the User folder. `globalStorage` and `History` are ignored.

## Token

Create a GitHub personal access token with the **gist** scope, then run **Settings Sync: Options** and choose **Set GitHub Token**. The token is stored in VS Code Secret Storage. It is not written into `syncLocalSettings.json`.

A token that was saved by the original extension is moved into Secret Storage and removed from that file on startup.

Leave `settings-sync.githubEnterpriseUrl` empty for github.com. An enterprise URL must be `https`, and its API calls go to `https://your-host/api/v3`. If `http.proxy` is set, requests go through that proxy. When the proxy module is unavailable, the token is not sent.

## Sidebar

The **Settings Sync** icon on the activity bar opens the sync view.

**Sync** uploads or downloads.

**Status** shows whether a token is saved, the Gist id, and the last upload and download times. The token itself is not shown.

**Setup** has the same actions as **Settings Sync: Options**: set the token, choose a Gist, edit local settings, open settings, download a public Gist, upload to a new public Gist, add or import a custom file, and toggle auto upload, auto download, force upload, force download, and the quiet summary. How to Configure and Reset are there too.

## Download

**Settings Sync: Download Settings** asks before it installs or uninstalls anything. Extension ids have to look like `publisher.name`. Downloads do not use a URL stored in the Gist. Automatic download, when enabled, updates files only.

## Commands

| Command | Id | Shortcut |
| --- | --- | --- |
| Settings Sync: Upload Settings | `settings-sync.upload` | Alt+Shift+U |
| Settings Sync: Download Settings | `settings-sync.download` | Alt+Shift+D |
| Settings Sync: Options | `settings-sync.options` | |
| Settings Sync: How to Configure | `settings-sync.how` | |
| Settings Sync: Reset | `settings-sync.reset` | |

## Development

Open this folder and press F5 after `pnpm run watch`. `pnpm test` compiles and runs the path, GitHub, and pragma tests. `pnpm run package` writes `builds/ce-settings-sync-<version>.vsix`.
