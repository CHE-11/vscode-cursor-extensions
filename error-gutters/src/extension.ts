import * as vscode from 'vscode';

const ICON_SIZE = '80%';
const ICONS = [
  'error-inverse.svg',
  'warning-inverse.svg',
  'info-inverse.svg',
  'info-inverse.svg',
];

export function activate(context: vscode.ExtensionContext): void {
  const decorations = ICONS.map((file) =>
    vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'img', file),
      gutterIconSize: ICON_SIZE,
    }),
  );
  context.subscriptions.push(...decorations);

  const refresh = () => {
    updateGutters(vscode.window.activeTextEditor, decorations);
  };
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
  );
  refresh();
}

export function deactivate(): void {}

function updateGutters(
  editor: vscode.TextEditor | undefined,
  decorations: readonly vscode.TextEditorDecorationType[],
): void {
  if (!editor) {
    return;
  }

  const lines = mostSevereByLine(vscode.languages.getDiagnostics(editor.document.uri));
  decorations.forEach((decoration, severity) => {
    const ranges: vscode.Range[] = [];
    for (const [line, lineSeverity] of lines) {
      if (lineSeverity === severity) {
        ranges.push(new vscode.Range(line, 0, line, 0));
      }
    }
    editor.setDecorations(decoration, ranges);
  });
}

function mostSevereByLine(diagnostics: readonly vscode.Diagnostic[]): Map<number, number> {
  const lines = new Map<number, number>();
  for (const diagnostic of diagnostics) {
    const line = diagnostic.range.start.line;
    const severity = Math.min(diagnostic.severity, vscode.DiagnosticSeverity.Hint);
    const current = lines.get(line);
    if (current === undefined || severity < current) {
      lines.set(line, severity);
    }
  }
  return lines;
}
