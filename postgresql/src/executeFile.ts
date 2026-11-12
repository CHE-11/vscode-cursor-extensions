import { spawn } from 'child_process';
import * as vscode from 'vscode';

export class PsqlRunner implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('psql');

  dispose(): void {
    this.output.dispose();
  }

  execFile(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const config = vscode.workspace.getConfiguration('postgreSql');
    const hostName = config.get<string>('hostName', 'localhost');
    const username = config.get<string>('username', 'postgres');
    const dbName = config.get<string>('dbName', 'postgres');
    const args = ['-d', dbName, '-U', username, '-h', hostName, '-f', editor.document.fileName];

    this.output.clear();
    this.output.show(true);
    this.output.appendLine(`psql ${args.join(' ')}`);

    const child = spawn('psql', args);
    child.stdout.on('data', (data: Buffer) => {
      this.output.append(data.toString());
    });
    child.stderr.on('data', (data: Buffer) => {
      this.output.append(data.toString());
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      const message =
        error.code === 'ENOENT'
          ? 'Cannot run the file. psql was not found. Add psql to your PATH.'
          : error.message || 'Failed to run psql.';
      this.output.appendLine(message);
      void vscode.window.showErrorMessage(message);
    });
    child.on('close', (code) => {
      this.output.appendLine(`psql finished with exit code ${code ?? 'unknown'}`);
    });
  }
}
