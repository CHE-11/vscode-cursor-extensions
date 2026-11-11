import * as vscode from 'vscode';
import { asMap, mapHasKey, scopeMap, scopeRaw, settingName, type ProgramKind, type SettingInspection } from './settings';

type MapKind = Exclude<ProgramKind, 'custom'>;

export class GroupItem extends vscode.TreeItem {
  constructor(label: string, readonly kind: MapKind) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `group:${kind}`;
    this.contextValue = 'group';
    this.iconPath = new vscode.ThemeIcon(iconFor(kind));
  }
}

export class ProgramItem extends vscode.TreeItem {
  constructor(
    readonly kind: ProgramKind,
    readonly name: string,
    readonly commandText: string,
    readonly overridden: boolean,
    readonly hasDefault: boolean,
  ) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.id = `${kind}:${name}`;
    this.contextValue = overridden ? 'programOverridden' : 'program';
    this.description = overridden ? `${commandText} · edited` : commandText;
    this.iconPath = new vscode.ThemeIcon(
      iconFor(kind),
      overridden ? new vscode.ThemeColor('charts.yellow') : undefined,
    );
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(overridden ? 'Edited program\n\n' : 'Default program\n\n');
    tooltip.appendCodeblock(commandText, 'shellscript');
    this.tooltip = tooltip;
  }
}

type TreeNode = GroupItem | ProgramItem;

