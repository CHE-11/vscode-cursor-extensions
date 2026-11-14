import { basename, join } from 'node:path';
import * as vscode from 'vscode';
import type { App } from './app';
import { currentOs, OsType } from './enums';
import {
  applyExtensionChanges,
  confirmExtensionChanges,
  extensionChanges,
  extensionIsIgnored,
  listLocalExtensions,
  parseExtensionList,
} from './extensions';
import { downloadTarget, fileExists, listUserFiles, readText, writeExact, writeInside, type SyncFile } from './files';
import { BundleFormatError, bundlePath, folderIsSafe, readBundle, writeBundle } from './folder';
import { createClient, githubErrorMessage, type RemoteGist } from './github';
import { tryLock } from './lock';
import PragmaUtil from './pragmaUtil';
import {
  CHAT_COUNT_RANGE,
  CUSTOM_PREFIX,
  FILES,
  MESSAGE_COUNT_RANGE,
  type LocalSettings,
  clampCount,
  customFileTarget,
  defaultLocalSettings,
  gistNameToUserPath,
  isPlausibleToken,
  parseGistId,
  workspaceFileTarget,
} from './safe';
import { clearSettings, localSettingsPath, proxyUrl, readLocal, readSettings, updateSettings, writeLocal, type SyncSettings } from './settings';
import { CHAT_BUDGET_BYTES, CHAT_FILE_BYTES, CHAT_VALUE_BYTES, exportChats, importChats, isChatChunkName } from './chats';
import { actionsFor, optionActions, optionsMenu, type SyncAction, type ToggleKey } from './options';
import { setSyncActivity, syncActivity, type SyncActivity } from './refresh';
import { showSummary, viewSyncLogs } from './summary';
import { clearToken, getToken, promptToken } from './token';
import { stopFolderWatching, stopUploadWatching, stopWatching, watchBundle, watchUploads } from './watcher';

interface RunOptions {
  publicGist?: boolean;
  extensions?: boolean;
  quietIfBusy?: boolean;
  quietIfCurrent?: boolean;
  replaceGist?: boolean;
  activity?: SyncActivity;
}

export async function bootstrap(app: App): Promise<void> {
  const settings = readSettings();
  if (settings.autoDownload && locationReady(app, settings)) {
    await download(app, { extensions: false, quietIfBusy: true });
  }
  armWatchers(app);
}

export function armWatchers(app: App): void {
  armWatcher(app);
  armFolderWatcher(app);
}

export async function upload(app: App, options: RunOptions = {}): Promise<void> {
  await runLocked(app, { ...options, activity: 'upload' }, async () => {
    const started = Date.now();
    stopUploadWatching();
    const settings = readSettings();
    if (settings.location === 'folder') {
      await uploadFolder(app, settings, options, started);
      return;
    }
    let token = await savedToken(app);
    if (!token) token = await promptToken(app.context);
    if (!token) return;
    const local = await loadLocal(app);
    const client = await createClient(token, settings.githubEnterpriseUrl, proxyUrl());
    const uploadedAt = new Date().toISOString();
    const collected = await collectFiles(app, local, settings, uploadedAt, true);
    const { files, ignored, preserveChats, notes } = collected;
    let gistId = parseGistId(settings.gist) || '';
    let isPublic = options.publicGist === true;
    let description = settings.gistDescription;

    if (!gistId) {
      if (settings.askGistDescription) {
        const entered = await vscode.window.showInputBox({
          title: 'Gist description',
          value: description,
          ignoreFocusOut: true,
        });
        if (entered && entered.trim()) description = entered.trim();
      }
      gistId = await client.createGist(isPublic, description, gistPayload(files));
      const elapsedMs = Date.now() - started;
      await updateSettings({ gist: gistId, downloadPublicGist: false });
      await rememberSync(app, local, uploadedAt, uploadedAt);
      report(settings, {
        upload: true,
        files,
        gist: gistId,
        isPublic,
        ignored,
        installed: [],
        removed: [],
        failed: [],
        hasToken: true,
        notes,
        elapsedMs,
      });
      void vscode.window.showInformationMessage(`Settings Sync created Gist ${gistId}.`);
      return;
    }

    const existing = await client.getGist(gistId);
    const login = await client.getLogin();
    if (existing.ownerLogin && existing.ownerLogin !== login) {
      throw new Error(`This Gist belongs to ${existing.ownerLogin}.`);
    }
    isPublic = existing.public;
    const replaceGist = options.replaceGist === true;
    if (!replaceGist && !hasChanges(existing, files, preserveChats) && !settings.forceUpload) {
      if (notes.length > 0) void vscode.window.showWarningMessage(`Settings Sync: ${notes[0]}`);
      else void vscode.window.setStatusBarMessage('Settings Sync: the Gist already matches these files.', 5000);
      return;
    }
    if (!replaceGist && !settings.forceUpload && !(await confirmUpload(existing, local, 'Gist'))) return;

    void vscode.window.setStatusBarMessage(replaceGist ? 'Settings Sync: clearing the Gist and uploading.' : 'Settings Sync: uploading.', 3000);
    await client.updateGist(gistId, replaceGist ? replacePayload(existing, files) : updatePayload(existing, files, preserveChats));
    const elapsedMs = Date.now() - started;
    await rememberSync(app, local, uploadedAt, uploadedAt);
    report(settings, {
      upload: true,
      files,
      gist: gistId,
      isPublic,
      ignored,
      installed: [],
      removed: [],
      failed: [],
      hasToken: true,
      notes,
      elapsedMs,
    });
  });
}

