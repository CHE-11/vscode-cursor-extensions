import * as vscode from 'vscode';

interface HiddenItem {
  pattern: string;
}

export class HiddenItemsView implements vscode.TreeDataProvider<HiddenItem>, vscode.Disposable {
  private items: HiddenItem[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  update(patterns: readonly string[]): void {
    this.items = patterns.map((pattern) => ({ pattern }));
    this.emitter.fire();
  }

  getChildren(): HiddenItem[] {
    return this.items;
  }

  getTreeItem(item: HiddenItem): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(item.pattern, vscode.TreeItemCollapsibleState.None);
    treeItem.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'light', 'put-back-icon.svg');
    treeItem.command = {
      command: 'make-hidden.remove.item',
      title: 'Put Back',
      arguments: [item.pattern],
    };
    return treeItem;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