export class ProgramsTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private readonly changes = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.changes.event;
  private shownScope: string | undefined;

  refresh(): void {
    this.changes.fire(undefined);
  }

  refreshForActiveEditor(): void {
    const next = scopeId();
    if (next === this.shownScope) {
      return;
    }
    this.shownScope = next;
    this.refresh();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    const config = configuration();
    if (!element) {
      return [
        new GroupItem('Languages', 'language'),
        new GroupItem('Extensions', 'extension'),
        new GroupItem('Globs', 'glob'),
        this.customItem(config),
      ];
    }
    if (element instanceof GroupItem) {
      return this.mapRows(element.kind, config);
    }
    return [];
  }

  dispose(): void {
    this.changes.dispose();
  }

  async edit(item?: ProgramItem): Promise<void> {
    const target = item instanceof ProgramItem ? item : await this.pickProgram('Select a program to edit');
    if (!target) {
      return;
    }
    const value = await vscode.window.showInputBox({
      title: `Program for ${target.name}`,
      value: target.commandText,
      ignoreFocusOut: true,
      prompt: 'Placeholders: $fullFileName, $fileName, $fileNameWithoutExt, $dir, $dirWithoutTrailingSlash, $workspaceRoot, $driveLetter, $pythonPath',
    });
    if (value === undefined) {
      return;
    }
    if (!value.trim()) {
      void vscode.window.showWarningMessage('Enter a command, or reset the program to use the default.');
      return;
    }
    await this.write(target.kind, target.name, value);
  }

  async add(): Promise<void> {
    const kindPick = await vscode.window.showQuickPick<vscode.QuickPickItem & { programKind: MapKind }>(
      [
        { label: 'Language', description: 'A language id, such as python', programKind: 'language' },
        { label: 'File extension', description: 'Including the dot, such as .py', programKind: 'extension' },
        { label: 'Glob', description: 'A file name pattern, such as *.test.js', programKind: 'glob' },
      ],
      { placeHolder: 'Kind of program', ignoreFocusOut: true },
    );
    if (!kindPick) {
      return;
    }
    const name = await vscode.window.showInputBox({
      title: kindPick.label,
      ignoreFocusOut: true,
      prompt: kindPick.description,
    });
    if (name === undefined) {
      return;
    }
    const key = name.trim();
    if (!validKey(kindPick.programKind, key)) {
      return;
    }
    const command = await vscode.window.showInputBox({
      title: `Program for ${key}`,
      ignoreFocusOut: true,
      prompt: 'Command to run. Use $fullFileName when the command also uses another placeholder.',
      placeHolder: 'node',
    });
    if (command === undefined) {
      return;
    }
    if (!command.trim()) {
      void vscode.window.showWarningMessage('Enter a command for the program.');
      return;
    }
    await this.write(kindPick.programKind, key, command);
  }

  async reset(item?: ProgramItem): Promise<void> {
    const target = item instanceof ProgramItem ? item : await this.pickProgram('Select a program to reset', true);
    if (!target) {
      return;
    }
    const cleared = await this.clear(target.kind, target.name);
    if (cleared === 'missing') {
      void vscode.window.showInformationMessage('Already using the default program.');
    }
  }

  async delete(item?: ProgramItem): Promise<void> {
    const target = item instanceof ProgramItem ? item : await this.pickProgram('Select a program to delete', true);
    if (!target) {
      return;
    }
    if (!target.overridden) {
      void vscode.window.showInformationMessage('Already using the default program.');
      return;
    }
    if (!target.hasDefault) {
      const answer = await vscode.window.showWarningMessage(`Remove the program for ${target.name}?`, { modal: true }, 'Remove');
      if (answer !== 'Remove') {
        return;
      }
    }
    await this.clear(target.kind, target.name);
  }

  private customItem(config: vscode.WorkspaceConfiguration): ProgramItem {
    const inspected = config.inspect<string>('customCommand');
    const overridden = inspected?.workspaceFolderValue !== undefined
      || inspected?.workspaceValue !== undefined
      || inspected?.globalValue !== undefined;
    return new ProgramItem(
      'custom',
      'Custom command',
      config.get<string>('customCommand', 'echo Hello'),
      overridden,
      inspected?.defaultValue !== undefined,
    );
  }

  private mapRows(kind: MapKind, config: vscode.WorkspaceConfiguration): ProgramItem[] {
    const key = settingName(kind);
    const merged = asMap(config.get(key));
    const inspected = config.inspect<Record<string, string>>(key);
    const defaults = asMap(inspected?.defaultValue);
    return Object.keys(merged)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => new ProgramItem(
        kind,
        name,
        merged[name] ?? '',
        isOverridden(inspected, name),
        Object.prototype.hasOwnProperty.call(defaults, name),
      ));
  }

  private programs(onlyOverridden: boolean): ProgramItem[] {
    const config = configuration();
    const items = [
      ...this.mapRows('language', config),
      ...this.mapRows('extension', config),
      ...this.mapRows('glob', config),
      this.customItem(config),
    ];
    return onlyOverridden ? items.filter((item) => item.overridden) : items;
  }

  private async pickProgram(placeHolder: string, onlyOverridden = false): Promise<ProgramItem | undefined> {
    const items = this.programs(onlyOverridden);
    if (items.length === 0) {
      void vscode.window.showInformationMessage(onlyOverridden ? 'No edited programs.' : 'No programs are defined.');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      items.map((item) => ({
        label: item.name,
        description: item.commandText,
        item,
      })),
      { placeHolder },
    );
    return picked?.item;
  }

  private async write(kind: ProgramKind, name: string, value: string): Promise<void> {
    const { config, target } = writeTarget();
    try {
      if (kind === 'custom') {
        await config.update('customCommand', value, target);
      } else {
        const key = settingName(kind);
        const current = scopeMap(config.inspect<Record<string, string>>(key), target) ?? {};
        await config.update(key, { ...current, [name]: value }, target);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Could not save the program. ${message}`);
      return;
    }
    this.refresh();
  }

  private async clear(kind: ProgramKind, name: string): Promise<'cleared' | 'missing' | 'failed'> {
    try {
      const changed = kind === 'custom'
        ? await clearString('customCommand')
        : await clearMapKey(settingName(kind), name);
      return changed ? 'cleared' : 'missing';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Could not reset the program. ${message}`);
      return 'failed';
    } finally {
      this.refresh();
    }
  }
}

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('codeRunner', resourceUri());
}

