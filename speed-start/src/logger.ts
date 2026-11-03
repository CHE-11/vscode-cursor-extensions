import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function log(message: string): void {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Speed Start');
  }
  outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}

export function disposeLogger(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
}