export async function download(app: App, options: RunOptions = {}): Promise<void> {
  await runLocked(app, { ...options, activity: 'download' }, async () => {
    const started = Date.now();
    stopUploadWatching();
    const settings = readSettings();
    if (settings.location === 'folder') {
      await downloadFolder(app, settings, options, started);
      return;
    }
    const gistId = parseGistId(settings.gist);
    if (!gistId) {
      void vscode.window.showInformationMessage('Set a Gist id before downloading.');
      return;
    }
    const token = await savedToken(app);
    if (!token && !settings.downloadPublicGist) {
      const entered = await promptToken(app.context);
      if (!entered) return;
    }
    const activeToken = (await savedToken(app)) || '';
    const local = await loadLocal(app);
    const client = await createClient(activeToken, settings.githubEnterpriseUrl, proxyUrl());
    void vscode.window.setStatusBarMessage('Settings Sync: reading the Gist.', 2000);
    const existing = await client.getGist(gistId);
    await applyDownload(app, settings, local, existing, options, gistId, activeToken !== '', started);
  });
}

async function uploadFolder(app: App, settings: SyncSettings, options: RunOptions, started: number): Promise<void> {
  if (!folderIsSafe(app.userFolder, settings.folder)) {
    void vscode.window.showErrorMessage('Choose a sync folder outside the User folder.');
    return;
  }
  const local = await loadLocal(app);
  const uploadedAt = new Date().toISOString();
  const collected = await collectFiles(app, local, settings, uploadedAt, false);
  const { files, ignored, preserveChats, notes } = collected;
  const replaceFolder = options.replaceGist === true;
  if (replaceFolder) {
    void vscode.window.setStatusBarMessage('Settings Sync: clearing the folder and uploading.', 3000);
    await writeBundle(settings.folder, gistPayload(files));
    const elapsedMs = Date.now() - started;
    await rememberSync(app, local, uploadedAt, uploadedAt);
    report(settings, {
      upload: true,
      files,
      gist: '',
      isPublic: false,
      ignored,
      installed: [],
      removed: [],
      failed: [],
      hasToken: false,
      notes,
      elapsedMs,
    });
    return;
  }

  let existing: RemoteGist;
  try {
    existing = await readBundle(settings.folder);
  } catch (error) {
    if (error instanceof BundleFormatError) {
      void vscode.window.showErrorMessage('The sync folder file is not valid JSON. Upload left it unchanged.');
      return;
    }
    throw error;
  }
  if (!hasChanges(existing, files, preserveChats) && !settings.forceUpload) {
    if (notes.length > 0) void vscode.window.showWarningMessage(`Settings Sync: ${notes[0]}`);
    else void vscode.window.setStatusBarMessage('Settings Sync: the folder already matches these files.', 5000);
    return;
  }
  if (!settings.forceUpload && !(await confirmUpload(existing, local, 'sync folder'))) return;

  void vscode.window.setStatusBarMessage('Settings Sync: uploading.', 3000);
  await writeBundle(settings.folder, folderPayload(existing, files, preserveChats));
  const elapsedMs = Date.now() - started;
  await rememberSync(app, local, uploadedAt, uploadedAt);
  report(settings, {
    upload: true,
    files,
    gist: '',
    isPublic: false,
    ignored,
    installed: [],
    removed: [],
    failed: [],
    hasToken: false,
    notes,
    elapsedMs,
  });
}