function scopeId(): string {
  const active = vscode.window.activeTextEditor?.document.uri;
  const folder = active ? vscode.workspace.getWorkspaceFolder(active) : undefined;
  return (folder ?? vscode.workspace.workspaceFolders?.[0])?.uri.toString() ?? '';
}

function resourceUri(): vscode.Uri | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && vscode.workspace.getWorkspaceFolder(active)) {
    return active;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function writeTarget(): { config: vscode.WorkspaceConfiguration; target: vscode.ConfigurationTarget } {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return {
      config: vscode.workspace.getConfiguration('codeRunner'),
      target: vscode.ConfigurationTarget.Global,
    };
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  const folder = (active && vscode.workspace.getWorkspaceFolder(active)) || folders[0];
  return {
    config: vscode.workspace.getConfiguration('codeRunner', folder.uri),
    target: vscode.ConfigurationTarget.WorkspaceFolder,
  };
}

function isOverridden(
  inspected: SettingInspection<Record<string, string>> | undefined,
  name: string,
): boolean {
  if (!inspected) {
    return false;
  }
  return mapHasKey(inspected.workspaceFolderValue, name)
    || mapHasKey(inspected.workspaceValue, name)
    || mapHasKey(inspected.globalValue, name);
}

async function clearMapKey(section: string, name: string): Promise<boolean> {
  let changed = false;
  const targets: Array<{ config: vscode.WorkspaceConfiguration; target: vscode.ConfigurationTarget }> = [
    { config: vscode.workspace.getConfiguration('codeRunner'), target: vscode.ConfigurationTarget.Global },
    { config: vscode.workspace.getConfiguration('codeRunner'), target: vscode.ConfigurationTarget.Workspace },
  ];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    targets.push({
      config: vscode.workspace.getConfiguration('codeRunner', folder.uri),
      target: vscode.ConfigurationTarget.WorkspaceFolder,
    });
  }
  for (const { config, target } of targets) {
    const inspected = config.inspect<Record<string, string>>(section);
    const current = scopeMap(inspected, target);
    if (!current || !Object.prototype.hasOwnProperty.call(current, name)) {
      continue;
    }
    const next = { ...current };
    delete next[name];
    await config.update(section, Object.keys(next).length > 0 ? next : undefined, target);
    changed = true;
  }
  return changed;
}

async function clearString(section: string): Promise<boolean> {
  let changed = false;
  const global = vscode.workspace.getConfiguration('codeRunner');
  for (const target of [vscode.ConfigurationTarget.Global, vscode.ConfigurationTarget.Workspace]) {
    if (scopeRaw(global.inspect<string>(section), target) !== undefined) {
      await global.update(section, undefined, target);
      changed = true;
    }
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const config = vscode.workspace.getConfiguration('codeRunner', folder.uri);
    if (config.inspect<string>(section)?.workspaceFolderValue !== undefined) {
      await config.update(section, undefined, vscode.ConfigurationTarget.WorkspaceFolder);
      changed = true;
    }
  }
  return changed;
}

function validKey(kind: MapKind, key: string): boolean {
  if (!key || /\s/.test(key)) {
    void vscode.window.showWarningMessage('The name cannot be empty or contain spaces.');
    return false;
  }
  if (kind === 'extension' && !/^\.[A-Za-z0-9._+-]+$/.test(key)) {
    void vscode.window.showWarningMessage('Include the dot, for example .py.');
    return false;
  }
  if ((kind === 'language' || kind === 'glob') && /[\\/]/.test(key)) {
    void vscode.window.showWarningMessage('Use a name, not a path.');
    return false;
  }
  return true;
}

function iconFor(kind: ProgramKind): string {
  switch (kind) {
    case 'language':
      return 'code';
    case 'extension':
      return 'symbol-file';
    case 'glob':
      return 'regex';
    case 'custom':
      return 'terminal';
  }
}
