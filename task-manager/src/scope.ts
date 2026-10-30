import * as vscode from 'vscode';
import * as path from 'path';
import type { ProjectTasks, ScopeMode } from '../types/tasks';

const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';

export function normalizePath(fsPath: string): string {
  const resolved = path.resolve(fsPath);
  return isCaseInsensitive ? resolved.toLowerCase() : resolved;
}

function isInside(folder: string, file: string): boolean {
  const normalizedFolder = normalizePath(folder);
  const normalizedFile = normalizePath(file);
  if (normalizedFile === normalizedFolder) {
    return true;
  }
  const prefix = normalizedFolder.endsWith(path.sep) ? normalizedFolder : normalizedFolder + path.sep;
  return normalizedFile.startsWith(prefix);
}

export interface TaskScope {
  /** Projects whose tasks are visible. */
  projects: ProjectTasks[];
  /** The nested project that owns the active file, if any. */
  activeProject?: ProjectTasks;
  isAll: boolean;
}

/**
 * Picks the projects to show for the active file. Inside a nested project only that project's
 * tasks are shown; at a workspace root (or with no file open) every project is shown.
 */
export function getScope(projects: readonly ProjectTasks[], activeUri: vscode.Uri | undefined, mode: ScopeMode): TaskScope {
  const all: TaskScope = { projects: [...projects], isAll: true };
  if (mode === 'all' || !activeUri || activeUri.scheme !== 'file') {
    return all;
  }

  let closest: ProjectTasks | undefined;
  for (const entry of projects) {
    if (!isInside(entry.project.folderUri.fsPath, activeUri.fsPath)) {
      continue;
    }
    if (!closest || entry.project.folderUri.fsPath.length > closest.project.folderUri.fsPath.length) {
      closest = entry;
    }
  }

  if (closest && closest.project.relativePath) {
    return { projects: [closest], activeProject: closest, isAll: false };
  }

  // The file is at a workspace folder root (outside every nested project): show that folder's
  // projects, or everything when the file is not inside any workspace folder.
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeUri);
  if (workspaceFolder && (vscode.workspace.workspaceFolders?.length ?? 0) > 1) {
    const inFolder = projects.filter((entry) => entry.project.workspaceFolder.index === workspaceFolder.index);
    if (inFolder.length > 0) {
      return { projects: inFolder, isAll: true };
    }
  }
  return all;
}

function getTabUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputNotebook) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputTextDiff || input instanceof vscode.TabInputNotebookDiff) {
    return input.modified;
  }
  return undefined;
}

/**
 * Tracks the file the user is working in. Focusing a terminal, output panel or webview keeps
 * the previous file so the status bar does not flicker; closing every editor clears it.
 */
export class ActiveFileTracker implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri | undefined>();
  readonly onDidChange = this.changeEmitter.event;
  private current: vscode.Uri | undefined;
  private readonly disposables: vscode.Disposable[];

  constructor() {
    this.current = this.compute(undefined);
    this.disposables = [
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      vscode.window.tabGroups.onDidChangeTabs(() => this.update()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.update()),
    ];
  }

  get uri(): vscode.Uri | undefined {
    return this.current;
  }

  private compute(previous: vscode.Uri | undefined): vscode.Uri | undefined {
    const editorUri = vscode.window.activeTextEditor?.document.uri;
    if (editorUri?.scheme === 'file') {
      return editorUri;
    }
    const tabUri = getTabUri(vscode.window.tabGroups.activeTabGroup.activeTab);
    if (tabUri?.scheme === 'file') {
      return tabUri;
    }
    const hasOpenTabs = vscode.window.tabGroups.all.some((group) => group.tabs.length > 0);
    return hasOpenTabs ? previous : undefined;
  }

  private update(): void {
    const next = this.compute(this.current);
    if (next?.toString() !== this.current?.toString()) {
      this.current = next;
      this.changeEmitter.fire(next);
    }
  }

  dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.changeEmitter.dispose();
  }
}
