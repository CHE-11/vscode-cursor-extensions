import * as vscode from 'vscode';
import type { SyncFile } from './files';
import type { SyncLocation } from './settings';

let channel: vscode.OutputChannel | undefined;
let hasLogs = false;

export function viewSyncLogs(): void {
  if (!channel || !hasLogs) {
    void vscode.window.showInformationMessage('No sync logs from this session are available.');
    return;
  }
  channel.show();
}

export function disposeSyncLogs(): void {
  channel?.dispose();
  channel = undefined;
  hasLogs = false;
}

export function showSummary(options: {
  upload: boolean;
  quiet: boolean;
  files: SyncFile[];
  gist: string;
  location: SyncLocation;
  folder: string;
  isPublic: boolean;
  hasToken: boolean;
  ignored: string[];
  installed: string[];
  removed: string[];
  failed: string[];
  notes?: string[];
  elapsedMs: number;
}): void {
  const action = options.upload ? 'Upload' : 'Download';
  channel ??= vscode.window.createOutputChannel('Settings Sync');
  hasLogs = true;
  if (options.quiet) {
    const suffix = options.notes && options.notes.length > 0 ? ` ${options.notes[0]}` : '';
    void vscode.window.setStatusBarMessage(`Settings Sync: ${action.toLowerCase()} complete.${suffix}`, 8000);
  } else {
    void vscode.window.setStatusBarMessage(`Settings Sync: ${action.toLowerCase()} complete.`, 5000);
  }

  channel.appendLine(`SETTINGS SYNC ${action.toUpperCase()} SUMMARY`);
  channel.appendLine('--------------------');
  if (options.location === 'folder') {
    channel.appendLine(`Sync folder: ${options.folder || '(none)'}`);
  } else {
    channel.appendLine(`GitHub Gist: ${options.gist || '(none)'}`);
    channel.appendLine(`GitHub Gist Type: ${options.isPublic ? 'Public' : 'Secret'}`);
    channel.appendLine(`Token: ${options.hasToken ? 'stored in Secret Storage' : 'not used'}`);
  }
  channel.appendLine('');
  channel.appendLine(`Files ${action.toLowerCase()}ed:`);
  if (options.files.length === 0) channel.appendLine('  No files.');
  options.files.forEach((file) => channel?.appendLine(`  ${file.fileName} > ${file.gistName}`));
  channel.appendLine('');
  channel.appendLine('Extensions ignored:');
  appendIds(options.ignored, 'No extensions ignored.');
  channel.appendLine('');
  channel.appendLine('Extensions installed:');
  appendIds(options.installed, 'No extensions installed.');
  channel.appendLine('');
  channel.appendLine('Extensions removed:');
  appendIds(options.removed, 'No extensions removed.');
  if (options.failed.length > 0) {
    channel.appendLine('');
    channel.appendLine('Extension changes that failed:');
    appendIds(options.failed, '');
  }
  if (options.notes && options.notes.length > 0) {
    channel.appendLine('');
    channel.appendLine('Chat sync:');
    options.notes.forEach((note) => channel?.appendLine(`  ${note}`));
  }
  channel.appendLine('--------------------');
  channel.appendLine('Done.');
  channel.appendLine(`Sync time: ${formatSyncTime(options.elapsedMs)}`);
}

export function formatSyncTime(elapsedMs: number): string {
  const ms = Math.max(0, Math.round(elapsedMs));
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}m ${rest.toFixed(1)}s`;
}

function appendIds(ids: string[], empty: string): void {
  if (ids.length === 0) {
    if (empty) channel?.appendLine(`  ${empty}`);
    return;
  }
  ids.forEach((id) => channel?.appendLine(`  ${id}`));
}
