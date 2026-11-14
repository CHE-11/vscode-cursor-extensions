# Settings Sync

Settings Sync uploads and downloads your editor settings through a GitHub Gist or a JSON file in a folder you choose.

Maintained by che-11. The behavior comes from [settings-sync](https://github.com/shanalikhan/settings-sync) by [Shan Khan](https://github.com/shanalikhan). That project is MIT licensed, and its license is in [LICENSE](LICENSE).

## What it syncs

- `settings.json`, `keybindings.json`, and `launch.json`
- Snippets
- The list of installed extensions
- Cursor agent chat history. A Gist always includes chats. A local folder includes them when chat sync is on
- Extra files you add from Settings Sync: Options

`@sync os=`, `@sync host=`, `@sync env=`, and `@sync-ignore` pragmas still select or skip lines inside settings and keybindings. The local ignore lists live in `syncLocalSettings.json` in the User folder. `globalStorage` and `History` are ignored.

## Chats

On Cursor, upload and download also sync agent chats. The chats are copied out of `User/globalStorage/state.vscdb` and stored with the settings. The history row is stored with the conversation blobs it points at, so a synced chat can be opened. Message text is included. Saved file snapshots and the code-block cache on the composer are not, and the rest of the agent blob cache is not copied. A chat whose conversation blobs are already missing is left out, instead of uploading a title that cannot be opened.

A Gist includes every chat that fits in the upload, with the blobs needed to open it. There is no chat toggle and no cap for a Gist.

A local folder includes chats only when **Toggle Chat Sync** is on (`settings-sync.syncChats`). Upload keeps the newest chats up to the Chat Cap. Bubble messages are limited to the Per Chat Message Cap. Agent transcripts are included with the blobs needed to open them. Both caps default to 15 chats and 30 messages. Change them from the sidebar while the sync location is a local folder. They are saved in `syncLocalSettings.json`. Older chats, and chats that do not fit, stay on the machine that has them.

Download merges chats by id. A newer copy wins, and a chat that exists only on this machine is left in place. Nothing else in `state.vscdb` is replaced. Reload the window after a download to see the merged chats.

## Token

Create a GitHub personal access token with the **gist** scope, then run **Settings Sync: Options** and choose **Set GitHub Token**. The token is stored in VS Code Secret Storage. It is not written into `syncLocalSettings.json`.

A token that was saved by the original extension is moved into Secret Storage and removed from that file on startup.

Leave `settings-sync.githubEnterpriseUrl` empty for github.com. An enterprise URL must be `https`, and its API calls go to `https://your-host/api/v3`. If `http.proxy` is set, requests go through that proxy. When the proxy module is unavailable, the token is not sent.

## Folder

**Sync Location** is Gist or Local Folder. Only the active location is uploaded and downloaded. The other path stays saved.

**Select Local Folder** chooses the folder, and it is shown only while the location is Local Folder. The folder path sits next to that row when one is saved. Choose a folder outside the User folder. Upload writes one `settings-sync.json` file there. A cloud-sync app such as MEGA can copy that file between computers. The extension does not talk to the cloud app, and it does not put the User folder itself in the sync folder.

With auto download on, the editor also reads that file when it changes, after a short wait. A file that is still being copied is left alone until it is valid JSON. Automatic download updates files only.

## Sidebar

The **Settings Sync** icon on the activity bar opens the sync view.

**Sync** uploads, downloads, or clears the active location and uploads the current settings. Upload and Download show the last time that action ran. **Clear Gist and Reupload** asks before it deletes the files in the Gist and uploads the current settings in their place. In folder mode the same command clears `settings-sync.json` and uploads the current settings. **View Sync Logs** opens the Settings Sync output channel when a summary from this session is still there. The last line is the time from the start of that sync until its write finished.

**Setup** follows the sync location, and **Settings Sync: Options** lists the same rows.

**Sync Location** shows Gist or Local Folder. With Gist selected, the sidebar has Set GitHub Token, Choose Gist, Download Public Gist, and Upload to a New Public Gist. Set GitHub Token shows whether a token is saved, and Choose Gist shows the Gist id. The token itself is not shown. Chat sync has no rows, because a Gist always includes chats.

With Local Folder selected, those Gist rows are hidden. **Select Local Folder** shows the folder path when one is saved. Toggle Chat Sync, Chat Cap, and Per Chat Message Cap are shown only for a local folder.

Both locations can edit local settings, open settings, add or import a custom file, and toggle auto upload, auto download, force upload, force download, and the quiet summary. How to Configure and Reset are there too.

## Download

**Settings Sync: Download Settings** asks before it installs or uninstalls anything. Extension ids have to look like `publisher.name`. Downloads do not use a URL stored in the Gist. Automatic download, when enabled, updates files only.

## Commands

| Command | Id | Shortcut |
| --- | --- | --- |
| Settings Sync: Upload Settings | `settings-sync.upload` | Alt+Shift+U |
| Settings Sync: Download Settings | `settings-sync.download` | Alt+Shift+D |
| Settings Sync: Clear Gist and Reupload | `settings-sync.clearAndUpload` | |
| Settings Sync: View Sync Logs | `settings-sync.viewLogs` | |
| Settings Sync: Options | `settings-sync.options` | |
| Settings Sync: How to Configure | `settings-sync.how` | |
| Settings Sync: Reset | `settings-sync.reset` | |

## Development

Open this folder and press F5 after `pnpm run watch`. `pnpm test` compiles and runs the path, GitHub, and pragma tests. `pnpm run package` writes `builds/ce-settings-sync-<version>.vsix`.