async function downloadFolder(app: App, settings: SyncSettings, options: RunOptions, started: number): Promise<void> {
  if (!folderIsSafe(app.userFolder, settings.folder)) {
    if (!options.quietIfCurrent) void vscode.window.showInformationMessage('Choose a sync folder before downloading.');
    return;
  }
  if (!(await fileExists(bundlePath(settings.folder)))) {
    if (!options.quietIfCurrent) void vscode.window.showInformationMessage('The sync folder has no settings file yet.');
    return;
  }
  let existing: RemoteGist;
  try {
    existing = await readBundle(settings.folder);
  } catch (error) {
    if (error instanceof BundleFormatError) {
      if (!options.quietIfCurrent) void vscode.window.showErrorMessage('The sync folder file is not valid JSON yet.');
      return;
    }
    throw error;
  }
  const local = await loadLocal(app);
  void vscode.window.setStatusBarMessage('Settings Sync: reading the sync folder.', 2000);
  await applyDownload(app, settings, local, existing, options, '', false, started);
}

async function applyDownload(
  app: App,
  settings: SyncSettings,
  local: LocalSettings,
  existing: RemoteGist,
  options: RunOptions,
  remoteId: string,
  hasToken: boolean,
  started: number
): Promise<void> {
  const cloud = existing.files[FILES.cloud]?.content;
  if (cloud && alreadyDownloaded(local, cloud, settings.forceDownload)) {
    if (!options.quietIfCurrent) {
      void vscode.window.setStatusBarMessage('Settings Sync: you already have this version.', 5000);
    }
    return;
  }

  const planned = await planWrites(app.userFolder, existing, local, settings);
  const notes: string[] = [];
  let chatsApplied = 0;
  if (includeChats(settings) && vscode.env.appName === 'Cursor' && Object.keys(planned.chats).length > 0) {
    const imported = await importChats(app.userFolder, planned.chats);
    notes.push(...imported.notes);
    chatsApplied = imported.applied;
  }
  for (const file of planned.writes) {
    if (file.custom) await writeExact(file.target, file.content);
    else await writeInside(app.userFolder, file.target, file.content);
  }
  const elapsedMs = Date.now() - started;
  if (planned.rejected.length > 0) {
    const kind = settings.location === 'folder' ? 'sync file(s)' : 'Gist file(s)';
    void vscode.window.showWarningMessage(`Skipped ${planned.rejected.length} ${kind} that would write outside the User folder.`);
  }

  let installed: string[] = [];
  let removed: string[] = [];
  let failed: string[] = [];
  if (options.extensions !== false && settings.syncExtensions && planned.extensions) {
    const changes = extensionChanges(parseExtensionList(planned.extensions), local.ignoreExtensions);
    const uninstall = settings.removeExtensions ? changes.uninstall : [];
    const selected = await confirmExtensionChanges(changes.install, uninstall);
    if (selected) {
      const applied = await applyExtensionChanges(selected.install, selected.uninstall);
      installed = applied.installed;
      removed = applied.removed;
      failed = applied.failed;
      if (failed.length > 0) {
        void vscode.window.showWarningMessage(`Settings Sync could not change: ${failed.join(', ')}`);
      }
    }
  }

  const downloadedAt = cloudTime(cloud) || new Date().toISOString();
  await rememberSync(app, local, local.lastUpload, downloadedAt);
  report(settings, {
    upload: false,
    files: planned.writes.map((file) => ({
      fileName: file.fileName,
      gistName: file.gistName,
      content: file.content,
      absolutePath: file.target,
    })),
    gist: remoteId,
    isPublic: existing.public,
    ignored: local.ignoreExtensions,
    installed,
    removed,
    failed,
    hasToken,
    notes,
    elapsedMs,
  });
  const reloadForExtensions = installed.length > 0 || removed.length > 0;
  if (chatsApplied > 0 || reloadForExtensions) {
    const message = chatsApplied > 0 && reloadForExtensions
      ? 'Reload the window to see synced chats and extension changes.'
      : chatsApplied > 0
        ? 'Reload the window to see synced chats.'
        : 'Extension changes may need a reload.';
    const reload = await vscode.window.showInformationMessage(message, 'Reload');
    if (reload === 'Reload') await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

export async function clearAndUpload(app: App): Promise<void> {
  const settings = readSettings();
  if (settings.location === 'folder') {
    if (!folderIsSafe(app.userFolder, settings.folder)) {
      void vscode.window.showInformationMessage('Choose a sync folder before clearing it.');
      return;
    }
    const answer = await vscode.window.showWarningMessage(
      'This deletes the sync file in the folder, then uploads the current settings.',
      { modal: true },
      'Clear and Upload'
    );
    if (answer !== 'Clear and Upload') return;
    await upload(app, { replaceGist: true });
    return;
  }
  const gistId = parseGistId(settings.gist);
  if (!gistId) {
    void vscode.window.showInformationMessage('Set a Gist id before clearing it.');
    return;
  }
  const answer = await vscode.window.showWarningMessage(
    'This deletes every file in the Gist, then uploads the current settings.',
    { modal: true },
    'Clear and Upload'
  );
  if (answer !== 'Clear and Upload') return;
  await upload(app, { replaceGist: true });
}

export async function reset(app: App): Promise<void> {
  const answer = await vscode.window.showWarningMessage(
    'This clears the saved token, Gist id, sync folder, and local sync settings.',
    { modal: true },
    'Reset'
  );
  if (answer !== 'Reset') return;
  stopWatching();
  await clearToken(app.context);
  await clearSettings();
  await writeLocal(app.userFolder, defaultLocalSettings());
  void vscode.window.showInformationMessage('Settings Sync settings were cleared.');
}

export async function how(): Promise<void> {
  const open = 'Open GitHub Tokens';
  const choice = await vscode.window.showInformationMessage(
    'Sync Location chooses a Gist or a local folder. A Gist needs a token with the gist scope and always includes Cursor chats. A local folder uses Select Local Folder and has the chat sync options. Download asks before it installs or removes extensions.',
    open
  );
  if (choice === open) await vscode.env.openExternal(vscode.Uri.parse('https://github.com/settings/tokens'));
}

export async function openOptions(app: App): Promise<void> {
  const menu = actionsFor(readSettings().location, optionsMenu());
  const choice = await vscode.window.showQuickPick(menu.map((action) => action.label), {
    title: 'Settings Sync',
    ignoreFocusOut: true,
  });
  const action = menu.find((item) => item.label === choice);
  if (action) await runOption(app, action.id);
}

export async function runOption(app: App, id: SyncAction['id']): Promise<void> {
  if (id === 'upload') return upload(app);
  if (id === 'download') return download(app, { extensions: true });
  if (id === 'clearAndUpload') return clearAndUpload(app);
  if (id === 'viewLogs') return viewSyncLogs();
  const action = optionActions.find((item) => item.id === id);
  if (!action) return;
  if (action.toggle && action.on && action.off) return toggle(app, action.toggle, action.on, action.off);
  if (id === 'setToken') {
    await promptToken(app.context);
    return;
  }
  if (id === 'syncLocation') return chooseLocation();
  if (id === 'selectFolder') return selectFolder(app);
  if (id === 'chooseGist') return chooseGist(app);
  if (id === 'editLocal') return editLocal(app);
  if (id === 'openSettings') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'settings-sync');
    return;
  }
  if (id === 'downloadPublic') return downloadPublic(app);
  if (id === 'sharePublic') return sharePublic(app);
  if (id === 'addCustomFile') return addCustomFile(app);
  if (id === 'importCustomFile') return importCustomFile(app);
  if (id === 'chatCount') return promptCap(app, 'chatCount', 'Chat Cap', 'Newest chats to include.', CHAT_COUNT_RANGE);
  if (id === 'messageCount') return promptCap(app, 'messageCount', 'Per Chat Message Cap', 'Latest messages to keep from each chat.', MESSAGE_COUNT_RANGE);
  if (id === 'how') return how();
  if (id === 'reset') return reset(app);
}

