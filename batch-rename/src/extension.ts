import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';

const scheme = 'batch-rename';

interface RenameSession {
  uri: vscode.Uri;
  files: vscode.Uri[];
  applying: boolean;
  readyToClose: boolean;
}

type ApplyResult = 'applied' | 'busy' | 'failed';

class RenameListProvider implements vscode.FileSystemProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;
  private readonly files = new Map<string, Uint8Array>();

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const content = this.file(uri);
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: content.byteLength };
  }

  readDirectory(): never {
    throw vscode.FileSystemError.FileNotFound();
  }

  readFile(uri: vscode.Uri): Uint8Array {
    return this.file(uri);
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    this.files.set(uri.toString(), content);
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  delete(uri: vscode.Uri): void {
    this.files.delete(uri.toString());
  }

  hold(uri: vscode.Uri, text: string): void {
    this.files.set(uri.toString(), Buffer.from(text, 'utf8'));
  }

  drop(uri: vscode.Uri): void {
    this.files.delete(uri.toString());
  }

  private file(uri: vscode.Uri): Uint8Array {
    const content = this.files.get(uri.toString());
    if (!content) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return content;
  }
}

const lists = new RenameListProvider();
let session: RenameSession | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(scheme, lists),
    vscode.commands.registerCommand('batch-rename.rename', (clicked: unknown, selected: unknown) => {
      void openRenameList(clicked, selected);
    }),
    vscode.commands.registerCommand('batch-rename.apply', () => {
      void applyActiveList();
    }),
    vscode.workspace.onWillSaveTextDocument((event) => {
      const current = session;
      if (!current || event.document.uri.toString() !== current.uri.toString()) {
        return;
      }
      if (event.reason !== vscode.TextDocumentSaveReason.Manual) {
        return;
      }
      const names = namesFrom(event.document.getText());
      event.waitUntil(commitRename(current, names).then(() => undefined));
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const current = session;
      if (!current?.readyToClose || document.uri.toString() !== current.uri.toString()) {
        return;
      }
      void closeList(current.uri);
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.scheme !== scheme) {
        return;
      }
      lists.drop(document.uri);
      if (session?.uri.toString() === document.uri.toString()) {
        session = undefined;
      }
    }),
  );
}

export function deactivate(): void {
  if (session) {
    lists.drop(session.uri);
    session = undefined;
  }
}

async function openRenameList(clicked: unknown, selected: unknown): Promise<void> {
  const requested = uniqueUris(urisFrom(clicked, selected));
  if (requested.length === 0) {
    void vscode.window.showInformationMessage('Select one or more files in the Explorer, then run Batch Rename.');
    return;
  }

  const files: vscode.Uri[] = [];
  for (const uri of requested) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if ((stat.type & vscode.FileType.Directory) === 0) {
        files.push(uri);
      }
    } catch {
      // Skip resources that are no longer available.
    }
  }
  if (files.length === 0) {
    void vscode.window.showInformationMessage('Batch Rename only renames files.');
    return;
  }

  const previous = session;
  session = undefined;
  if (previous) {
    await closeList(previous.uri);
  }

  const uri = vscode.Uri.from({ scheme, path: `/${randomBytes(6).toString('hex')}.txt` });
  lists.hold(uri, `${files.map((file) => basename(file)).join('\n')}\n`);
  session = { uri, files, applying: false, readyToClose: false };

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
}

async function applyActiveList(): Promise<void> {
  const current = session;
  const editor = vscode.window.activeTextEditor;
  if (!current || editor?.document.uri.toString() !== current.uri.toString()) {
    return;
  }

  if (editor.document.isDirty) {
    try {
      await editor.document.save();
    } catch {
      // Save reports its own failure. The list stays open so the names can be corrected.
    }
    return;
  }

  const result = await commitRename(current, namesFrom(editor.document.getText()));
  if (result === 'applied') {
    await closeList(current.uri);
  }
}

async function commitRename(current: RenameSession, names: string[]): Promise<ApplyResult> {
  if (current.applying || current.readyToClose) {
    return 'busy';
  }

  current.applying = true;
  try {
    const error = await renameFiles(current.files, names);
    if (error) {
      void vscode.window.showErrorMessage(error);
      return 'failed';
    }
    current.readyToClose = true;
    return 'applied';
  } finally {
    current.applying = false;
  }
}

async function closeList(uri: vscode.Uri): Promise<void> {
  const target = uri.toString();
  const tabs = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === target),
  );
  if (tabs.length === 0) {
    lists.drop(uri);
    if (session?.uri.toString() === target) {
      session = undefined;
    }
    return;
  }
  await vscode.window.tabGroups.close(tabs, true);
}

