import * as vscode from 'vscode';
import type { App } from './app';
import { optionActions, syncActions, type SyncAction } from './options';
import { onDidRequestRefresh } from './refresh';
import { isPlausibleToken, parseGistId, type LocalSettings } from './safe';
import { readLocal, readSettings, type SyncSettings } from './settings';
import { getToken } from './token';

type GroupId = 'status' | 'sync' | 'setup';

export class SyncNode extends vscode.TreeItem {
  constructor(
    label: string,
    readonly groupId: GroupId | undefined,
    collapsible: vscode.TreeItemCollapsibleState,
    action?: SyncAction
  ) {
    super(label, collapsible);
    this.id = action?.id ?? groupId ?? label;
    if (action) {
      this.iconPath = new vscode.ThemeIcon(action.icon);
      this.command = {
        command: 'settings-sync.runOption',
        title: action.label,
        arguments: [action.id],
      };
      if (action.toggle) this.contextValue = 'toggle';
    }
  }
}

export class SettingsSyncView implements vscode.TreeDataProvider<SyncNode> {
  private readonly change = new vscode.EventEmitter<SyncNode | undefined>();
  readonly onDidChangeTreeData = this.change.event;

  constructor(private readonly app: App) {
    this.app.context.subscriptions.push(onDidRequestRefresh(() => this.refresh()));
  }

  refresh(): void {
    this.change.fire(undefined);
  }

  getTreeItem(element: SyncNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SyncNode): Promise<SyncNode[]> {
    if (!element) {
      return [
        new SyncNode('Sync', 'sync', vscode.TreeItemCollapsibleState.Expanded),
        this.spacer('spacer-sync'),
        new SyncNode('Status', 'status', vscode.TreeItemCollapsibleState.Expanded),
        this.spacer('spacer-status'),
        new SyncNode('Setup', 'setup', vscode.TreeItemCollapsibleState.Expanded),
      ];
    }
    if (element.groupId === 'status') return this.statusItems();
    if (element.groupId === 'sync') return syncActions.map((action) => this.actionItem(action, readSettings()));
    if (element.groupId === 'setup') return optionActions.map((action) => this.actionItem(action, readSettings()));
    return [];
  }

  private async statusItems(): Promise<SyncNode[]> {
    const settings = readSettings();
    const token = await getToken(this.app.context);
    let local: LocalSettings | undefined;
    try {
      local = (await readLocal(this.app.userFolder)).settings;
    } catch {
      local = undefined;
    }
    const gist = parseGistId(settings.gist);
    return [
      this.stat('Token', isPlausibleToken(token) ? 'Saved' : 'Not set', 'key'),
      this.stat('Gist', gist ?? 'Not set', 'github'),
      this.stat('Last upload', local ? formatWhen(local.lastUpload) : 'Unavailable', 'cloud-upload'),
      this.stat('Last download', local ? formatWhen(local.lastDownload) : 'Unavailable', 'cloud-download'),
      this.stat('Public Gist download', onOff(settings.downloadPublicGist), 'globe'),
      this.stat('Sync extensions', onOff(settings.syncExtensions), 'extensions'),
      this.stat('GitHub host', settings.githubEnterpriseUrl || 'github.com', 'server'),
    ];
  }

  private actionItem(action: SyncAction, settings: SyncSettings): SyncNode {
    const item = new SyncNode(action.label, undefined, vscode.TreeItemCollapsibleState.None, action);
    if (action.toggle) {
      const enabled = settings[action.toggle] === true;
      item.description = onOff(enabled);
      item.iconPath = new vscode.ThemeIcon(enabled ? 'pass-filled' : 'circle-large');
    }
    return item;
  }

  private spacer(id: string): SyncNode {
    const item = new SyncNode('\u00a0', undefined, vscode.TreeItemCollapsibleState.None);
    item.id = id;
    item.contextValue = 'spacer';
    item.tooltip = '';
    return item;
  }

  private stat(label: string, value: string, icon: string): SyncNode {
    const item = new SyncNode(label, undefined, vscode.TreeItemCollapsibleState.None);
    item.description = value;
    item.tooltip = `${label}: ${value}`;
    item.iconPath = new vscode.ThemeIcon(icon);
    item.contextValue = 'stat';
    return item;
  }
}

function onOff(enabled: boolean): string {
  return enabled ? 'On' : 'Off';
}

function formatWhen(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
}
