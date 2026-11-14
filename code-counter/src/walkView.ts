import * as vscode from 'vscode';
import { canonicalFileType, canonicalGlob, splitFileTypeInput } from './walk';

const SECTION = 'code-counter';

export type WalkListKey = 'fileTypes' | 'include' | 'exclude';
export type WalkToggleKey = 'useGitignore' | 'useFilesExclude' | 'ignoreUnsupportedFile';

const listMeta: Record<WalkListKey, { label: string; icon: string; prompt: string; placeholder: string }> = {
  fileTypes: {
    label: 'File types',
    icon: 'symbol-file',
    prompt: 'Extensions to walk, such as .ts or .tsx. .ts also matches file.d.ts. Empty walks every included file.',
    placeholder: '.ts',
  },
  include: {
    label: 'Include',
    icon: 'filter',
    prompt: 'Glob of files or folders to walk. **/* walks everything under the directory.',
    placeholder: 'src/**',
  },
  exclude: {
    label: 'Exclude',
    icon: 'circle-slash',
    prompt: 'Glob of files or folders to skip.',
    placeholder: '**/dist/**',
  },
};

const toggleMeta: Record<WalkToggleKey, { label: string; on: string; off: string; tooltipOn: string; tooltipOff: string }> = {
  useGitignore: {
    label: 'Use .gitignore',
    on: 'On',
    off: 'Off',
    tooltipOn: 'Skip files ignored by .gitignore.',
    tooltipOff: 'Ignored files are walked.',
  },
  useFilesExclude: {
    label: 'Use files.exclude',
    on: 'On',
    off: 'Off',
    tooltipOn: 'Also skip files matched by files.exclude.',
    tooltipOff: 'Files hidden by files.exclude are walked.',
  },
  ignoreUnsupportedFile: {
    label: 'Skip unrecognized',
    on: 'On',
    off: 'Off',
    tooltipOn: 'Skip files whose language is not recognized.',
    tooltipOff: 'Unrecognized files are included and marked unsupported.',
  },
};

const defaults: Record<WalkListKey, string[]> = {
  fileTypes: [],
  include: ['**/*'],
  exclude: ['**/.gitignore', '**/.vscode/**', '**/node_modules/**'],
};

const toggleDefaults: Record<WalkToggleKey, boolean> = {
  useGitignore: true,
  useFilesExclude: true,
  ignoreUnsupportedFile: true,
};

