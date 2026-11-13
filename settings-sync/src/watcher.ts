import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { App } from './app';
import { readChatWatermark } from './chats';
import { FILES } from './safe';

let folderWatcher: vscode.FileSystemWatcher | undefined;
let extensionWatcher: vscode.Disposable | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let chatTimer: ReturnType<typeof setInterval> | undefined;
let upload: ((app: App) => Promise<void>) | undefined;

export function watchUploads(app: App, delaySeconds: number, onUpload: (app: App) => Promise<void>, watchChats = false): void {
  stopWatching();
  upload = onUpload;
  const delay = Math.min(Math.max(delaySeconds, 1), 300) * 1000;
  const pattern = new vscode.RelativePattern(app.userFolder, '**/*.{json,code-snippets}');
  folderWatcher = vscode.workspace.createFileSystemWatcher(pattern);

  const schedule = (uri?: vscode.Uri) => {
    if (uri) {
      const name = basename(uri.fsPath);
      if (name === FILES.local || name === FILES.lock) return;
    }
    if (!vscode.window.state.focused) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (vscode.window.state.focused && upload) void upload(app);
    }, delay);
  };

  folderWatcher.onDidChange(schedule);
  folderWatcher.onDidCreate(schedule);
  folderWatcher.onDidDelete(schedule);
  extensionWatcher = vscode.extensions.onDidChange(() => schedule());
  if (watchChats && vscode.env.appName === 'Cursor') watchChatWatermark(app, delay, schedule);
}

function watchChatWatermark(app: App, delay: number, schedule: () => void): void {
  let watermark: number | null | undefined;
  const poll = () => {
    if (!vscode.window.state.focused) return;
    const next = readChatWatermark(app.userFolder);
    if (watermark === undefined) {
      watermark = next;
      return;
    }
    if (next !== watermark) {
      watermark = next;
      schedule();
    }
  };
  poll();
  chatTimer = setInterval(poll, delay);
}

export function stopWatching(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (chatTimer) clearInterval(chatTimer);
  chatTimer = undefined;
  folderWatcher?.dispose();
  folderWatcher = undefined;
  extensionWatcher?.dispose();
  extensionWatcher = undefined;
  upload = undefined;
}
