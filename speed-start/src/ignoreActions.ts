import path from 'path';
import * as vscode from 'vscode';
import { isPathItem, type PathItem } from './heavyTree';
import { appendIgnorePatterns, readTextFile } from './ignoreFile';
import { hasGenericChoice, patternChoices, selectPatterns, toExcludeGlob, type PatternStyle, type PatternTarget } from './ignoreMatch';

export interface IgnoreTarget {
  relativePath: string;
  absolutePath: string;
  workspaceFsPath: string;
  workspaceName: string;
  isDirectory: boolean;
  ignored: boolean;
}

export function selectedPaths(arg: unknown, selection: readonly unknown[], includeIgnored: boolean): IgnoreTarget[] {
  const selected = selection.filter(isPathItem).map(toIgnoreTarget);
  const clicked = isPathItem(arg) ? toIgnoreTarget(arg) : undefined;
  const pool =
    clicked && selected.some((item) => samePath(item.absolutePath, clicked.absolutePath)) ? selected : clicked ? [clicked] : selected;
  const filtered = includeIgnored ? pool : pool.filter((item) => !item.ignored);
  const seen = new Set<string>();
  return filtered.filter((item) => {
    const key = normalizeKey(item.absolutePath);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function addToIgnore(targets: readonly IgnoreTarget[], fileName: '.gitignore' | '.cursorignore'): Promise<void> {
  if (targets.length === 0) {
    void vscode.window.showInformationMessage('Select a path in Speed Start first.');
    return;
  }
  const style = await chooseStyle(targets);
  if (!style) {
    return;
  }
  const planned: PlannedIgnore[] = [];
  for (const group of groupByWorkspace(targets)) {
    const folder = folderFor(group.workspaceFsPath);
    if (!folder) {
      continue;
    }
    const existing = await readTextFile(vscode.Uri.joinPath(folder.uri, fileName));
    const patterns = selectPatterns(group.targets.map(asPatternTarget), style, existing);
    if (patterns.length > 0) {
      planned.push({ folder, patterns });
    }
  }
  if (planned.length === 0) {
    void vscode.window.showInformationMessage('Those paths are already ignored.');
    return;
  }
  const preview = planned.flatMap((entry) => entry.patterns.map((pattern) => `${entry.folder.name}: ${pattern}`));
  const message =
    fileName === '.cursorignore'
      ? 'Add these patterns to .cursorignore? Cursor will stop indexing them. Agent, Tab, and @ mentions will also stop reading them.'
      : 'Add these patterns to .gitignore? Cursor skips gitignored paths. Files that are already committed stay tracked.';
  if (!(await confirm(message, preview))) {
    return;
  }
  try {
    for (const entry of planned) {
      await appendIgnorePatterns(vscode.Uri.joinPath(entry.folder.uri, fileName), entry.patterns);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Speed Start could not update ${fileName}. ${errorText(error)}`);
    return;
  }
  const count = planned.reduce((sum, entry) => sum + entry.patterns.length, 0);
  void vscode.window.showInformationMessage(
    `Added ${count} pattern${count === 1 ? '' : 's'} to ${fileName}. Run Reindex from the Command Palette so Cursor drops those paths.`,
  );
}

export async function excludeFromSearchAndWatcher(targets: readonly IgnoreTarget[]): Promise<void> {
  if (targets.length === 0) {
    void vscode.window.showInformationMessage('Select a path in Speed Start first.');
    return;
  }
  const style = await chooseStyle(targets);
  if (!style) {
    return;
  }
  const planned: PlannedIgnore[] = [];
  for (const group of groupByWorkspace(targets)) {
    const folder = folderFor(group.workspaceFsPath);
    if (!folder) {
      continue;
    }
    const globs = selectPatterns(group.targets.map(asPatternTarget), style, '').map(toExcludeGlob).filter(Boolean);
    if (globs.length > 0) {
      planned.push({ folder, patterns: globs });
    }
  }
  if (planned.length === 0) {
    void vscode.window.showInformationMessage('Select a path in Speed Start first.');
    return;
  }
  const preview = planned.flatMap((entry) => entry.patterns.map((pattern) => `${entry.folder.name}: ${pattern}`));
  const confirmed = await confirm(
    'Add these patterns to search.exclude and files.watcherExclude? Editor search and the file watcher will skip them.',
    preview,
  );
  if (!confirmed) {
    return;
  }
  let count = 0;
  try {
    for (const entry of planned) {
      count += await updateExcludes(entry.folder, entry.patterns);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Speed Start could not update search and watcher excludes. ${errorText(error)}`);
    return;
  }
  if (count === 0) {
    void vscode.window.showInformationMessage('Those paths are already excluded from search and the file watcher.');
    return;
  }
  void vscode.window.showInformationMessage(`Updated search and watcher excludes for ${count} pattern${count === 1 ? '' : 's'}.`);
}

export async function copyIgnorePattern(targets: readonly IgnoreTarget[]): Promise<void> {
  if (targets.length === 0) {
    void vscode.window.showInformationMessage('Select a path in Speed Start first.');
    return;
  }
  const lines = targets.flatMap((target) => patternChoices(target.relativePath, target.isDirectory).slice(0, 1));
  await vscode.env.clipboard.writeText(lines.join('\n'));
}

export async function revealTarget(target: IgnoreTarget | undefined): Promise<void> {
  if (!target) {
    void vscode.window.showInformationMessage('Select a path in Speed Start first.');
    return;
  }
  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(target.absolutePath));
}

async function updateExcludes(folder: vscode.WorkspaceFolder, globs: readonly string[]): Promise<number> {
  const files = vscode.workspace.getConfiguration('files', folder.uri);
  const search = vscode.workspace.getConfiguration('search', folder.uri);
  const watcher = { ...(files.inspect<Record<string, boolean>>('watcherExclude')?.workspaceFolderValue ?? {}) };
  const searchExclude = { ...(search.inspect<Record<string, boolean>>('exclude')?.workspaceFolderValue ?? {}) };
  let count = 0;
  for (const glob of globs) {
    const watcherMissing = watcher[glob] !== true;
    const searchMissing = searchExclude[glob] !== true;
    if (!watcherMissing && !searchMissing) {
      continue;
    }
    watcher[glob] = true;
    searchExclude[glob] = true;
    count += 1;
  }
  if (count === 0) {
    return 0;
  }
  await files.update('watcherExclude', watcher, vscode.ConfigurationTarget.WorkspaceFolder);
  await search.update('exclude', searchExclude, vscode.ConfigurationTarget.WorkspaceFolder);
  return count;
}

async function chooseStyle(targets: readonly IgnoreTarget[]): Promise<PatternStyle | undefined> {
  if (!hasGenericChoice(targets)) {
    return 'specific';
  }
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Specific paths', description: 'Ignore only the selected paths', value: 'specific' as const },
      { label: 'Generic folder names', description: 'Use **/name/ for common build folders', value: 'generic' as const },
    ],
    { title: 'Which ignore pattern?', ignoreFocusOut: true },
  );
  return pick?.value;
}

