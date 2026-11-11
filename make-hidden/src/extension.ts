import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { hide, hideBy, hideMultiple, listHidden, loadExcluded, makeVisible, showAll, showOnly, undo } from './exclude';
import { describeFile, relativeItem, workspaceRoot } from './paths';
import { HiddenItemsView } from './view';
import { deleteWorkspace, listWorkspaces, saveWorkspace, type SavedWorkspace } from './workspaces';

const hideLevelOptions = [
  'From Root',
  'From Current Directory',
  'From Current&Child Directories',
  'From Child Directories',
];

export function activate(context: vscode.ExtensionContext): void {
  const view = new HiddenItemsView(context.extensionUri);
  context.subscriptions.push(
    view,
    vscode.window.registerTreeDataProvider('makeHidden.ViewPane.hiddenItems', view),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('files.exclude')) {
        void refresh(view);
      }
    }),
  );
  void refresh(view);

  register(context, 'make-hidden.hide', async (resource: unknown) => {
    const chosen = requireFile(resource);
    if (!chosen) return;
    await hide(chosen.relativePath);
    await refresh(view);
  });

  register(context, 'make-hidden.hide.multiple', async (resource: unknown) => {
    const chosen = requireFile(resource);
    if (!chosen) return;
    const names = await fs.readdir(chosen.dirName);
    const picked = await vscode.window.showQuickPick(names, {
      placeHolder: 'Choose the items you wish to hide',
      canPickMany: true,
    });
    if (!picked?.length) return;
    await hideMultiple(picked.map((name) => relativeItem(chosen.rootPath, chosen.dirName, name)));
    await refresh(view);
  });

  register(context, 'make-hidden.hide.by', async (resource: unknown) => {
    const chosen = requireFile(resource);
    if (!chosen) return;
    const hideByOptions = [`By Name {${chosen.name}}`, `By Extension {${chosen.extension}}`];
    let hideByIndex = 0;
    if (chosen.extension) {
      const selection = await vscode.window.showQuickPick(hideByOptions);
      if (!selection) return;
      hideByIndex = hideByOptions.indexOf(selection);
    }
    const level = await vscode.window.showQuickPick(hideLevelOptions, {
      placeHolder: hideByOptions[hideByIndex],
    });
    if (!level) return;
    await hideBy(chosen.relativePath, hideByIndex > 0, hideLevelOptions.indexOf(level));
    await refresh(view);
  });

  register(context, 'make-hidden.show.only', async (resource: unknown) => {
    const chosen = requireFile(resource);
    if (!chosen) return;
    await showOnly(chosen.relativePath);
    await refresh(view);
  });

  register(context, 'make-hidden.remove.search', async () => {
    const items = await listHidden();
    if (items.length === 0) {
      void vscode.window.showInformationMessage('No hidden items');
      return;
    }
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Type to quick find' });
    if (!picked) return;
    await makeVisible(picked);
    await refresh(view);
  });

  register(context, 'make-hidden.remove.item', async (pattern: unknown) => {
    if (typeof pattern !== 'string' || !pattern) return;
    await makeVisible(pattern);
    await refresh(view);
  });

  register(context, 'make-hidden.remove.all', async () => {
    await showAll();
    await refresh(view);
  });

  register(context, 'make-hidden.undo', async () => {
    const restored = await undo();
    if (!restored) {
      status('Nothing to undo');
      return;
    }
    await refresh(view);
  });

  register(context, 'make-hidden.workspace', async () => {
    const choice = await vscode.window.showQuickPick(['Create', 'Load', 'Delete'], {
      placeHolder: 'What would you like to do...',
    });
    if (!choice) return;
    await vscode.commands.executeCommand(`make-hidden.workspace.${choice.toLocaleLowerCase()}`);
  });

  register(context, 'make-hidden.workspace.create', async () => {
    const name = await vscode.window.showInputBox({ prompt: 'Enter name' });
    if (!name) return;
    await saveWorkspace(context, name, await listHidden(), null);
    status('Workspace saved');
  });

  register(context, 'make-hidden.workspace.load', async () => {
    const workspace = await pickWorkspace(context);
    if (!workspace) return;
    await loadExcluded(workspace.excludedItems);
    await refresh(view);
    status(`Workspace ${workspace.name} Loaded`);
  });

  register(context, 'make-hidden.workspace.delete', async () => {
    const workspace = await pickWorkspace(context);
    if (!workspace) return;
    await deleteWorkspace(context, workspace.id);
    status('Deleted Workspace');
  });
}

export function deactivate(): void {}

function register(
  context: vscode.ExtensionContext,
  id: string,
  handler: (...args: unknown[]) => Promise<void>,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(id, async (...args: unknown[]) => {
      try {
        await handler(...args);
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : 'Sorry, something went wrong!';
        void vscode.window.showErrorMessage(message);
      }
    }),
  );
}

function requireFile(resource: unknown): ReturnType<typeof describeFile> | undefined {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showErrorMessage('Open a folder before hiding files.');
    return undefined;
  }
  const fsPath = resource instanceof vscode.Uri ? resource.fsPath : undefined;
  if (!fsPath) {
    void vscode.window.showErrorMessage('Choose a file or folder in the explorer.');
    return undefined;
  }
  const described = describeFile(fsPath);
  if (!described.relativePath || described.relativePath === '.') {
    void vscode.window.showErrorMessage('Choose a file or folder inside the workspace.');
    return undefined;
  }
  return described;
}

async function pickWorkspace(context: vscode.ExtensionContext): Promise<SavedWorkspace | undefined> {
  const workspaces = listWorkspaces(context, [null, workspaceRoot()]);
  if (workspaces.length === 0) {
    void vscode.window.showInformationMessage('No workspaces');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    workspaces.map((workspace) => workspace.name || 'No name'),
  );
  if (!picked) return undefined;
  return workspaces.find((workspace) => (workspace.name || 'No name') === picked);
}

async function refresh(view: HiddenItemsView): Promise<void> {
  view.update(await listHidden());
}

function status(message: string): void {
  void vscode.window.setStatusBarMessage(message, 4000);
}
