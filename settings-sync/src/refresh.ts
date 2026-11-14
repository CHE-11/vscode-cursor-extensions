import * as vscode from 'vscode';

const refresh = new vscode.EventEmitter<void>();

export const onDidRequestRefresh = refresh.event;

export type SyncActivity = 'upload' | 'download';

let activity: SyncActivity | null = null;

export function syncActivity(): SyncActivity | null {
  return activity;
}

export function setSyncActivity(next: SyncActivity | null): void {
  activity = next;
  refresh.fire();
}

export function requestRefresh(): void {
  refresh.fire();
}
