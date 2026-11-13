import * as vscode from 'vscode';
import type { App } from './app';
import { resolveUserFolder } from './safe';
import { SettingsSyncView } from './sidebar';
import { bootstrap, download, how, openOptions, reset, runOption, upload } from './sync';
import { migrateToken } from './token';
import { stopWatching } from './watcher';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let userFolder: string;
  try {
    userFolder = resolveUserFolder(context.globalStorageUri.fsPath, process.env.VSCODE_PORTABLE);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not resolve the User folder.';
    void vscode.window.showErrorMessage(message);
    return;
  }

  const app: App = { context, userFolder };
  const sidebar = new SettingsSyncView(app);
  const refreshSidebar = () => sidebar.refresh();
  context.subscriptions.push(
    { dispose: stopWatching },
    vscode.window.registerTreeDataProvider('settings-sync.sidebar', sidebar),
    vscode.commands.registerCommand('settings-sync.upload', async () => {
      await upload(app);
      refreshSidebar();
    }),
    vscode.commands.registerCommand('settings-sync.download', async () => {
      await download(app, { extensions: true });
      refreshSidebar();
    }),
    vscode.commands.registerCommand('settings-sync.reset', async () => {
      await reset(app);
      refreshSidebar();
    }),
    vscode.commands.registerCommand('settings-sync.how', () => how()),
    vscode.commands.registerCommand('settings-sync.options', () => openOptions(app)),
    vscode.commands.registerCommand('settings-sync.runOption', async (id: string) => {
      await runOption(app, id as Parameters<typeof runOption>[1]);
      refreshSidebar();
    }),
    vscode.commands.registerCommand('settings-sync.refresh', refreshSidebar),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('settings-sync')) refreshSidebar();
    })
  );

  try {
    await migrateToken(app);
    await bootstrap(app);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Settings Sync could not start.';
    void vscode.window.showErrorMessage(message);
  }
}

export function deactivate(): void {
  stopWatching();
}
