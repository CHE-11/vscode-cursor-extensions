import * as vscode from 'vscode';

const refresh = new vscode.EventEmitter<void>();

export const onDidRequestRefresh = refresh.event;

export function requestRefresh(): void {
  refresh.fire();
}
