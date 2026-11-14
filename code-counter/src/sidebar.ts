import * as vscode from 'vscode';
import { addWalkEntry, deleteWalkEntry, editWalkEntry, toggleWalkOption, walkGroupChildren, walkRootChildren, walkSummary, WalkGroupNode, type WalkNode } from './walkView';

type GroupId = 'count' | 'languages' | 'walk';

interface SideAction {
  command: string;
  label: string;
  icon: string;
  toggle?: boolean;
}

const countActions: SideAction[] = [
  { command: 'countInWorkspace', label: 'Count Lines in Workspace', icon: 'folder-library' },
  { command: 'countInDirectory', label: 'Count Lines in Directory', icon: 'folder' },
  { command: 'toggleRealtime', label: 'Real-time Counter', icon: 'pulse', toggle: true },
];

export type CountCommand = 'countInWorkspace' | 'countInDirectory';

const languageActions: SideAction[] = [
  { command: 'outputAvailableLanguages', label: 'Show Available Languages', icon: 'symbol-keyword' },
  { command: 'saveLanguageConfigurations', label: 'Save Language Configurations', icon: 'save' },
];

export class CommandNode extends vscode.TreeItem {
  constructor(
    label: string,
    readonly groupId: GroupId | undefined,
    collapsible: vscode.TreeItemCollapsibleState,
    action?: SideAction,
  ) {
    super(label, collapsible);
    this.id = action?.command ?? groupId ?? label;
    if (action) {
      this.iconPath = new vscode.ThemeIcon(action.icon);
      this.command = {
        command: `code-counter.${action.command}`,
        title: action.label,
      };
      if (action.toggle) this.contextValue = 'toggle';
    }
  }
}

export class CodeCounterView implements vscode.TreeDataProvider<CommandNode | WalkNode>, vscode.Disposable {
  private readonly change = new vscode.EventEmitter<CommandNode | WalkNode | undefined>();
  readonly onDidChangeTreeData = this.change.event;
  private counting: CountCommand | undefined;

  constructor(private readonly realtimeVisible: () => boolean) {}

  setCounting(command: CountCommand | undefined): void {
    if (this.counting === command) return;
    this.counting = command;
    this.refresh();
  }

  dispose(): void {
    this.change.dispose();
  }

  refresh(): void {
    this.change.fire(undefined);
  }

  getTreeItem(element: CommandNode | WalkNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommandNode | WalkNode): Array<CommandNode | WalkNode> {
    if (!element) {
      const walk = new CommandNode('Walk', 'walk', vscode.TreeItemCollapsibleState.Expanded);
      walk.description = walkSummary();
      walk.tooltip = 'File types, include globs, and exclude globs used when counting a workspace or directory.';
      return [
        new CommandNode('Count', 'count', vscode.TreeItemCollapsibleState.Expanded),
        this.spacer('spacer-count'),
        walk,
        this.spacer('spacer-walk'),
        new CommandNode('Languages', 'languages', vscode.TreeItemCollapsibleState.Expanded),
      ];
    }
    if (element instanceof WalkGroupNode) return walkGroupChildren(element);
    if (element instanceof CommandNode && element.groupId === 'count') return countActions.map((action) => this.actionItem(action));
    if (element instanceof CommandNode && element.groupId === 'languages') return languageActions.map((action) => this.actionItem(action));
    if (element instanceof CommandNode && element.groupId === 'walk') return walkRootChildren();
    return [];
  }

  addWalkEntry(node?: unknown): Promise<void> {
    return addWalkEntry(node);
  }

  editWalkEntry(node?: unknown): Promise<void> {
    return editWalkEntry(node);
  }

  deleteWalkEntry(node?: unknown): Promise<void> {
    return deleteWalkEntry(node);
  }

  toggleWalkOption(node?: unknown): Promise<void> {
    return toggleWalkOption(node);
  }

  private actionItem(action: SideAction): CommandNode {
    const item = new CommandNode(action.label, undefined, vscode.TreeItemCollapsibleState.None, action);
    if (this.counting === action.command) {
      item.iconPath = new vscode.ThemeIcon('loading~spin');
      item.description = 'Counting';
      item.tooltip = 'Counting…';
    } else if (action.toggle) {
      const enabled = this.realtimeVisible();
      item.description = enabled ? 'On' : 'Off';
      item.iconPath = new vscode.ThemeIcon(enabled ? 'pass-filled' : 'circle-large');
      item.tooltip = enabled ? 'Real-time counter is on' : 'Real-time counter is off';
    }
    return item;
  }

  private spacer(id: string): CommandNode {
    const item = new CommandNode('\u00a0', undefined, vscode.TreeItemCollapsibleState.None);
    item.id = id;
    item.contextValue = 'spacer';
    item.tooltip = '';
    return item;
  }
}
