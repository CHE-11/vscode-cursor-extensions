import * as vscode from 'vscode';
import { log } from './logger';

export const TASKS_FILE_GLOB = '**/.vscode/tasks.json';
const DEFAULT_EXCLUDE = '**/{node_modules,out,dist,builds,.git}/**';
const RELOAD_DEBOUNCE_MS = 300;

function getExcludeGlob(): string {
  const exclude = vscode.workspace.getConfiguration('taskManager').get<string>('exclude');
  return exclude && exclude.trim() ? exclude.trim() : DEFAULT_EXCLUDE;
}

/**
 * Finds every `.vscode/tasks.json` in all workspace folders, including nested project folders.
 */
export async function findTasksFiles(): Promise<vscode.Uri[]> {
  if (!vscode.workspace.workspaceFolders?.length) {
    return [];
  }
  const started = Date.now();
  const files = await vscode.workspace.findFiles(TASKS_FILE_GLOB, getExcludeGlob());
  log(`Found ${files.length} tasks.json file(s) in ${Date.now() - started}ms`);
  return files;
}

export interface TasksFileChange {
  /** True when a tasks.json was created or deleted, so the file list must be rebuilt. */
  structural: boolean;
  changed: vscode.Uri[];
}

/**
 * Watches all nested tasks.json files and reports batched changes after a short debounce.
 */
export function watchTasksFiles(onChange: (change: TasksFileChange) => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(TASKS_FILE_GLOB);
  let timer: NodeJS.Timeout | undefined;
  let structural = false;
  const changed = new Map<string, vscode.Uri>();

  const schedule = (uri: vscode.Uri, isStructural: boolean) => {
    if (/[\\/]node_modules[\\/]/.test(uri.fsPath)) {
      return;
    }
    structural = structural || isStructural;
    changed.set(uri.toString(), uri);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      const change: TasksFileChange = { structural, changed: [...changed.values()] };
      structural = false;
      changed.clear();
      onChange(change);
    }, RELOAD_DEBOUNCE_MS);
  };

  return vscode.Disposable.from(
    watcher,
    watcher.onDidCreate((uri) => schedule(uri, true)),
    watcher.onDidDelete((uri) => schedule(uri, true)),
    watcher.onDidChange((uri) => schedule(uri, false)),
    new vscode.Disposable(() => {
      if (timer) {
        clearTimeout(timer);
      }
    })
  );
}