async function runLocked(app: App, options: RunOptions, fn: () => Promise<void>): Promise<void> {
  const outcome = await tryLock(lockFile(app), async () => {
    setSyncActivity(options.activity ?? 'upload');
    try {
      await fn();
    } catch (error) {
      const token = await getToken(app.context);
      void vscode.window.showErrorMessage(githubErrorMessage(error, token));
    } finally {
      setSyncActivity(null);
      armWatchers(app);
    }
  });
  if (outcome.busy && !options.quietIfBusy) {
    const current = syncActivity();
    const message = current === 'upload'
      ? 'Settings Sync is still uploading.'
      : current === 'download'
        ? 'Settings Sync is still downloading.'
        : 'Settings Sync is already running.';
    void vscode.window.showInformationMessage(message);
  }
}

function armWatcher(app: App): void {
  const settings = readSettings();
  if (!settings.autoUpload || !locationReady(app, settings)) {
    stopUploadWatching();
    return;
  }
  watchUploads(app, settings.autoUploadDelay, (current) => upload(current, { quietIfBusy: true }), includeChats(settings));
}

function armFolderWatcher(app: App): void {
  const settings = readSettings();
  if (settings.location !== 'folder' || !settings.autoDownload || !folderIsSafe(app.userFolder, settings.folder)) {
    stopFolderWatching();
    return;
  }
  const folder = settings.folder;
  watchBundle(folder, () => downloadChangedBundle(app, folder));
}

