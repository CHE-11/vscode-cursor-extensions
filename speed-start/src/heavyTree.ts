import * as vscode from 'vscode';
import { formatBytes, formatCount } from './format';
import type { ScanNode, ScanResult } from './scan';

type HeavyElement = GroupItem | PathItem | NoteItem;

export class HeavyTreeProvider implements vscode.TreeDataProvider<HeavyElement>, vscode.Disposable {
  private readonly onDidChange = new vscode.EventEmitter<HeavyElement | undefined>();
  readonly onDidChangeTreeData = this.onDidChange.event;
  private result: ScanResult | undefined;
  private scanning = false;
  private multiRoot = false;

  setScanning(scanning: boolean): void {
    this.scanning = scanning;
    this.onDidChange.fire(undefined);
  }

  setResult(result: ScanResult | undefined, multiRoot: boolean): void {
    this.result = result;
    this.multiRoot = multiRoot;
    this.scanning = false;
    this.onDidChange.fire(undefined);
  }

  dispose(): void {
    this.onDidChange.dispose();
  }

  getTreeItem(element: HeavyElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HeavyElement): HeavyElement[] {
    if (!element) {
      if (this.scanning) {
        return [new NoteItem('Scanning workspace…')];
      }
      if (!this.result) {
        return [];
      }
      const roots: HeavyElement[] = [];
      if (this.result.candidates.length === 0 && this.result.ignored.length === 0) {
        roots.push(new NoteItem('No heavy paths found.'));
      }
      if (this.result.candidates.length > 0) {
        roots.push(new GroupItem('candidates', this.result.candidates.length));
      }
      if (this.result.ignored.length > 0) {
        roots.push(new GroupItem('ignored', this.result.ignored.length));
      }
      return roots;
    }
    if (element instanceof GroupItem) {
      const nodes = element.kind === 'candidates' ? this.result?.candidates ?? [] : this.result?.ignored ?? [];
      return nodes.map((node) => new PathItem(node, this.multiRoot));
    }
    if (element instanceof PathItem) {
      return element.node.children.map((node) => new PathItem(node, this.multiRoot));
    }
    return [];
  }
}

export class PathItem extends vscode.TreeItem {
  constructor(
    readonly node: ScanNode,
    multiRoot: boolean,
  ) {
    const directory = node.kind === 'directory';
    super(displayPath(node, multiRoot), node.children.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.id = `${node.ignored ? 'ignored' : 'path'}:${node.absolutePath}`;
    this.contextValue = node.ignored ? 'ignoredPath' : directory ? 'heavyDirectory' : 'heavyFile';
    this.iconPath = new vscode.ThemeIcon(node.ignored ? 'circle-slash' : directory ? 'folder' : 'file');
    this.resourceUri = vscode.Uri.file(node.absolutePath);
    this.description = node.ignored ? 'ignored, not scanned' : describeNode(node);
    this.tooltip = node.ignored
      ? `${node.relativePath}/ is already covered by .gitignore or .cursorignore.`
      : describeNode(node);
  }
}

class GroupItem extends vscode.TreeItem {
  constructor(
    readonly kind: 'candidates' | 'ignored',
    count: number,
  ) {
    super(kind === 'candidates' ? 'Not ignored' : 'Already ignored', vscode.TreeItemCollapsibleState.Expanded);
    this.id = kind;
    this.contextValue = 'group';
    this.description = formatCount(count);
    this.iconPath = new vscode.ThemeIcon(kind === 'candidates' ? 'warning' : 'check');
  }
}

class NoteItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'note';
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

export function isPathItem(value: unknown): value is PathItem {
  return value instanceof PathItem;
}

function displayPath(node: ScanNode, multiRoot: boolean): string {
  const pathLabel = node.kind === 'directory' ? `${node.relativePath}/` : node.relativePath;
  return multiRoot ? `${node.workspaceName}: ${pathLabel}` : pathLabel;
}

function describeNode(node: ScanNode): string {
  if (node.kind === 'file') {
    return formatBytes(node.byteSize);
  }
  return `${formatCount(node.fileCount)} files · ${formatBytes(node.byteSize)}`;
}
