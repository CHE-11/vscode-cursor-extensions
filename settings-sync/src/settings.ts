import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { FILES, type LocalSettings, defaultLocalSettings, normalizeLocal } from './safe';
import { requestRefresh } from './refresh';

const SECTION = 'settings-sync';

export interface SyncSettings {
  gist: string;
  autoDownload: boolean;
  autoUpload: boolean;
  forceDownload: boolean;
  forceUpload: boolean;
  quietSync: boolean;
  removeExtensions: boolean;
  syncExtensions: boolean;
  githubEnterpriseUrl: string;
  downloadPublicGist: boolean;
  hostName: string;
  universalKeybindings: boolean;
  autoUploadDelay: number;
  askGistDescription: boolean;
  gistDescription: string;
}

const SETTING_KEYS: Array<keyof SyncSettings> = [
  'gist',
  'autoDownload',
  'autoUpload',
  'forceDownload',
  'forceUpload',
  'quietSync',
  'removeExtensions',
  'syncExtensions',
  'githubEnterpriseUrl',
  'downloadPublicGist',
  'hostName',
  'universalKeybindings',
  'autoUploadDelay',
  'askGistDescription',
  'gistDescription',
];

export function readSettings(): SyncSettings {
  const config = vscode.workspace.getConfiguration(SECTION);
  const delay = config.get<number>('autoUploadDelay') ?? 20;
  return {
    gist: (config.get<string>('gist') || '').trim(),
    autoDownload: config.get<boolean>('autoDownload') === true,
    autoUpload: config.get<boolean>('autoUpload') === true,
    forceDownload: config.get<boolean>('forceDownload') === true,
    forceUpload: config.get<boolean>('forceUpload') === true,
    quietSync: config.get<boolean>('quietSync') === true,
    removeExtensions: config.get<boolean>('removeExtensions') === true,
    syncExtensions: config.get<boolean>('syncExtensions') !== false,
    githubEnterpriseUrl: (config.get<string>('githubEnterpriseUrl') || '').trim(),
    downloadPublicGist: config.get<boolean>('downloadPublicGist') === true,
    hostName: (config.get<string>('hostName') || '').trim(),
    universalKeybindings: config.get<boolean>('universalKeybindings') === true,
    autoUploadDelay: Math.min(Math.max(delay, 1), 300),
    askGistDescription: config.get<boolean>('askGistDescription') === true,
    gistDescription: config.get<string>('gistDescription') || 'Visual Studio Code Settings Sync Gist',
  };
}

export async function updateSettings(partial: Partial<SyncSettings>): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  for (const [key, value] of Object.entries(partial)) {
    await config.update(key, value, vscode.ConfigurationTarget.Global);
  }
  requestRefresh();
}

export async function clearSettings(): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  for (const key of SETTING_KEYS) {
    await config.update(key, undefined, vscode.ConfigurationTarget.Global);
  }
}

export function localSettingsPath(userFolder: string): string {
  return join(userFolder, FILES.local);
}

export async function readLocal(userFolder: string): Promise<{ settings: LocalSettings; legacyToken: string; changed: boolean }> {
  try {
    const raw = JSON.parse(await readFile(localSettingsPath(userFolder), 'utf8')) as unknown;
    return normalizeLocal(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { settings: defaultLocalSettings(), legacyToken: '', changed: false };
    }
    throw new Error('syncLocalSettings.json is not valid JSON.');
  }
}

export async function writeLocal(userFolder: string, settings: LocalSettings): Promise<void> {
  await writeFile(localSettingsPath(userFolder), JSON.stringify(settings, null, 4), 'utf8');
  requestRefresh();
}

export function proxyUrl(): string {
  const configured = vscode.workspace.getConfiguration('http').get<string>('proxy') || '';
  return configured.trim() || process.env.http_proxy || process.env.HTTP_PROXY || '';
}
