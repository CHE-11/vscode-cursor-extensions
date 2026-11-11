import * as vscode from 'vscode';
import { ProgramsTreeProvider, ProgramItem } from './programsTree';
import { CodeRunner } from './runner';

export function activate(context: vscode.ExtensionContext): void {
  const programs = new ProgramsTreeProvider();
  const runner = new CodeRunner();
  const view = vscode.window.createTreeView('codeRunner.programs', {
    treeDataProvider: programs,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    view,
    programs,
    runner,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('codeRunner')) {
        programs.refresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      programs.refreshForActiveEditor();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      programs.refresh();
    }),
    vscode.commands.registerCommand('codeRunner.run', (uri?: vscode.Uri) => runner.run({ fileUri: fileUri(uri) })),
    vscode.commands.registerCommand('codeRunner.stop', () => {
      runner.stop();
    }),
    vscode.commands.registerCommand('codeRunner.runByLanguage', () => runner.runByLanguage()),
    vscode.commands.registerCommand('codeRunner.runCustomCommand', () => runner.runCustom()),
    vscode.commands.registerCommand('codeRunner.addProgram', () => programs.add()),
    vscode.commands.registerCommand('codeRunner.editProgram', (item?: ProgramItem) => programs.edit(item)),
    vscode.commands.registerCommand('codeRunner.resetProgram', (item?: ProgramItem) => programs.reset(item)),
    vscode.commands.registerCommand('codeRunner.deleteProgram', (item?: ProgramItem) => programs.delete(item)),
  );

  void vscode.commands.executeCommand('setContext', 'codeRunner.running', false);
}

function fileUri(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri && value.scheme === 'file') {
    return value;
  }
  return undefined;
}