async function downloadChangedBundle(app: App, folder: string): Promise<void> {
  const settings = readSettings();
  if (settings.location !== 'folder' || settings.folder !== folder || !settings.autoDownload) return;
  if (!(await fileExists(bundlePath(folder)))) return;
  try {
    await readBundle(folder);
  } catch (error) {
    if (error instanceof BundleFormatError) return;
    const message = error instanceof Error ? error.message : 'Could not read the sync folder.';
    void vscode.window.showErrorMessage(message);
    return;
  }
  await download(app, { extensions: false, quietIfBusy: true, quietIfCurrent: true });
}

function locationReady(app: App, settings: SyncSettings): boolean {
  if (settings.location === 'folder') return folderIsSafe(app.userFolder, settings.folder);
  return parseGistId(settings.gist) !== null;
}

function includeChats(settings: SyncSettings): boolean {
  return settings.location === 'gist' || settings.syncChats;
}

async function collectFiles(
  app: App,
  local: LocalSettings,
  settings: SyncSettings,
  uploadedAt: string,
  capSize: boolean
): Promise<{ files: SyncFile[]; ignored: string[]; preserveChats: boolean; notes: string[] }> {
  const files: SyncFile[] = [];
  const ignored: string[] = [];
  const notes: string[] = [];
  let preserveChats = true;
  if (settings.syncExtensions) {
    const extensions = listLocalExtensions().filter((extension) => {
      const id = `${extension.publisher}.${extension.name}`;
      const skip = extensionIsIgnored(id, extension.name, local.ignoreExtensions);
      if (skip) ignored.push(id);
      return !skip;
    });
    files.push({
      fileName: FILES.extensions,
      gistName: FILES.extensions,
      content: JSON.stringify(extensions, null, 2),
      absolutePath: null,
    });
  }

  const os = currentOs();
  for (const file of await listUserFiles(app.userFolder, local)) {
    if (!file.content) continue;
    if (capSize && file.content.length > 1_000_000) throw new Error(`${file.gistName} is too large to upload.`);
    let gistName = file.gistName;
    if (file.fileName === FILES.keybindings) {
      gistName = os === OsType.Mac && !settings.universalKeybindings ? FILES.keybindingsMac : FILES.keybindings;
    }
    let content = file.content;
    if (file.fileName === FILES.settings || file.fileName === FILES.keybindings) {
      content = await PragmaUtil.processBeforeUpload(content);
    }
    files.push({ ...file, gistName, content });
  }

  for (const [name, filePath] of Object.entries(local.customFiles)) {
    const target = customFileTarget(filePath);
    if (!target || !(await fileExists(target))) continue;
    const content = await readText(target);
    if (!content || (capSize && content.length > 1_000_000)) continue;
    files.push({
      fileName: name,
      gistName: `${CUSTOM_PREFIX}${name}`,
      content,
      absolutePath: target,
    });
  }

  if (includeChats(settings) && vscode.env.appName === 'Cursor') {
    const gistChats = settings.location === 'gist';
    const exported = await exportChats(app.userFolder, {
      budgetBytes: CHAT_BUDGET_BYTES,
      fileBytes: CHAT_FILE_BYTES,
      valueBytes: CHAT_VALUE_BYTES,
      ...(gistChats ? { allChats: true } : { chatCount: local.chatCount, messageCount: local.messageCount }),
    });
    notes.push(...exported.notes);
    preserveChats = exported.preserve;
    for (const file of exported.files) {
      if (capSize && file.content.length > 1_000_000) continue;
      files.push({
        fileName: file.gistName,
        gistName: file.gistName,
        content: file.content,
        absolutePath: null,
      });
    }
    if (exported.files.length > 0 && files.every((file) => !isChatChunkName(file.gistName))) preserveChats = true;
  }

  const version = typeof app.context.extension.packageJSON.version === 'string' ? app.context.extension.packageJSON.version : '1.0.0';
  files.push({
    fileName: FILES.cloud,
    gistName: FILES.cloud,
    content: JSON.stringify({ lastUpload: uploadedAt, extensionVersion: `v${version}` }),
    absolutePath: null,
  });
  return { files, ignored, preserveChats, notes };
}

