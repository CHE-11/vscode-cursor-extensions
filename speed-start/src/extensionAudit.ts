import * as vscode from 'vscode';
import { classifyExtension, compareStartupExtensions, type StartupExtensionInfo } from './startupExtensions';

type AuditElement = AuditGroupItem | AuditExtensionItem | AuditNoteItem;

export class ExtensionAuditProvider implements vscode.TreeDataProvider<AuditElement>, vscode.Disposable {
  private readonly onDidChange = new vscode.EventEmitter<AuditElement | undefined>();
  readonly onDidChangeTreeData = this.onDidChange.event;
  private thirdParty: StartupExtensionInfo[] = [];
  private builtin: StartupExtensionInfo[] = [];

  refresh(): void {
    const found = vscode.extensions.all.flatMap((extension) => {
      const events = activationEvents(extension);
      const info = classifyExtension(extension.id, displayName(extension), extension.isActive, events);
      return info ? [info] : [];
    });
    this.thirdParty = found.filter((item) => !item.builtin).sort(compareStartupExtensions);
    this.builtin = found.filter((item) => item.builtin).sort(compareStartupExtensions);
    this.onDidChange.fire(undefined);
  }

  getExtensions(): StartupExtensionInfo[] {
    return [...this.thirdParty, ...this.builtin];
  }

  dispose(): void {
    this.onDidChange.dispose();
  }

  getTreeItem(element: AuditElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AuditElement): AuditElement[] {
    if (!element) {
      const roots: AuditElement[] = [];
      if (this.thirdParty.length === 0) {
        roots.push(new AuditNoteItem('No third-party startup extensions.'));
      } else {
        roots.push(new AuditGroupItem('thirdParty', this.thirdParty.length));
      }
      if (this.builtin.length > 0) {
        roots.push(new AuditGroupItem('builtin', this.builtin.length));
      }
      return roots;
    }
    if (element instanceof AuditGroupItem) {
      const items = element.kind === 'thirdParty' ? this.thirdParty : this.builtin;
      return items.map((item) => new AuditExtensionItem(item));
    }
    return [];
  }
}

class AuditGroupItem extends vscode.TreeItem {
  constructor(
    readonly kind: 'thirdParty' | 'builtin',
    count: number,
  ) {
    super(
      kind === 'thirdParty' ? 'Third-party' : 'Built-in',
      kind === 'thirdParty' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.id = kind;
    this.contextValue = 'group';
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon(kind === 'thirdParty' ? 'plug' : 'extensions');
  }
}

class AuditExtensionItem extends vscode.TreeItem {
  constructor(readonly info: StartupExtensionInfo) {
    super(info.displayName, vscode.TreeItemCollapsibleState.None);
    this.id = info.id;
    this.contextValue = 'startupExtension';
    this.description = `${info.isActive ? 'active' : 'inactive'} · ${info.events.join(', ')}`;
    this.tooltip = `${info.id}\n${this.description}`;
    this.iconPath = new vscode.ThemeIcon(info.isActive ? 'circle-filled' : 'circle-outline');
    this.command = {
      command: 'speedStart.openExtension',
      title: 'Open Extension',
      arguments: [info.id],
    };
  }
}

class AuditNoteItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'note';
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

function activationEvents(extension: vscode.Extension<unknown>): string[] {
  const events = extension.packageJSON?.activationEvents;
  if (!Array.isArray(events)) {
    return [];
  }
  return events.filter((event): event is string => typeof event === 'string');
}

function displayName(extension: vscode.Extension<unknown>): string {
  const name = extension.packageJSON?.displayName;
  return typeof name === 'string' && name.trim() ? name : extension.id;
}
