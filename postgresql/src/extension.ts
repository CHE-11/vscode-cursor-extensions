import * as vscode from 'vscode';
import { PostgresqlCompletionItemProvider } from './completion';
import { PsqlRunner } from './executeFile';
import { PostgresqlSignatureHelpProvider } from './signatureHelp';

export function activate(context: vscode.ExtensionContext): void {
  const runner = new PsqlRunner();
  context.subscriptions.push(runner);
  context.subscriptions.push(
    vscode.commands.registerCommand('postgres.executeSql', () => {
      runner.execFile();
    }),
  );
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('pgsql', new PostgresqlCompletionItemProvider(), '.', ' '),
  );
  context.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider('pgsql', new PostgresqlSignatureHelpProvider(), '(', ','),
  );
}

export function deactivate(): void {}