async function planWrites(
  userFolder: string,
  gist: RemoteGist,
  local: LocalSettings,
  settings: SyncSettings
): Promise<{ writes: Array<{ fileName: string; gistName: string; target: string; content: string; custom: boolean }>; extensions: string | null; rejected: string[]; chats: Record<string, string> }> {
  const writes: Array<{ fileName: string; gistName: string; target: string; content: string; custom: boolean }> = [];
  const rejected: string[] = [];
  const chats: Record<string, string> = {};
  const os = currentOs();
  let extensions: string | null = null;

  for (const [gistName, file] of Object.entries(gist.files)) {
    if (gistName === FILES.cloud) continue;
    if (gistName === FILES.extensions) {
      extensions = file.content;
      continue;
    }
    if (isChatChunkName(gistName)) {
      if (includeChats(settings)) chats[gistName] = file.content;
      continue;
    }
    const keybinding = gistName === FILES.keybindings || gistName === FILES.keybindingsMac;
    if (keybinding && !takeKeybinding(gistName, os, settings.universalKeybindings)) continue;

    const custom = gistName.startsWith(CUSTOM_PREFIX);
    const target = keybinding
      ? gistNameToUserPath(userFolder, FILES.keybindings)
      : downloadTarget(userFolder, gistName, local.customFiles);
    if (!target) {
      if (!custom && gistName.includes('.')) rejected.push(gistName);
      continue;
    }

    let content = file.content;
    if (gistName === FILES.settings || keybinding) {
      const localContent = (await fileExists(target)) ? await readText(target) : content;
      content = PragmaUtil.processBeforeWrite(localContent, content, os, settings.hostName || null);
    }
    writes.push({
      fileName: custom ? gistName.slice(CUSTOM_PREFIX.length) : basename(target),
      gistName,
      target,
      content,
      custom,
    });
  }

  return { writes, extensions, rejected, chats };
}

function takeKeybinding(gistName: string, os: OsType, universal: boolean): boolean {
  if (universal) return gistName === FILES.keybindings;
  if (os === OsType.Mac) return gistName === FILES.keybindingsMac;
  return gistName === FILES.keybindings;
}

function gistPayload(files: SyncFile[]): Record<string, { content: string }> {
  const payload: Record<string, { content: string }> = {};
  files.forEach((file) => {
    if (file.content) payload[file.gistName] = { content: file.content };
  });
  return payload;
}

function folderPayload(existing: RemoteGist, files: SyncFile[], preserveChats: boolean): Record<string, { content: string } | null> {
  const payload = updatePayload(existing, files, preserveChats);
  for (const [name, file] of Object.entries(existing.files)) {
    if (payload[name] === undefined) payload[name] = file;
  }
  return payload;
}

function updatePayload(existing: RemoteGist, files: SyncFile[], preserveChats: boolean): Record<string, { content: string } | null> {
  const payload: Record<string, { content: string } | null> = gistPayload(files);
  for (const name of Object.keys(existing.files)) {
    if (payload[name] || name.startsWith('keybindings')) continue;
    if (preserveChats && isChatChunkName(name)) continue;
    payload[name] = null;
  }
  return payload;
}

function replacePayload(existing: RemoteGist, files: SyncFile[]): Record<string, { content: string } | null> {
  const payload: Record<string, { content: string } | null> = gistPayload(files);
  for (const name of Object.keys(existing.files)) {
    if (!payload[name]) payload[name] = null;
  }
  return payload;
}

function hasChanges(existing: RemoteGist, files: SyncFile[], preserveChats: boolean): boolean {
  const next = new Map(files.filter((file) => file.gistName !== FILES.cloud && file.content).map((file) => [file.gistName, file.content]));
  for (const [name, content] of next) {
    if (existing.files[name]?.content !== content) return true;
  }
  return Object.keys(existing.files).some((name) => {
    if (name === FILES.cloud || name.startsWith('keybindings') || next.has(name)) return false;
    if (preserveChats && isChatChunkName(name)) return false;
    return true;
  });
}

async function confirmUpload(existing: RemoteGist, local: LocalSettings, remoteName: string): Promise<boolean> {
  const newer = gistIsNewer(existing.files[FILES.cloud]?.content, local.lastDownload);
  const message = !local.lastDownload
    ? 'The last download time is missing. Upload anyway?'
    : newer
      ? `The ${remoteName} is newer than the last download. Upload anyway?`
      : '';
  if (!message) return true;
  const answer = await vscode.window.showWarningMessage(message, { modal: true }, 'Upload');
  return answer === 'Upload';
}

