import * as vscode from 'vscode';
import type { App } from './app';
import { optionActions, syncActions, type SyncAction } from './options';
import { onDidRequestRefresh } from './refresh';
import { isPlausibleToken, parseGistId, type LocalSettings } from './safe';
import { readLocal, readSettings, type SyncSettings } from './settings';
import { getToken } from './token';

type GroupId = 'sync' | 'setup';

interface SideText {
  token: string;
  gist: string;
  upload: string;
  download: string;
}

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
        new SyncNode('Setup', 'setup', vscode.TreeItemCollapsibleState.Expanded),
      ];
    }
    if (element.groupId !== 'sync' && element.groupId !== 'setup') return [];
    const settings = readSettings();
    const detail = await this.sideText(settings);
    const actions = element.groupId === 'sync' ? syncActions : optionActions;
    return actions.map((action) => this.actionItem(action, settings, detail));
  }

  private async sideText(settings: SyncSettings): Promise<SideText> {
    const token = await getToken(this.app.context);
    let local: LocalSettings | undefined;
    try {
      local = (await readLocal(this.app.userFolder)).settings;
    } catch {
      local = undefined;
    }
    return {
      token: isPlausibleToken(token) ? 'Saved' : 'Not set',
      gist: parseGistId(settings.gist) ?? 'Not set',
      upload: local ? formatWhen(local.lastUpload) : 'Unavailable',
      download: local ? formatWhen(local.lastDownload) : 'Unavailable',
    };
  }

  private actionItem(action: SyncAction, settings: SyncSettings, detail: SideText): SyncNode {
    const item = new SyncNode(action.label, undefined, vscode.TreeItemCollapsibleState.None, action);
    if (action.toggle) {
      const enabled = settings[action.toggle] === true;
      item.description = onOff(enabled);
      item.iconPath = new vscode.ThemeIcon(enabled ? 'pass-filled' : 'circle-large');
    } else if (action.id === 'setToken') {
      item.description = detail.token;
      item.tooltip = `Token: ${detail.token}`;
    } else if (action.id === 'chooseGist') {
      item.description = detail.gist;
      item.tooltip = `Gist: ${detail.gist}`;
    } else if (action.id === 'upload') {
      item.description = detail.upload;
      item.tooltip = `Last upload: ${detail.upload}`;
    } else if (action.id === 'download') {
      item.description = detail.download;
      item.tooltip = `Last download: ${detail.download}`;
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
