import * as vscode from 'vscode';
import { FOLD_LEVELS, commandId, foldCommands, levelsToShow, middleVisibleLine, type FoldLevel } from './fold';

const statusBarItems = new Map<FoldLevel, vscode.StatusBarItem>();

export function activate(context: vscode.ExtensionContext): void {
  FOLD_LEVELS.forEach((level, index) => {
    const id = commandId(level);
    context.subscriptions.push(vscode.commands.registerCommand(id, () => applyFoldLevel(level)));

    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100 - index);
    item.command = id;
    item.text = level;
    item.tooltip = level === '∞' ? 'Unfold All' : `Fold Level ${level}`;
    statusBarItems.set(level, item);
    context.subscriptions.push(item);
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('foldLevel')) {
        updateStatusBar();
      }
    }),
  );
  updateStatusBar();
}

export function deactivate(): void {}

function updateStatusBar(): void {
  const configured = vscode.workspace.getConfiguration('foldLevel').get<string[]>('level');
  const visible = new Set(levelsToShow(configured));
  for (const [level, item] of statusBarItems) {
    if (visible.has(level)) {
      item.show();
    } else {
      item.hide();
    }
  }
}

async function applyFoldLevel(level: FoldLevel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.visibleRanges.length === 0) {
    return;
  }

  const middleLine = middleVisibleLine(
    editor.visibleRanges.map((range) => ({
      startLine: range.start.line,
      endLine: range.end.line,
    })),
  );
  if (middleLine === undefined) {
    return;
  }

  const selection = editor.selection;
  const foldSubLevels = vscode.workspace.getConfiguration('foldLevel').get<boolean>('foldSubLevels') === true;
  const end = new vscode.Position(editor.document.lineCount, 0);
  editor.selection = new vscode.Selection(end, end);

  await vscode.commands.executeCommand('editor.unfoldAll');
  for (const command of foldCommands(level, foldSubLevels)) {
    await vscode.commands.executeCommand(command);
  }

  if (editor.document.isClosed) {
    return;
  }

  editor.selection = selection;
  const line = Math.min(middleLine, editor.document.lineCount);
  const position = new vscode.Position(line, 0);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}