async function confirm(message: string, lines: readonly string[]): Promise<boolean> {
  const shown = lines.slice(0, 12);
  const extra = lines.length > shown.length ? `\n…and ${lines.length - shown.length} more` : '';
  const choice = await vscode.window.showWarningMessage(`${message}\n\n${shown.join('\n')}${extra}`, { modal: true }, 'Add');
  return choice === 'Add';
}

function groupByWorkspace(targets: readonly IgnoreTarget[]): { workspaceFsPath: string; targets: IgnoreTarget[] }[] {
  const groups: { workspaceFsPath: string; targets: IgnoreTarget[] }[] = [];
  for (const target of targets) {
    const existing = groups.find((group) => samePath(group.workspaceFsPath, target.workspaceFsPath));
    if (existing) {
      existing.targets.push(target);
    } else {
      groups.push({ workspaceFsPath: target.workspaceFsPath, targets: [target] });
    }
  }
  return groups;
}

function folderFor(fsPath: string): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.find((folder) => samePath(folder.uri.fsPath, fsPath));
}

function asPatternTarget(target: IgnoreTarget): PatternTarget {
  return { relativePath: target.relativePath, isDirectory: target.isDirectory };
}

function toIgnoreTarget(item: PathItem): IgnoreTarget {
  return {
    relativePath: item.node.relativePath,
    absolutePath: item.node.absolutePath,
    workspaceFsPath: item.node.workspaceFsPath,
    workspaceName: item.node.workspaceName,
    isDirectory: item.node.kind === 'directory',
    ignored: item.node.ignored,
  };
}

function samePath(left: string, right: string): boolean {
  return normalizeKey(left) === normalizeKey(right);
}

function normalizeKey(fsPath: string): string {
  const resolved = path.resolve(fsPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PlannedIgnore {
  folder: vscode.WorkspaceFolder;
  patterns: string[];
}