function gistIsNewer(cloud: string | undefined, lastDownload: string | null): boolean {
  const uploaded = cloudTime(cloud);
  if (!uploaded || !lastDownload) return false;
  return new Date(uploaded).getTime() > new Date(lastDownload).getTime();
}

function alreadyDownloaded(local: LocalSettings, cloud: string, force: boolean): boolean {
  if (force) return false;
  const uploaded = cloudTime(cloud);
  if (!uploaded) return false;
  const uploadedTime = new Date(uploaded).getTime();
  return [local.lastDownload, local.lastUpload].some((value) => value !== null && new Date(value).getTime() === uploadedTime);
}

function cloudTime(cloud: string | undefined): string | null {
  if (!cloud) return null;
  try {
    const parsed = JSON.parse(cloud) as { lastUpload?: unknown };
    return typeof parsed.lastUpload === 'string' ? parsed.lastUpload : null;
  } catch {
    return null;
  }
}

async function rememberSync(app: App, local: LocalSettings, lastUpload: string | null, lastDownload: string | null): Promise<void> {
  local.lastUpload = lastUpload;
  local.lastDownload = lastDownload;
  await writeLocal(app.userFolder, local);
}

function report(settings: SyncSettings, summary: Omit<Parameters<typeof showSummary>[0], 'quiet' | 'location' | 'folder'>): void {
  showSummary({ ...summary, quiet: settings.quietSync, location: settings.location, folder: settings.folder });
}

async function savedToken(app: App): Promise<string> {
  const token = await getToken(app.context);
  return token && isPlausibleToken(token) ? token : '';
}

async function loadLocal(app: App): Promise<LocalSettings> {
  const { settings, changed } = await readLocal(app.userFolder);
  if (changed) await writeLocal(app.userFolder, settings);
  return settings;
}

async function chooseLocation(): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Gist', location: 'gist' as const, description: 'GitHub Gist' },
      { label: 'Local Folder', location: 'folder' as const, description: 'A folder on this computer' },
    ],
    { title: 'Sync Location', ignoreFocusOut: true }
  );
  if (!picked) return;
  await updateSettings({ location: picked.location });
}

async function selectFolder(app: App): Promise<void> {
  const selected = await vscode.window.showOpenDialog({
    title: 'Sync Folder',
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Select Local Folder',
  });
  if (!selected?.[0]) return;
  const folder = selected[0].fsPath;
  if (!folderIsSafe(app.userFolder, folder)) {
    void vscode.window.showErrorMessage('Choose a folder outside the User folder.');
    return;
  }
  await updateSettings({ location: 'folder', folder });
}

async function chooseGist(app: App): Promise<void> {
  const settings = readSettings();
  const token = await savedToken(app);
  try {
    await chooseGistList(app, settings, token);
  } catch (error) {
    void vscode.window.showErrorMessage(githubErrorMessage(error, token));
  }
}

async function chooseGistList(app: App, settings: SyncSettings, token: string): Promise<void> {
  const picks: Array<vscode.QuickPickItem & { id: string }> = [{ label: 'Enter a Gist id', id: '' }];
  if (token) {
    const client = await createClient(token, settings.githubEnterpriseUrl, proxyUrl());
    const gists = await client.listGists();
    picks.push(...gists.map((gist) => ({
      label: gist.description,
      description: gist.id,
      detail: gist.public ? 'Public' : 'Secret',
      id: gist.id,
    })));
  }
  const picked = await vscode.window.showQuickPick(picks, { title: 'Choose Gist', ignoreFocusOut: true });
  if (!picked) return;
  const entered = picked.id || await vscode.window.showInputBox({
    title: 'Gist id',
    prompt: 'Paste a Gist id or a https Gist URL.',
    ignoreFocusOut: true,
  });
  if (!entered) return;
  const id = parseGistId(entered);
  if (!id) {
    void vscode.window.showErrorMessage('That is not a GitHub Gist id.');
    return;
  }
  await updateSettings({ gist: id, downloadPublicGist: false, location: 'gist' });
}

async function editLocal(app: App): Promise<void> {
  const { settings } = await readLocal(app.userFolder);
  await writeLocal(app.userFolder, settings);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(localSettingsPath(app.userFolder)));
  await vscode.window.showTextDocument(document);
}

async function downloadPublic(app: App): Promise<void> {
  const entered = await vscode.window.showInputBox({
    title: 'Public Gist',
    prompt: 'Paste the public Gist id or URL.',
    ignoreFocusOut: true,
  });
  if (!entered) return;
  const id = parseGistId(entered);
  if (!id) {
    void vscode.window.showErrorMessage('That is not a GitHub Gist id.');
    return;
  }
  await updateSettings({ gist: id, downloadPublicGist: true, location: 'gist' });
  await download(app, { extensions: true });
}

