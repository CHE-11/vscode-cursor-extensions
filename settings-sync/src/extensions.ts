import * as vscode from 'vscode';
import { isExtensionId } from './safe';

export interface SyncedExtension {
  name: string;
  publisher: string;
  version: string;
  metadata: {
    id: string;
    publisherId: string;
    publisherDisplayName: string;
  };
}

const SELF = new Set(['settings-sync', 'ce-settings-sync']);

export function listLocalExtensions(): SyncedExtension[] {
  return vscode.extensions.all.flatMap((extension) => {
    if (extension.packageJSON.isBuiltin) return [];
    const name = stringField(extension.packageJSON.name);
    const publisher = stringField(extension.packageJSON.publisher);
    const id = `${publisher}.${name}`;
    if (!isExtensionId(id) || SELF.has(name)) return [];
    return [{
      name,
      publisher,
      version: stringField(extension.packageJSON.version),
      metadata: {
        id: stringField(extension.packageJSON.uuid) || extension.id,
        publisherId: extension.id,
        publisherDisplayName: publisher,
      },
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function parseExtensionList(text: string): SyncedExtension[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The Gist extensions list is not valid JSON.');
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const name = stringField(record.name);
    const publisher = stringField(record.publisher);
    if (!isExtensionId(`${publisher}.${name}`) || SELF.has(name)) return [];
    return [{
      name,
      publisher,
      version: stringField(record.version),
      metadata: {
        id: '',
        publisherId: '',
        publisherDisplayName: publisher,
      },
    }];
  });
}

export function extensionIsIgnored(id: string, name: string, ignored: string[]): boolean {
  const full = id.toLowerCase();
  const short = name.toLowerCase();
  return ignored.some((item) => {
    const candidate = item.toLowerCase();
    return candidate === full || candidate === short;
  });
}

export function extensionChanges(
  remote: SyncedExtension[],
  ignored: string[]
): { install: string[]; uninstall: string[] } {
  const local = listLocalExtensions();
  const remoteIds = new Set(remote.map(extensionId).filter((id): id is string => id !== null && !extensionIsIgnored(id, id.slice(id.indexOf('.') + 1), ignored)));
  const localIds = new Set(local.map(extensionId).filter((id): id is string => id !== null && !extensionIsIgnored(id, id.slice(id.indexOf('.') + 1), ignored)));
  return {
    install: [...remoteIds].filter((id) => !localIds.has(id)).sort(),
    uninstall: [...localIds].filter((id) => !remoteIds.has(id)).sort(),
  };
}

export async function confirmExtensionChanges(
  install: string[],
  uninstall: string[]
): Promise<{ install: string[]; uninstall: string[] } | null> {
  const items: Array<vscode.QuickPickItem & { id: string; action: 'install' | 'uninstall' }> = [
    ...install.map((id) => ({ label: `Install ${id}`, id, action: 'install' as const, picked: true })),
    ...uninstall.map((id) => ({ label: `Uninstall ${id}`, id, action: 'uninstall' as const, picked: true })),
  ];
  if (items.length === 0) return { install: [], uninstall: [] };
  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    ignoreFocusOut: true,
    title: 'Extension changes from the Gist',
    placeHolder: 'Uncheck anything you want to skip. Esc skips every extension change.',
  });
  if (!selected) return null;
  return {
    install: selected.filter((item) => item.action === 'install').map((item) => item.id),
    uninstall: selected.filter((item) => item.action === 'uninstall').map((item) => item.id),
  };
}

export async function applyExtensionChanges(install: string[], uninstall: string[]): Promise<{ installed: string[]; removed: string[]; failed: string[] }> {
  const installed: string[] = [];
  const removed: string[] = [];
  const failed: string[] = [];
  for (const id of install) {
    if (!isExtensionId(id)) continue;
    try {
      await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
      installed.push(id);
    } catch {
      failed.push(id);
    }
  }
  for (const id of uninstall) {
    if (!isExtensionId(id)) continue;
    try {
      await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', id);
      removed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return { installed, removed, failed };
}

function extensionId(extension: SyncedExtension): string | null {
  const id = `${extension.publisher}.${extension.name}`;
  return isExtensionId(id) ? id : null;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
