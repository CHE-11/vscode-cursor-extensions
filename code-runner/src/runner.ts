import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildCommand, placeholderContext, quote, resolveExecutor, toPowerShell } from './executor';
import { readSettings, type RunSettings } from './settings';

interface RunRequest {
  fileUri?: vscode.Uri;
  languageId?: string;
  custom?: boolean;
}

export class CodeRunner implements vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel('Code Runner');
  private readonly disposables: vscode.Disposable[] = [];
  private terminal: vscode.Terminal | undefined;
  private process: ChildProcess | undefined;
  private activeTmp: string | undefined;
  private lastCwd: string | undefined;
  private mode: 'terminal' | 'output' | undefined;
  private running = false;
  private runId = 0;
  private disposed = false;

  constructor() {
    this.disposables.push(vscode.window.onDidCloseTerminal((closed) => {
      if (closed !== this.terminal) {
        return;
      }
      this.terminal = undefined;
      this.lastCwd = undefined;
      if (this.mode === 'terminal') {
        this.setRunning(false);
      }
    }));
  }

  async run(request: RunRequest = {}): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const opened = await this.openDocument(request.fileUri, editor);
    if (!opened) {
      if (request.custom) {
        const settings = readSettings(this.workspaceResource());
        await this.execute(settings.customCommand, this.executionOptions(settings, {
          appendFile: false,
          codeFile: undefined,
          cwd: this.workspaceCwd(),
          isTmp: false,
        }));
        return;
      }
      void vscode.window.showInformationMessage('No code found or selected.');
      return;
    }

    const { document, fromExplorer } = opened;
    if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
      void vscode.window.showInformationMessage('Code Runner can only run a file or an untitled editor.');
      return;
    }

    const settings = readSettings(settingsResource(document));
    const filePath = document.uri.scheme === 'file' ? document.uri.fsPath : document.fileName;
    const resolved = resolveExecutor({
      baseName: path.basename(filePath),
      languageId: document.languageId,
      fileExtension: path.extname(filePath),
      firstLine: document.lineCount > 0 ? document.lineAt(0).text : '',
      languageIdOverride: request.languageId,
      respectShebang: settings.respectShebang,
      executorMap: settings.executorMap,
      executorMapByGlob: settings.executorMapByGlob,
      executorMapByFileExtension: settings.executorMapByFileExtension,
      defaultLanguage: settings.defaultLanguage,
    });
    const executor = request.custom ? settings.customCommand : resolved.command;
    if (!executor || !executor.trim()) {
      void vscode.window.showInformationMessage(
        request.custom ? 'The custom command is empty.' : 'Code language not supported or defined.',
      );
      return;
    }

    const cwd = this.resolveCwd(settings, document);
    const selection = !fromExplorer && editor && editor.document === document ? editor.selection : undefined;
    const runWholeFile = document.uri.scheme === 'file'
      && (fromExplorer || !selection || selection.isEmpty || settings.ignoreSelection);

    let codeFile: string;
    let isTmp = false;
    if (runWholeFile) {
      if (!(await this.saveBeforeRun(settings, document))) {
        return;
      }
      codeFile = document.uri.fsPath;
    } else {
      const text = this.snippetText(document, selection, settings, resolved.languageId);
      try {
        codeFile = writeTempFile(
          document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : cwd,
          tempBaseName(settings.temporaryFileName),
          fileTypeFor(resolved.languageId, path.extname(filePath), settings.languageIdToFileExtensionMap),
          text,
          document.uri.scheme === 'file' ? document.uri.fsPath : undefined,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Could not write the temporary file. ${message}`);
        return;
      }
      isTmp = true;
    }

    const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? '';
    await this.execute(executor, this.executionOptions(settings, {
      appendFile: !request.custom,
      codeFile,
      cwd,
      isTmp,
      workspaceRoot: folder,
      pythonPath: pythonInterpreter(document.uri, executor),
    }));
  }

  async runByLanguage(): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    const resource = document ? settingsResource(document) : this.workspaceResource();
    const languages = Object.keys(readSettings(resource).executorMap).sort((a, b) => a.localeCompare(b));
    const picked = await vscode.window.showQuickPick(languages, { placeHolder: 'Language to run' });
    if (!picked) {
      return;
    }
    await this.run({ languageId: picked });
  }

  async runCustom(): Promise<void> {
    await this.run({ custom: true });
  }

  stop(): void {
    this.stopOutputProcess();
    if (this.mode === 'terminal' && this.running && this.terminal) {
      this.terminal.sendText('\u0003', false);
    }
    this.setRunning(false);
  }

  dispose(): void {
    this.disposed = true;
    this.runId += 1;
    this.stopOutputProcess();
    this.output.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async openDocument(
    fileUri: vscode.Uri | undefined,
    editor: vscode.TextEditor | undefined,
  ): Promise<{ document: vscode.TextDocument; fromExplorer: boolean } | undefined> {
    if (fileUri?.scheme === 'file') {
      const same = editor?.document.uri.fsPath === fileUri.fsPath;
      if (!same) {
        return { document: await vscode.workspace.openTextDocument(fileUri), fromExplorer: true };
      }
    }
    if (!editor) {
      return undefined;
    }
    return { document: editor.document, fromExplorer: false };
  }

  private snippetText(
    document: vscode.TextDocument,
    selection: vscode.Selection | undefined,
    settings: RunSettings,
    languageId: string,
  ): string {
    const selected = selection && !selection.isEmpty && !settings.ignoreSelection;
    let text = selected ? document.getText(selection) : document.getText();
    if (languageId === 'php') {
      const trimmed = text.trim();
      if (!trimmed.startsWith('<?php')) {
        text = `<?php\r\n${text}`;
      }
    }
    return text;
  }

  private async saveBeforeRun(settings: RunSettings, document: vscode.TextDocument): Promise<boolean> {
    if (settings.saveAllFilesBeforeRun) {
      return vscode.workspace.saveAll();
    }
    if (settings.saveFileBeforeRun) {
      return document.save();
    }
    return true;
  }

  private resolveCwd(settings: RunSettings, document: vscode.TextDocument): string {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (settings.cwd.trim()) {
      return path.resolve(folder || os.tmpdir(), settings.cwd);
    }
    const fileDir = document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : undefined;
    if ((settings.fileDirectoryAsCwd || !folder) && fileDir) {
      return fileDir;
    }
    return folder || os.tmpdir();
  }

  private workspaceCwd(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir();
  }

  private workspaceResource(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
  }

  private executionOptions(settings: RunSettings, run: Pick<Execution, 'appendFile' | 'codeFile' | 'cwd' | 'isTmp' | 'workspaceRoot' | 'pythonPath'>): Execution {
    return {
      ...run,
      showMessage: settings.showExecutionMessage,
      runInTerminal: settings.runInTerminal,
      clearPreviousOutput: settings.clearPreviousOutput,
      preserveFocus: settings.preserveFocus,
      powershell: settings.runInTerminal && isPowerShellTerminal(),
    };
  }

  private async execute(executor: string, run: Execution): Promise<void> {
    const prepared = run.powershell ? toPowerShell(executor) : executor;
    const ctx = run.codeFile
      ? placeholderContext(run.codeFile, run.workspaceRoot || run.cwd, run.pythonPath || 'python')
      : undefined;
    const command = buildCommand(prepared, ctx, run.appendFile).trim();
    if (!command) {
      void vscode.window.showErrorMessage('The program command is empty.');
      return;
    }
    const cwd = existingDirectory(run.cwd) ?? this.workspaceCwd();
    const id = ++this.runId;
    this.stopOutputProcess();
    this.activeTmp = run.isTmp ? run.codeFile : undefined;
    if (run.runInTerminal) {
      await this.runInTerminal(command, cwd, run.clearPreviousOutput, run.preserveFocus);
      return;
    }
    this.runInOutput(command, cwd, id, run);
  }

  private async runInTerminal(command: string, cwd: string, clear: boolean, preserveFocus: boolean): Promise<void> {
    let created = false;
    if (!this.terminal) {
      this.terminal = vscode.window.createTerminal({
        name: 'Code Runner',
        cwd,
        iconPath: new vscode.ThemeIcon('play'),
      });
      this.lastCwd = cwd;
      created = true;
    }
    const interrupt = this.mode === 'terminal' && this.running;
    this.mode = 'terminal';
    this.terminal.show(preserveFocus);
    if (clear && !created) {
      await vscode.commands.executeCommand('workbench.action.terminal.clear');
    }
    if (interrupt) {
      this.terminal.sendText('\u0003', false);
    }
    if (!created && cwd !== this.lastCwd) {
      this.terminal.sendText(`cd ${quote(cwd.replace(/\\/g, '/'))}`);
      this.lastCwd = cwd;
    }
    this.terminal.sendText(command);
    this.setRunning(true);
  }

  private runInOutput(command: string, cwd: string, id: number, run: Execution): void {
    this.mode = 'output';
    if (run.clearPreviousOutput) {
      this.output.clear();
    }
    this.output.show(run.preserveFocus);
    if (run.showMessage) {
      this.appendLine(`[Running] ${command}`);
    }
    const started = Date.now();
    const child = spawn(command, [], {
      cwd,
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    this.process = child;
    this.setRunning(true);
    const tmp = run.isTmp ? run.codeFile : undefined;

    child.stdout?.on('data', (chunk: Buffer | string) => {
      this.append(chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      this.append(chunk.toString());
    });
    child.on('error', (error) => {
      if (this.disposed || id !== this.runId) {
        return;
      }
      this.process = undefined;
      this.setRunning(false);
      this.appendLine(error.message);
    });
    child.on('close', (code) => {
      if (tmp && tmp !== this.activeTmp) {
        removeTemp(tmp);
      }
      if (this.disposed || id !== this.runId) {
        return;
      }
      if (tmp) {
        removeTemp(tmp);
        if (this.activeTmp === tmp) {
          this.activeTmp = undefined;
        }
      }
      this.process = undefined;
      this.setRunning(false);
      if (run.showMessage) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        this.appendLine('');
        this.appendLine(`[Done] exited with code=${code ?? 'cancelled'} in ${elapsed} seconds`);
        this.appendLine('');
      }
    });
  }

  private stopOutputProcess(): void {
    const child = this.process;
    if (!child) {
      return;
    }
    this.process = undefined;
    killTree(child);
  }

  private setRunning(running: boolean): void {
    if (this.running === running) {
      return;
    }
    this.running = running;
    void vscode.commands.executeCommand('setContext', 'codeRunner.running', running);
  }

  private append(text: string): void {
    if (!this.disposed) {
      this.output.append(text);
    }
  }

  private appendLine(text: string): void {
    if (!this.disposed) {
      this.output.appendLine(text);
    }
  }
}

interface Execution {
  appendFile: boolean;
  codeFile: string | undefined;
  cwd: string;
  isTmp: boolean;
  workspaceRoot?: string;
  pythonPath?: string;
  showMessage: boolean;
  runInTerminal: boolean;
  clearPreviousOutput: boolean;
  preserveFocus: boolean;
  powershell?: boolean;
}

function settingsResource(document: vscode.TextDocument): vscode.Uri {
  if (vscode.workspace.getWorkspaceFolder(document.uri)) {
    return document.uri;
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri ?? document.uri;
}

function tempBaseName(configured: string): string {
  const name = configured.trim();
  if (name) {
    return name;
  }
  return `temp${Math.random().toString(36).slice(2, 10)}`;
}

function fileTypeFor(languageId: string, originalExtension: string, map: Record<string, string>): string {
  const mapped = map[languageId];
  if (mapped) {
    return mapped.startsWith('.') ? mapped : `.${mapped}`;
  }
  if (originalExtension) {
    return originalExtension;
  }
  if (languageId.startsWith('.')) {
    return languageId;
  }
  if (languageId) {
    return `.${languageId}`;
  }
  return '.txt';
}

function writeTempFile(folder: string, base: string, extension: string, content: string, avoid: string | undefined): string {
  const ext = extension.startsWith('.') || extension === '' ? extension : `.${extension}`;
  let target = path.join(folder, `${base}${ext}`);
  if (avoid && path.resolve(target) === path.resolve(avoid)) {
    target = path.join(folder, `${base}-${Date.now()}${ext}`);
  }
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return target;
}

function removeTemp(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // The file may already be gone.
  }
}

function existingDirectory(candidate: string): string | undefined {
  try {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function pythonInterpreter(resource: vscode.Uri, command: string): string {
  if (!command.includes('$pythonPath')) {
    return 'python';
  }
  const configured = vscode.workspace.getConfiguration('python', resource).get<string>('defaultInterpreterPath');
  if (configured && configured.trim()) {
    return configured.trim();
  }
  return 'python';
}

function isPowerShellTerminal(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  const profile = vscode.workspace.getConfiguration('terminal').get<string>('integrated.defaultProfile.windows');
  if (profile) {
    const normalized = profile.toLowerCase();
    if (normalized.includes('powershell')) {
      return true;
    }
    if (normalized.includes('command prompt') || normalized === 'cmd') {
      return false;
    }
  }
  return vscode.env.shell.toLowerCase().includes('powershell');
}

function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) {
    child.kill();
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }).on('error', () => {
      child.kill();
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}
