# Change Log

## Unreleased

- The Upload or Download row spins while that sync is running. A lock left by a closed window no longer blocks the next upload.
- Chat Cap and Per Chat Message Cap, in the sidebar, choose how many chats and messages are synced. They default to 15 chats and 30 messages and are saved in `syncLocalSettings.json`.
- The sync log ends with the time from the start of the sync until the write finishes.
- Sync Location can store the same snapshot in a local folder as `settings-sync.json`. A Gist remains available, and only the active location is used.
- Upload and download sync the 15 newest Cursor agent chats, with the last 30 messages of each, and merge them into the local chat database.
- Clear Gist and Reupload, in the sidebar and the command palette, asks before it deletes the Gist files and uploads the current settings.
- View Sync Logs, under Sync in the sidebar, opens the Settings Sync output channel when a summary from this session is still there.
- Chat text is stored in the same Gist as settings. Reload the window after a download to see it.
- The sidebar no longer has a Status section. Token, Gist id, and the last upload and download times sit beside those actions.
- A finished sync reports on the status bar and leaves the panel closed. The full summary stays in the Settings Sync output channel.

## 1.0.3

- The activity bar Settings Sync view shows token and Gist status, then upload, download, and every Settings Sync option.

## 1.0.0

- Sync settings, keybindings, snippets, launch config, and extensions through a GitHub Gist.
- The GitHub token is stored in Secret Storage. The copied OAuth client secret and local login server were removed.
- Extension installs and uninstalls ask first. Automatic download does not change extensions.
- Gist file names cannot write outside the User folder.
- Based on settings-sync by Shan Khan.
