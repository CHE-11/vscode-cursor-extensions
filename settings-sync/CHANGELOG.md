# Change Log

## Unreleased

- Upload and download sync the newest Cursor agent chats that fit in the Gist, and merge them into the local chat database.
- Chat text is stored in the same Gist as settings. Reload the window after a download to see it.
- The sidebar no longer has a Status section. Token, Gist id, and the last upload and download times sit beside those actions.

## 1.0.3

- The activity bar Settings Sync view shows token and Gist status, then upload, download, and every Settings Sync option.

## 1.0.0

- Sync settings, keybindings, snippets, launch config, and extensions through a GitHub Gist.
- The GitHub token is stored in Secret Storage. The copied OAuth client secret and local login server were removed.
- Extension installs and uninstalls ask first. Automatic download does not change extensions.
- Gist file names cannot write outside the User folder.
- Based on settings-sync by Shan Khan.