function urisFrom(clicked: unknown, selected: unknown): vscode.Uri[] {
  if (Array.isArray(selected)) {
    const uris = selected.filter(isUri);
    if (uris.length > 0) {
      return uris;
    }
  } else if (isUri(selected)) {
    return [selected];
  }
  return isUri(clicked) ? [clicked] : [];
}

function isUri(value: unknown): value is vscode.Uri {
  return value instanceof vscode.Uri;
}

function uniqueUris(uris: vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>();
  const unique: vscode.Uri[] = [];
  for (const uri of uris) {
    const key = uriKey(uri);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(uri);
  }
  return unique;
}

function namesFrom(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function renameFiles(files: vscode.Uri[], names: string[]): Promise<string | undefined> {
  if (names.length !== files.length) {
    return `Batch Rename expected ${files.length} names and found ${names.length}.`;
  }

  for (const name of names) {
    const invalid = invalidName(name);
    if (invalid) {
      return invalid;
    }
  }

  const sources = new Set(files.map((file) => uriKey(file)));
  const reserved = new Set<string>();
  const entries = files.map((file, index) => ({ file, name: names[index] ?? '' }));
  const ordered = [
    ...entries.filter((entry) => basename(entry.file) === entry.name),
    ...entries.filter((entry) => basename(entry.file) !== entry.name),
  ];
  const planned: { from: vscode.Uri; to: vscode.Uri }[] = [];

  for (const entry of ordered) {
    const target = await allocateTarget(entry.file, entry.name, sources, reserved);
    if (typeof target === 'string') {
      return target;
    }
    if (basename(entry.file) !== basename(target)) {
      planned.push({ from: entry.file, to: target });
    }
  }

  if (planned.length === 0) {
    return undefined;
  }

  const token = randomBytes(4).toString('hex');
  const moved: { from: vscode.Uri; temp: vscode.Uri; to: vscode.Uri; finished: boolean }[] = [];
  try {
    for (let index = 0; index < planned.length; index++) {
      const step = planned[index];
      const temp = vscode.Uri.joinPath(step.from, '..', `.batch-rename-${token}-${index}`);
      await vscode.workspace.fs.rename(step.from, temp, { overwrite: false });
      moved.push({ from: step.from, temp, to: step.to, finished: false });
    }
    for (const step of moved) {
      await vscode.workspace.fs.rename(step.temp, step.to, { overwrite: false });
      step.finished = true;
    }
  } catch (error) {
    const unrestored: string[] = [];
    for (const step of [...moved].reverse()) {
      const current = step.finished ? step.to : step.temp;
      try {
        await vscode.workspace.fs.rename(current, step.from, { overwrite: false });
      } catch {
        unrestored.push(basename(current));
      }
    }
    const detail = error instanceof Error ? error.message : String(error);
    if (unrestored.length > 0) {
      return `Batch Rename could not finish. These temporary files are still in place: ${unrestored.join(', ')}. ${detail}`;
    }
    return `Batch Rename could not rename the files. ${detail}`;
  }

  return undefined;
}

async function allocateTarget(
  from: vscode.Uri,
  name: string,
  sources: Set<string>,
  reserved: Set<string>,
): Promise<vscode.Uri | string> {
  const parent = vscode.Uri.joinPath(from, '..');
  let candidate = name;
  let suffix = 1;
  let target = vscode.Uri.joinPath(parent, candidate);
  while (reserved.has(uriKey(target)) || (await blocksTarget(target, sources))) {
    candidate = suffixedName(name, suffix);
    suffix += 1;
    if (suffix > 1000) {
      return `Could not find a free name for "${name}".`;
    }
    target = vscode.Uri.joinPath(parent, candidate);
  }
  reserved.add(uriKey(target));
  return target;
}

async function blocksTarget(target: vscode.Uri, sources: Set<string>): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(target);
  } catch {
    return false;
  }
  return !sources.has(uriKey(target));
}

function invalidName(name: string): string | undefined {
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return `"${name}" is not a valid file name.`;
  }
  return undefined;
}

function suffixedName(name: string, suffix: number): string {
  const extension = path.posix.extname(name);
  const base = extension ? name.slice(0, -extension.length) : name;
  return `${base}_${suffix}${extension}`;
}

function basename(uri: vscode.Uri): string {
  const slash = uri.path.lastIndexOf('/');
  return slash === -1 ? uri.path : uri.path.slice(slash + 1);
}

function uriKey(uri: vscode.Uri): string {
  const value = uri.toString();
  return uri.scheme === 'file' && process.platform === 'win32' ? value.toLowerCase() : value;
}