export class WalkGroupNode extends vscode.TreeItem {
  constructor(
    readonly listKey: WalkListKey,
    description: string,
  ) {
    const meta = listMeta[listKey];
    super(meta.label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `walk:${listKey}`;
    this.contextValue = 'walkGroup';
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(meta.icon);
    this.tooltip = meta.prompt;
  }
}

export class WalkPatternNode extends vscode.TreeItem {
  constructor(
    readonly listKey: WalkListKey,
    readonly pattern: string,
    readonly index: number,
  ) {
    super(pattern, vscode.TreeItemCollapsibleState.None);
    this.id = `walk:${listKey}:${index}:${pattern}`;
    this.contextValue = 'walkPattern';
    this.iconPath = new vscode.ThemeIcon(listKey === 'fileTypes' ? 'symbol-file' : 'regex');
    this.tooltip = listKey === 'fileTypes'
      ? 'Files with this extension are walked. Click to edit.'
      : 'Click to edit this glob.';
    this.command = {
      command: 'code-counter.editWalkEntry',
      title: 'Edit',
      arguments: [this],
    };
  }
}

export class WalkPlaceholderNode extends vscode.TreeItem {
  constructor() {
    super('All types', vscode.TreeItemCollapsibleState.None);
    this.id = 'walk:fileTypes:all';
    this.contextValue = 'walkPlaceholder';
    this.description = 'Add a type to limit';
    this.iconPath = new vscode.ThemeIcon('list-selection');
    this.tooltip = 'Every included file is walked. Add an extension to limit the walk.';
    this.command = {
      command: 'code-counter.addWalkEntry',
      title: 'Add file type',
      arguments: [new WalkGroupNode('fileTypes', '')],
    };
  }
}

export class WalkToggleNode extends vscode.TreeItem {
  constructor(readonly setting: WalkToggleKey) {
    const meta = toggleMeta[setting];
    const enabled = readToggle(setting);
    super(meta.label, vscode.TreeItemCollapsibleState.None);
    this.id = `walk:${setting}`;
    this.contextValue = 'walkToggle';
    this.description = enabled ? meta.on : meta.off;
    this.tooltip = enabled ? meta.tooltipOn : meta.tooltipOff;
    this.iconPath = new vscode.ThemeIcon(enabled ? 'pass-filled' : 'circle-large');
    this.command = {
      command: 'code-counter.toggleWalkOption',
      title: meta.label,
      arguments: [this],
    };
  }
}

export type WalkNode = WalkGroupNode | WalkPatternNode | WalkPlaceholderNode | WalkToggleNode;

export function walkSummary(): string {
  const types = readList('fileTypes');
  const include = readList('include');
  const typeText = types.length > 0 ? types.join(' ') : 'all types';
  const includeText = include.length === 1 ? include[0] : `${include.length} globs`;
  return `${typeText} · ${includeText}`;
}

export function walkRootChildren(): WalkNode[] {
  const types = readList('fileTypes');
  const include = readList('include');
  const exclude = readList('exclude');
  return [
    new WalkGroupNode('fileTypes', types.length === 0 ? 'All' : types.length === 1 ? types[0] : `${types.length} types`),
    new WalkGroupNode('include', include.length === 1 ? include[0] : `${include.length} globs`),
    new WalkGroupNode('exclude', exclude.length === 0 ? 'None' : exclude.length === 1 ? exclude[0] : `${exclude.length} globs`),
    new WalkToggleNode('useGitignore'),
    new WalkToggleNode('useFilesExclude'),
    new WalkToggleNode('ignoreUnsupportedFile'),
  ];
}

export function walkGroupChildren(group: WalkGroupNode): WalkNode[] {
  const patterns = readList(group.listKey);
  if (group.listKey === 'fileTypes' && patterns.length === 0) {
    return [new WalkPlaceholderNode()];
  }
  return patterns.map((pattern, index) => new WalkPatternNode(group.listKey, pattern, index));
}

export async function addWalkEntry(node?: unknown): Promise<void> {
  const listKey = await pickList(node, 'Add to the walk');
  if (!listKey) {
    return;
  }
  const value = await ask(listKey);
  if (value === undefined) {
    return;
  }
  const additions = entriesFromInput(listKey, value);
  if (!additions) {
    return;
  }
  const current = readList(listKey);
  const next = [...current];
  for (const entry of additions) {
    if (!contains(listKey, next, entry)) {
      next.push(entry);
    }
  }
  if (next.length === current.length) {
    void vscode.window.showInformationMessage('That entry is already in the list.');
    return;
  }
  await writeList(listKey, next);
}

export async function editWalkEntry(node?: unknown): Promise<void> {
  const pattern = node instanceof WalkPatternNode
    ? node
    : await pickPattern('Edit a walk entry');
  if (!pattern) {
    return;
  }
  const value = await ask(pattern.listKey, pattern.pattern);
  if (value === undefined) {
    return;
  }
  const replacements = entriesFromInput(pattern.listKey, value);
  if (!replacements) {
    return;
  }
  const current = readList(pattern.listKey);
  const next = current.filter((_, index) => index !== pattern.index);
  const insertAt = Math.min(pattern.index, next.length);
  const unique = replacements.filter((entry) => !contains(pattern.listKey, next, entry));
  next.splice(insertAt, 0, ...unique);
  if (sameList(pattern.listKey, current, next)) {
    return;
  }
  if (pattern.listKey === 'include' && next.length === 0) {
    void vscode.window.showInformationMessage('Include needs a glob. Restored **/*.');
    await writeList('include', ['**/*']);
    return;
  }
  await writeList(pattern.listKey, next);
}

export async function deleteWalkEntry(node?: unknown): Promise<void> {
  const pattern = node instanceof WalkPatternNode
    ? node
    : await pickPattern('Remove a walk entry');
  if (!pattern) {
    return;
  }
  const current = readList(pattern.listKey);
  const next = current.filter((_, index) => index !== pattern.index);
  if (pattern.listKey === 'include' && next.length === 0) {
    void vscode.window.showInformationMessage('Include needs a glob. Restored **/*.');
    await writeList('include', ['**/*']);
    return;
  }
  await writeList(pattern.listKey, next);
}

export async function toggleWalkOption(node?: unknown): Promise<void> {
  const setting = node instanceof WalkToggleNode
    ? node.setting
    : await pickToggle();
  if (!setting) {
    return;
  }
  const config = vscode.workspace.getConfiguration(SECTION);
  await config.update(setting, !readToggle(setting), writeTarget());
}

function readList(key: WalkListKey): string[] {
  const value = vscode.workspace.getConfiguration(SECTION).get<string[]>(key, defaults[key]);
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function readToggle(key: WalkToggleKey): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>(key, toggleDefaults[key]);
}

function writeTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

async function writeList(key: WalkListKey, entries: string[]): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  try {
    await config.update(key, entries, writeTarget());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Could not save the walk settings. ${message}`);
  }
}

function entriesFromInput(key: WalkListKey, input: string): string[] | undefined {
  if (key === 'fileTypes') {
    const parts = splitFileTypeInput(input);
    if (parts.length === 0) {
      void vscode.window.showWarningMessage('Enter an extension, such as .ts.');
      return undefined;
    }
    const types = parts.map(canonicalFileType);
    if (types.some((type) => type === undefined)) {
      void vscode.window.showWarningMessage('Enter an extension such as .ts. Put folder globs under Include.');
      return undefined;
    }
    return types.filter((type): type is string => type !== undefined);
  }
  const glob = canonicalGlob(input);
  if (!glob) {
    void vscode.window.showWarningMessage('Enter a glob.');
    return undefined;
  }
  return [glob];
}

function contains(key: WalkListKey, entries: string[], entry: string): boolean {
  if (key === 'fileTypes') {
    return entries.some((item) => item.toLowerCase() === entry.toLowerCase());
  }
  return entries.includes(entry);
}

function sameList(key: WalkListKey, left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => key === 'fileTypes'
    ? entry.toLowerCase() === right[index].toLowerCase()
    : entry === right[index]);
}

async function ask(key: WalkListKey, value?: string): Promise<string | undefined> {
  const meta = listMeta[key];
  return vscode.window.showInputBox({
    title: meta.label,
    prompt: meta.prompt,
    placeHolder: meta.placeholder,
    value,
    ignoreFocusOut: true,
  });
}

async function pickList(node: unknown, placeHolder: string): Promise<WalkListKey | undefined> {
  if (node instanceof WalkGroupNode) {
    return node.listKey;
  }
  if (node instanceof WalkPlaceholderNode) {
    return 'fileTypes';
  }
  const picked = await vscode.window.showQuickPick(
    (Object.keys(listMeta) as WalkListKey[]).map((key) => ({
      label: listMeta[key].label,
      detail: listMeta[key].prompt,
      key,
    })),
    { placeHolder, ignoreFocusOut: true },
  );
  return picked?.key;
}

async function pickPattern(placeHolder: string): Promise<WalkPatternNode | undefined> {
  const items = (Object.keys(listMeta) as WalkListKey[]).flatMap((key) => (
    readList(key).map((pattern, index) => ({
      label: pattern,
      description: listMeta[key].label,
      node: new WalkPatternNode(key, pattern, index),
    }))
  ));
  if (items.length === 0) {
    void vscode.window.showInformationMessage('The walk lists are empty.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, { placeHolder, ignoreFocusOut: true });
  return picked?.node;
}

async function pickToggle(): Promise<WalkToggleKey | undefined> {
  const picked = await vscode.window.showQuickPick(
    (Object.keys(toggleMeta) as WalkToggleKey[]).map((key) => ({
      label: toggleMeta[key].label,
      description: readToggle(key) ? toggleMeta[key].on : toggleMeta[key].off,
      key,
    })),
    { placeHolder: 'Walk option', ignoreFocusOut: true },
  );
  return picked?.key;
}
