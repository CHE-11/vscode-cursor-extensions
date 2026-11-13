import * as vscode from 'vscode';
import type { SyncFile } from './files';

let channel: vscode.OutputChannel | undefined;

export function showSummary(options: {
  upload: boolean;
  quiet: boolean;
  files: SyncFile[];
  gist: string;
  isPublic: boolean;
  hasToken: boolean;
  ignored: string[];
  installed: string[];
  removed: string[];
  failed: string[];
  notes?: string[];
}): void {
  const action = options.upload ? 'Upload' : 'Download';
  if (options.quiet) {
    const suffix = options.notes && options.notes.length > 0 ? ` ${options.notes[0]}` : '';
    void vscode.window.setStatusBarMessage(`Settings Sync: ${action.toLowerCase()} complete.${suffix}`, 8000);
    return;
  }

  channel ??= vscode.window.createOutputChannel('Settings Sync');
  channel.appendLine(`SETTINGS SYNC ${action.toUpperCase()} SUMMARY`);
  channel.appendLine('--------------------');
  channel.appendLine(`GitHub Gist: ${options.gist || '(none)'}`);
  channel.appendLine(`GitHub Gist Type: ${options.isPublic ? 'Public' : 'Secret'}`);
  channel.appendLine(`Token: ${options.hasToken ? 'stored in Secret Storage' : 'not used'}`);
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
  channel.show(true);
}

function appendIds(ids: string[], empty: string): void {
  if (ids.length === 0) {
    if (empty) channel?.appendLine(`  ${empty}`);
    return;
  }
  ids.forEach((id) => channel?.appendLine(`  ${id}`));
}
