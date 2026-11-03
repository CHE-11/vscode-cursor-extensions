import * as vscode from 'vscode';

export async function readTextFile(uri: vscode.Uri): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return '';
  }
}

export async function appendIgnorePatterns(uri: vscode.Uri, patterns: readonly string[]): Promise<void> {
  if (patterns.length === 0) {
    return;
  }
  const existing = await readTextFile(uri);
  const prefix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  const next = `${existing}${prefix}${patterns.join('\n')}\n`;
  const edit = new vscode.WorkspaceEdit();
  let exists = existing.length > 0;
  if (!exists) {
    try {
      await vscode.workspace.fs.stat(uri);
      exists = true;
    } catch {
      exists = false;
    }
  }
  if (!exists) {
    edit.createFile(uri, { ignoreIfExists: true, contents: Buffer.from(next, 'utf8') });
  } else {
    const document = await vscode.workspace.openTextDocument(uri);
    const full = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    edit.replace(uri, full, next);
  }
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    throw new Error(`Could not update ${uri.fsPath}`);
  }
  const document = await vscode.workspace.openTextDocument(uri);
  if (document.isDirty) {
    const saved = await document.save();
    if (!saved) {
      throw new Error(`Could not save ${uri.fsPath}`);
    }
  }
}
