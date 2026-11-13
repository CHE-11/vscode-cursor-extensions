import type * as vscode from 'vscode';

export interface App {
  context: vscode.ExtensionContext;
  userFolder: string;
}