async function sharePublic(app: App): Promise<void> {
  const answer = await vscode.window.showWarningMessage(
    'This uploads your settings to a new public Gist. The current Gist is left unchanged.',
    { modal: true },
    'Upload'
  );
  if (answer !== 'Upload') return;
  await updateSettings({ gist: '', downloadPublicGist: false, location: 'gist' });
  await upload(app, { publicGist: true });
}

async function addCustomFile(app: App): Promise<void> {
  const location = readSettings().location;
  const entered = await vscode.window.showInputBox({
    title: 'Custom file',
    prompt: location === 'folder'
      ? 'Absolute path of a file to include in the sync folder.'
      : 'Absolute path of a file to include in the Gist.',
    ignoreFocusOut: true,
  });
  if (!entered) return;
  const target = customFileTarget(entered);
  if (!target || !(await fileExists(target))) {
    void vscode.window.showErrorMessage('That file does not exist.');
    return;
  }
  const name = basename(target);
  const local = await loadLocal(app);
  local.customFiles[name] = target;
  await writeLocal(app.userFolder, local);
  void vscode.window.showInformationMessage(`Settings Sync will include ${name}.`);
}

async function importCustomFile(app: App): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    void vscode.window.showInformationMessage('Open a folder before importing a custom file.');
    return;
  }
  const settings = readSettings();
  let gist: RemoteGist;
  if (settings.location === 'folder') {
    if (!folderIsSafe(app.userFolder, settings.folder)) {
      void vscode.window.showInformationMessage('Choose a sync folder first.');
      return;
    }
    try {
      gist = await readBundle(settings.folder);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not read the sync folder.';
      void vscode.window.showErrorMessage(message);
      return;
    }
  } else {
    const gistId = parseGistId(settings.gist);
    if (!gistId) {
      void vscode.window.showInformationMessage('Set a Gist id first.');
      return;
    }
    const token = (await savedToken(app)) || '';
    if (!token && !settings.downloadPublicGist) {
      void vscode.window.showInformationMessage('Set a GitHub token first.');
      return;
    }
    try {
      const client = await createClient(token, settings.githubEnterpriseUrl, proxyUrl());
      gist = await client.getGist(gistId);
    } catch (error) {
      void vscode.window.showErrorMessage(githubErrorMessage(error, token));
      return;
    }
  }
  const files = Object.entries(gist.files).flatMap(([gistName, file]) => {
    if (!gistName.startsWith(CUSTOM_PREFIX)) return [];
    return [{ label: gistName.slice(CUSTOM_PREFIX.length), content: file.content }];
  });
  const picked = await vscode.window.showQuickPick(files, { title: 'Import custom file', ignoreFocusOut: true });
  if (!picked) return;
  const target = workspaceFileTarget(folder, picked.label);
  if (!target) {
    void vscode.window.showErrorMessage('That file name is not safe to write.');
    return;
  }
  await writeExact(target, picked.content);
  void vscode.window.showInformationMessage(`Wrote ${target}.`);
}

async function promptCap(
  app: App,
  key: 'chatCount' | 'messageCount',
  title: string,
  prompt: string,
  range: { min: number; max: number; fallback: number }
): Promise<void> {
  const local = await loadLocal(app);
  const entered = await vscode.window.showInputBox({
    title,
    prompt: `${prompt} Enter a whole number from ${range.min} to ${range.max}.`,
    value: String(local[key]),
    ignoreFocusOut: true,
    validateInput: (value) => {
      const parsed = Number(value.trim());
      if (!Number.isInteger(parsed) || parsed < range.min || parsed > range.max) {
        return `Enter a whole number from ${range.min} to ${range.max}.`;
      }
      return undefined;
    },
  });
  if (entered === undefined) return;
  const next = clampCount(Number(entered.trim()), range);
  if (next !== Number(entered.trim())) return;
  local[key] = next;
  await writeLocal(app.userFolder, local);
  void vscode.window.showInformationMessage(`${title} is ${next}.`);
}

async function toggle(app: App, key: ToggleKey, on: string, off: string): Promise<void> {
  const settings = readSettings();
  const next = !settings[key];
  await updateSettings({ [key]: next });
  void vscode.window.showInformationMessage(next ? on : off);
  if (key === 'autoUpload' || key === 'autoDownload' || key === 'syncChats') armWatchers(app);
}

function lockFile(app: App): string {
  return join(app.context.globalStorageUri.fsPath, 'sync.lock');
}
